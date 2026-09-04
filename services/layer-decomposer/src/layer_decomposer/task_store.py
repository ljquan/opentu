from __future__ import annotations

import asyncio
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from .backend import BackendRequest, DecompositionBackend
from .config import Settings
from .contracts import (
    CorrectionRequest,
    DecompositionOptions,
    LayerDecompositionData,
    LayerResult,
    TaskError,
    TaskStatusResponse,
)
from .errors import CapacityExceeded, InvalidRequest, TaskConflict, TaskNotFound
from .image_input import ImageAsset


@dataclass(slots=True)
class TaskRecord:
    task_id: str
    root_dir: Path
    asset: ImageAsset
    options: DecompositionOptions
    backend: DecompositionBackend
    capacity: asyncio.Semaphore
    status: str = "pending"
    phase: str = "queued"
    progress: float = 0.0
    data: LayerDecompositionData | None = None
    error: TaskError | None = None
    correction: CorrectionRequest | None = None
    correction_mask_path: Path | None = None
    previous_layers: tuple[LayerResult, ...] = ()
    cancel_requested: bool = False
    revision: int = 0
    committed_attempt: str | None = None
    created_at: float = field(default_factory=time.monotonic)
    last_access: float = field(default_factory=time.monotonic)
    runner: asyncio.Task[None] | None = None

    @property
    def attempt_id(self) -> str:
        return f"{self.task_id}-r{self.revision}"


