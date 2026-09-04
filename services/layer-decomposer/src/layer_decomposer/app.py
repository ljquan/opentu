from __future__ import annotations

import asyncio
import base64
import json
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError
from starlette.datastructures import FormData, UploadFile

from .backend import DecompositionBackend, load_backend
from .config import Settings
from .contracts import (
    CorrectionRequest,
    DecompositionOptions,
    ErrorResponse,
    JsonDecompositionRequest,
    TaskAcceptedResponse,
    TaskStatusResponse,
)
from .errors import BackendUnavailable, InvalidRequest, PayloadTooLarge, ServiceError
from .image_input import ImageAsset, materialize_json_image, materialize_upload
from .task_store import TaskStore


def create_app(settings: Settings | None = None, backend: DecompositionBackend | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_backend = backend or load_backend(resolved_settings)
    application = FastAPI(title="OpenTu Layer Decomposer", version="0.1.0")
    application.state.settings = resolved_settings
    application.state.backend = resolved_backend
    application.state.capacity = asyncio.Semaphore(resolved_settings.max_concurrency)
    application.state.tasks = TaskStore(resolved_settings)

    @application.exception_handler(ServiceError)
    async def handle_service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})

    @application.get("/healthz")
    async def health() -> JSONResponse:
        ready = resolved_backend.is_ready
        return JSONResponse(status_code=200 if ready else 503, content={
            "status": "ok" if ready else "degraded", "backend_ready": ready,
            "backend_mode": "test" if resolved_settings.environment == "test" else "inference",
            "reason": resolved_backend.unavailable_reason,
            "limits": {"max_image_bytes": resolved_settings.max_image_bytes, "max_image_pixels": resolved_settings.max_image_pixels,
                       "max_layers": resolved_settings.max_layers, "max_concurrency": resolved_settings.max_concurrency,
                       "task_ttl_seconds": resolved_settings.task_ttl_seconds, "task_max_tasks": resolved_settings.task_max_tasks},
            "pipeline": ["candidate_detection", "sam2", "matting", "depth", "inpainting", "quality"],
        })

    @application.post("/api/layer-decompositions", status_code=202, response_model=TaskAcceptedResponse,
                      responses={400: {"model": ErrorResponse}, 413: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
    async def submit(request: Request) -> JSONResponse:
        if not resolved_backend.is_ready:
            raise BackendUnavailable(resolved_backend.unavailable_reason or "decomposition backend is unavailable")
        parsed = await _parse_request(request, resolved_settings)
        if parsed.options.max_layers > resolved_settings.max_layers:
            await _close_upload(parsed.upload)
            raise InvalidRequest(f"max_layers exceeds the service limit of {resolved_settings.max_layers}")
        root_dir = Path(tempfile.mkdtemp(prefix="opentu-layer-task-"))
        try:
            asset = await _materialize_request_image(parsed, root_dir / "input.image", resolved_settings)
            record = await application.state.tasks.create(uuid.uuid4().hex, root_dir, asset, parsed.options, resolved_backend, application.state.capacity)
            return JSONResponse(status_code=202, content=TaskAcceptedResponse(task_id=record.task_id, status="pending").model_dump())
        except Exception:
            _remove_task_root(root_dir)
            raise
        finally:
            await _close_upload(parsed.upload)

    @application.get("/api/layer-decompositions/{task_id}", response_model=TaskStatusResponse, responses={404: {"model": ErrorResponse}})
    async def inspect(task_id: str) -> TaskStatusResponse:
        return application.state.tasks.response(await application.state.tasks.get(_validate_task_id(task_id)))

    @application.get("/api/layer-decompositions/{task_id}/assets/{asset_name:path}")
    async def artifact(task_id: str, asset_name: str) -> Response:
        record = await application.state.tasks.get(_validate_task_id(task_id))
        asset_path = Path(*asset_name.split("/"))
        if asset_path.is_absolute() or ".." in asset_path.parts or asset_path.suffix.lower() != ".png":
            raise InvalidRequest("asset name is invalid")
        output: Path | None = None
        for root in ((record.root_dir / "local-assets").resolve(), (record.root_dir / "ark-assets").resolve()):
            candidate = (root / asset_path).resolve()
            if root in candidate.parents and candidate.is_file():
                output = candidate
                break
        if output is None:
            raise InvalidRequest("asset was not found")
        return FileResponse(output, media_type="image/png", headers={"Cache-Control": "no-store"})

    if resolved_settings.environment == "test":
        @application.get("/api/layer-decompositions/{task_id}/test-assets/{asset_name}")
        async def test_asset(task_id: str, asset_name: str) -> Response:
            record = await application.state.tasks.get(_validate_task_id(task_id))
            if asset_name == "background.png":
                return FileResponse(
                    record.asset.path,
                    media_type=record.asset.content_type,
                    headers={"Cache-Control": "no-store"},
                )
            if asset_name in {"layer-1.png", "layer-2.png"}:
                return Response(
                    content=base64.b64decode(
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
                        "AAAADUlEQVR42mNk+M/wHwAF/gL+X+XDSAAAAABJRU5ErkJggg=="
                    ),
                    media_type="image/png",
                    headers={"Cache-Control": "no-store"},
                )
            raise InvalidRequest("test asset name is invalid")

    @application.post("/api/layer-decompositions/{task_id}/cancel", response_model=TaskStatusResponse,
                      responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})
    async def cancel(task_id: str) -> TaskStatusResponse:
        return application.state.tasks.response(await application.state.tasks.cancel(_validate_task_id(task_id)))

    @application.post("/api/layer-decompositions/{task_id}/correct", response_model=TaskStatusResponse,
                      responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})
    async def correct(task_id: str, request: Request) -> TaskStatusResponse:
        validated_task_id = _validate_task_id(task_id)
        mask_upload: UploadFile | None = None
        try:
            correction, mask_upload = await _parse_correction_request(
                request, resolved_settings
            )
        except (ValidationError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise InvalidRequest(_validation_message(exc)) from exc
        mask_path: Path | None = None
        try:
            if mask_upload is not None or correction.mask is not None:
                record = await application.state.tasks.get(validated_task_id)
                mask_path = record.root_dir / f"correction-mask-{uuid.uuid4().hex}.image"
                if mask_upload is not None:
                    await materialize_upload(mask_upload, mask_path, resolved_settings)
                else:
                    await materialize_json_image(correction.mask or "", mask_path, resolved_settings)
                correction = correction.model_copy(update={"mask": None})
            updated = await application.state.tasks.correct(
                validated_task_id, correction, mask_path
            )
            return application.state.tasks.response(updated)
        except Exception:
            if mask_path is not None and mask_path.exists():
                mask_path.unlink(missing_ok=True)
            raise
        finally:
            await _close_upload(mask_upload)

    return application


class _ParsedRequest:
    __slots__ = ("image_source", "upload", "options")
    def __init__(self, *, options: DecompositionOptions, image_source: str | None = None, upload: UploadFile | None = None) -> None:
        self.options, self.image_source, self.upload = options, image_source, upload


async def _parse_request(request: Request, settings: Settings) -> _ParsedRequest:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    _validate_declared_body_size(request, content_type, settings.max_image_bytes)
    if content_type == "application/json":
        try:
            payload = JsonDecompositionRequest.model_validate(json.loads(await _read_limited_json_body(request, settings.max_image_bytes)))
        except (json.JSONDecodeError, UnicodeDecodeError, ValidationError) as exc:
            raise InvalidRequest(_validation_message(exc)) from exc
        return _ParsedRequest(image_source=payload.image, options=DecompositionOptions(prompt=payload.prompt, mode=payload.mode, max_layers=payload.max_layers))
    if content_type == "multipart/form-data":
        try:
            form = await request.form(max_files=1, max_fields=4, max_part_size=settings.max_image_bytes + 1)
            try:
                return _parse_multipart(form)
            except Exception:
                await form.close()
                raise
        except ServiceError:
            raise
        except Exception as exc:
            raise InvalidRequest("malformed multipart request") from exc
    raise InvalidRequest("Content-Type must be application/json or multipart/form-data")


def _validate_declared_body_size(request: Request, content_type: str, max_image_bytes: int) -> None:
    value = request.headers.get("content-length")
    if value is None:
        return
    try:
        length = int(value)
    except ValueError as exc:
        raise InvalidRequest("Content-Length must be an integer") from exc
    if length < 0:
        raise InvalidRequest("Content-Length must be non-negative")
    if content_type == "multipart/form-data" and length > max_image_bytes + 64 * 1024:
        raise PayloadTooLarge("multipart request body exceeds the image limit")


async def _read_limited_json_body(request: Request, max_image_bytes: int) -> bytes:
    max_body = ((max_image_bytes + 2) // 3) * 4 + 16 * 1024
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_body:
            raise PayloadTooLarge("JSON request body exceeds the image limit")
    return bytes(body)


async def _read_small_json(request: Request) -> dict[str, Any]:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 64 * 1024:
            raise PayloadTooLarge("correction request body is too large")
    try:
        value = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InvalidRequest("request body is not valid JSON") from exc
    if not isinstance(value, dict):
        raise InvalidRequest("request body must be a JSON object")
    return value


async def _parse_correction_request(
    request: Request, settings: Settings
) -> tuple[CorrectionRequest, UploadFile | None]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    _validate_declared_body_size(request, content_type, settings.max_image_bytes)
    if content_type == "application/json":
        return CorrectionRequest.model_validate(await _read_small_json(request)), None
    if content_type != "multipart/form-data":
        raise InvalidRequest("Content-Type must be application/json or multipart/form-data")

    try:
        form = await request.form(
            max_files=1,
            max_fields=5,
            max_part_size=settings.max_image_bytes + 1,
        )
        try:
            allowed = {"prompt", "action", "layer_z_index", "bbox", "mask"}
            if any(key not in allowed for key in form.keys()):
                raise InvalidRequest("correction contains unsupported fields")
            mask = form.get("mask")
            if mask is not None and not isinstance(mask, UploadFile):
                raise InvalidRequest("correction mask must be an image file")
            values: dict[str, Any] = {
                key: form.get(key)
                for key in ("prompt", "action", "layer_z_index")
                if form.get(key) is not None
            }
            bbox = form.get("bbox")
            if bbox is not None:
                if not isinstance(bbox, str):
                    raise InvalidRequest("correction bbox must be JSON")
                try:
                    values["bbox"] = json.loads(bbox)
                except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                    raise InvalidRequest("correction bbox must be valid JSON") from exc
            # The file itself is carried out-of-band as mask_path. A minimal
            # valid image URL keeps the shared Pydantic contract strict while
            # avoiding any Base64 copy of the uploaded file.
            if mask is not None:
                values["mask"] = "data:image/png;base64,AA=="
            correction = CorrectionRequest.model_validate(values)
            return correction, mask
        except Exception:
            await form.close()
            raise
    except ServiceError:
        raise
    except ValidationError:
        raise
    except Exception as exc:
        raise InvalidRequest("malformed correction multipart request") from exc


def _parse_multipart(form: FormData) -> _ParsedRequest:
    if any(key not in {"image", "prompt", "mode", "max_layers"} for key in form.keys()):
        raise InvalidRequest("multipart request contains unsupported fields")
    image = form.get("image")
    if not isinstance(image, UploadFile):
        raise InvalidRequest("multipart request requires one image file")
    values = {key: form.get(key) for key in ("prompt", "mode", "max_layers") if form.get(key) is not None}
    try:
        options = DecompositionOptions.model_validate(values)
    except ValidationError as exc:
        raise InvalidRequest(_validation_message(exc)) from exc
    return _ParsedRequest(upload=image, options=options)


async def _materialize_request_image(parsed: _ParsedRequest, destination: Path, settings: Settings) -> ImageAsset:
    if parsed.upload is not None:
        return await materialize_upload(parsed.upload, destination, settings)
    if parsed.image_source is None:
        raise InvalidRequest("image is required")
    return await materialize_json_image(parsed.image_source, destination, settings)


def _validate_task_id(task_id: str) -> str:
    if len(task_id) != 32 or any(char not in "0123456789abcdef" for char in task_id):
        raise InvalidRequest("task_id is malformed")
    return task_id


def _validation_message(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        first = exc.errors(include_url=False)[0]
        location = ".".join(str(part) for part in first.get("loc", ()))
        return f"{location + ': ' if location else ''}{first.get('msg', 'invalid request')}"
    return "request body is not valid JSON"


async def _close_upload(upload: UploadFile | None) -> None:
    if upload is not None:
        await upload.close()


def _remove_task_root(path: Path) -> None:
    try:
        resolved, temp_root = path.resolve(), Path(tempfile.gettempdir()).resolve()
    except OSError:
        return
    if resolved.parent == temp_root and resolved.name.startswith("opentu-layer-task-"):
        shutil.rmtree(resolved, ignore_errors=True)


app = create_app()
