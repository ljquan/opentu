from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

from .config import Settings
from .contracts import BackgroundResult, CorrectionRequest, DecompositionMode, LayerResult, QualityMetrics
from .errors import BackendUnavailable
from .image_input import ImageAsset


@dataclass(frozen=True, slots=True)
class BackendRequest:
    request_id: str
    image: ImageAsset
    prompt: str | None
    mode: DecompositionMode
    max_layers: int
    correction: CorrectionRequest | None = None
    previous_layers: tuple[LayerResult, ...] = ()
    # Multipart correction masks are materialized in the task directory. The
    # provider adapter may use this local path instead of downloading a URL.
    mask_path: Path | None = None


@dataclass(frozen=True, slots=True)
class BackendResult:
    background: BackgroundResult
    layers: tuple[LayerResult, ...]
    quality: QualityMetrics
    decisions: tuple[str, ...] = ()
    result_kind: Literal["inference", "test"] = "inference"


@runtime_checkable
class DecompositionBackend(Protocol):
    @property
    def is_ready(self) -> bool: ...

    @property
    def unavailable_reason(self) -> str | None: ...

    async def decompose(self, request: BackendRequest) -> BackendResult: ...

    async def discard(self, request_id: str) -> None: ...


class UnavailableBackend:
    def __init__(self, reason: str) -> None:
        self._reason = reason

    @property
    def is_ready(self) -> bool:
        return False

    @property
    def unavailable_reason(self) -> str:
        return self._reason

    async def decompose(self, request: BackendRequest) -> BackendResult:
        del request
        raise BackendUnavailable(self._reason)

    async def discard(self, request_id: str) -> None:
        del request_id


def load_backend(settings: Settings) -> DecompositionBackend:
    reference = settings.backend_factory
    if not reference:
        return UnavailableBackend(
            "no local decomposition backend is configured; set "
            "LAYER_DECOMPOSER_BACKEND_FACTORY to a local model factory"
        )
    if ":" not in reference:
        return UnavailableBackend("backend factory must use the 'module:function' form")
    module_name, function_name = reference.rsplit(":", 1)
    try:
        factory = getattr(importlib.import_module(module_name), function_name)
        backend = factory(settings)
    except Exception as exc:  # The health endpoint exposes configuration failures safely.
        return UnavailableBackend(f"decomposition backend failed to initialize: {exc}")
    if not isinstance(backend, DecompositionBackend):
        return UnavailableBackend("backend factory returned an incompatible object")
    return backend


def ensure_local_artifact(path: Path, workdir: Path) -> Path:
    try:
        resolved = path.resolve(strict=True)
        root = workdir.resolve(strict=True)
    except OSError as exc:
        raise BackendUnavailable("model component returned a missing artifact") from exc
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise BackendUnavailable("model component returned an unsafe artifact path")
    return resolved