class TaskStore:
    """Lock-protected, TTL-bound task index with bounded source-image disk usage."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._tasks: dict[str, TaskRecord] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        task_id: str,
        root_dir: Path,
        asset: ImageAsset,
        options: DecompositionOptions,
        backend: DecompositionBackend,
        capacity: asyncio.Semaphore,
    ) -> TaskRecord:
        async with self._lock:
            self._purge_expired_locked()
            input_bytes = asset.path.stat().st_size
            stored_bytes = sum(_source_size(item) for item in self._tasks.values())
            if len(self._tasks) >= self._settings.task_max_tasks:
                raise CapacityExceeded("task storage count limit is exhausted")
            if stored_bytes + input_bytes > self._settings.task_max_storage_bytes:
                raise CapacityExceeded("task storage byte limit is exhausted")
            record = TaskRecord(task_id, root_dir, asset, options, backend, capacity)
            self._tasks[task_id] = record
            record.runner = asyncio.create_task(self._run(record), name=f"layer-task-{task_id}")
            return record

    async def get(self, task_id: str) -> TaskRecord:
        async with self._lock:
            self._purge_expired_locked()
            record = self._tasks.get(task_id)
            if record is None:
                raise TaskNotFound(f"task '{task_id}' was not found")
            record.last_access = time.monotonic()
            return record

    async def cancel(self, task_id: str) -> TaskRecord:
        record = await self.get(task_id)
        async with self._lock:
            if record.status in {"completed", "failed", "cancelled", "stopped"}:
                raise TaskConflict(f"task is already {record.status}")
            record.cancel_requested = True
            record.status, record.phase, record.progress = "cancelled", "cancelled", 1.0
            runner = record.runner
            if runner is not None:
                runner.cancel()
        if runner is not None:
            await asyncio.gather(runner, return_exceptions=True)
        _remove_root(record.root_dir)
        return record

    async def correct(
        self,
        task_id: str,
        correction: CorrectionRequest,
        mask_path: Path | None = None,
    ) -> TaskRecord:
        record = await self.get(task_id)
        async with self._lock:
            active = record.runner is not None and not record.runner.done()
            if record.status in {"pending", "running"} or (record.status == "correcting" and active):
                raise TaskConflict("task is still processing")
            if record.status == "cancelled":
                raise TaskConflict("cancelled tasks cannot be corrected")
            previous_data = record.data
            if correction.layer_z_index is not None:
                if previous_data is None or correction.layer_z_index > len(previous_data.layers):
                    raise InvalidRequest("layer_z_index does not identify an existing layer")
            record.revision += 1
            record.correction = correction
            record.previous_layers = (
                tuple(previous_data.layers) if previous_data is not None else ()
            )
            previous_mask_path = record.correction_mask_path
            record.correction_mask_path = mask_path
            record.status, record.phase, record.progress = "correcting", "requeued", 0.0
            record.data = None
            record.error = None
            record.cancel_requested = False
            record.runner = asyncio.create_task(self._run(record), name=f"layer-task-correction-{task_id}")
            if previous_mask_path is not None and previous_mask_path != mask_path:
                _remove_file(previous_mask_path)
            return record

    def response(self, record: TaskRecord) -> TaskStatusResponse:
        return TaskStatusResponse(
            task_id=record.task_id,
            status=record.status,  # type: ignore[arg-type]
            phase=record.phase,
            progress=record.progress,
            data=record.data,
            error=record.error,
        )

    async def _run(self, record: TaskRecord) -> None:
        acquired = False
        attempt_id = record.attempt_id
        preserve_outputs = False
        try:
            if record.cancel_requested:
                return
            await asyncio.wait_for(
                record.capacity.acquire(), timeout=self._settings.queue_timeout_seconds
            )
            acquired = True
            if record.cancel_requested:
                return
            record.status = "correcting" if record.correction is not None else "running"
            record.phase, record.progress = "extracting", 0.1
            prompt = (
                record.correction.prompt
                if record.correction is not None and record.correction.prompt is not None
                else record.options.prompt
            )
            result = await record.backend.decompose(
                BackendRequest(
                    request_id=attempt_id,
                    image=record.asset,
                    prompt=prompt,
                    mode=record.options.mode,
                    max_layers=record.options.max_layers,
                    correction=record.correction,
                    mask_path=record.correction_mask_path,
                    previous_layers=record.previous_layers,
                )
            )
            if record.cancel_requested:
                return
            record.phase, record.progress = "quality_check", 0.9
            if len(result.layers) > record.options.max_layers:
                raise RuntimeError("backend returned more layers than requested")
            if [layer.z_index for layer in result.layers] != list(range(1, len(result.layers) + 1)):
                raise RuntimeError("backend returned a non-contiguous layer order")
            record.data = LayerDecompositionData(
                group_id=f"group-{record.task_id}", width=record.asset.width, height=record.asset.height,
                background=result.background, layers=list(result.layers), quality=result.quality,
                result_kind=result.result_kind,
                decisions=list(result.decisions),
            )
            low_confidence = any(layer.confidence < self._settings.min_layer_confidence for layer in result.layers)
            if not result.quality.passed or low_confidence:
                record.status, record.phase, record.progress = "correcting", "needs_correction", 1.0
                return
            previous_attempt = record.committed_attempt
            record.committed_attempt = attempt_id
            preserve_outputs = True
            record.status, record.phase, record.progress = "completed", "completed", 1.0
            if previous_attempt and previous_attempt != attempt_id:
                await _discard_backend(record.backend, previous_attempt)
        except TimeoutError:
            record.status, record.phase, record.progress = "failed", "queue_timeout", 1.0
            record.error = TaskError(code="capacity_exceeded", message="decomposition queue wait timed out")
        except asyncio.CancelledError:
            record.status = "cancelled" if record.cancel_requested else "stopped"
            record.phase, record.progress = record.status, 1.0
            raise
        except Exception as exc:
            if not record.cancel_requested:
                record.status, record.phase, record.progress = "failed", "failed", 1.0
                record.error = TaskError(code="decomposition_failed", message=str(exc))
        finally:
            if acquired:
                record.capacity.release()
            if not preserve_outputs:
                await _discard_backend(record.backend, attempt_id)
            if record.status in {"cancelled", "stopped"}:
                _remove_root(record.root_dir)

    def _purge_expired_locked(self) -> None:
        now = time.monotonic()
        expired = [record for record in self._tasks.values()
                   if now - record.last_access > self._settings.task_ttl_seconds
                   and record.status not in {"pending", "running"}
                   and not (record.status == "correcting" and record.runner and not record.runner.done())]
        for record in expired:
            self._tasks.pop(record.task_id, None)
            _remove_root(record.root_dir)


def _source_size(record: TaskRecord) -> int:
    try:
        return record.asset.path.stat().st_size
    except OSError:
        return 0


async def _discard_backend(backend: DecompositionBackend, prefix: str) -> None:
    discard = getattr(backend, "discard", None)
    if discard is not None:
        await discard(prefix)


def _remove_root(path: Path) -> None:
    try:
        resolved, temp_root = path.resolve(), Path(tempfile.gettempdir()).resolve()
    except OSError:
        return
    if resolved.parent == temp_root and resolved.name.startswith("opentu-layer-task-"):
        shutil.rmtree(resolved, ignore_errors=True)


def _remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
