from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
from pathlib import Path, PurePosixPath
from typing import Any, Sequence

from PIL import Image

from .backend import BackendRequest, BackendResult
from .config import Settings
from .contracts import CorrectionRequest, QualityMetrics
from .errors import BackendUnavailable
from .orchestration import (
    BackgroundArtifact,
    Candidate,
    LayerArtifact,
    OrchestrationBackend,
    OrchestrationComponents,
)

_CANDIDATE_MARKER = "__opentu_layer_candidates__"
_COPY_CHUNK_SIZE = 1024 * 1024
_DETECTOR_IMAGE_SIZE = 960


class LocalModelBackend:
    """Serializes non-cancellable native inference and binds task-local assets."""

    result_kind = "inference"

    def __init__(
        self,
        pipeline: OrchestrationBackend,
        publisher: "LocalArtifactPublisher",
        max_working_pixels: int,
    ) -> None:
        self._pipeline = pipeline
        self._publisher = publisher
        self._max_working_pixels = max_working_pixels
        self._inference_lock = asyncio.Lock()

    @property
    def is_ready(self) -> bool:
        return True

    @property
    def unavailable_reason(self) -> None:
        return None

    async def decompose(self, request: BackendRequest) -> BackendResult:
        pixels = request.image.width * request.image.height
        if pixels > self._max_working_pixels:
            raise BackendUnavailable(
                "image exceeds the local pipeline working-pixel limit of "
                f"{self._max_working_pixels}"
            )
        async with self._inference_lock:
            await self._publisher.bind_request(request)
            inference = asyncio.create_task(self._pipeline.decompose(request))
            try:
                # Native model calls run in worker threads and cannot be cancelled safely.
                return await asyncio.shield(inference)
            except asyncio.CancelledError:
                await asyncio.gather(inference, return_exceptions=True)
                raise

    async def discard(self, request_id: str) -> None:
        async with self._inference_lock:
            await self._pipeline.discard(request_id)


class LocalCandidateDetector:
    def __init__(
        self,
        model: Any,
        device: str,
        confidence: float,
        iou: float,
    ) -> None:
        self._model = model
        self._device = device
        self._confidence = confidence
        self._iou = iou

    async def detect(
        self, image: Path, prompt: str | None, limit: int
    ) -> Sequence[Candidate]:
        supplied = parse_supplied_candidates(prompt, image, limit)
        if supplied:
            return supplied
        return await asyncio.to_thread(self._detect_sync, image, limit)

    def _detect_sync(self, image: Path, limit: int) -> tuple[Candidate, ...]:
        try:
            np, _ = _image_modules()
            with Image.open(image) as source_image:
                source = np.asarray(source_image.convert("RGB"))
            stream = self._model.predict(
                source=source,
                conf=self._confidence,
                iou=self._iou,
                max_det=limit,
                imgsz=_DETECTOR_IMAGE_SIZE,
                device=self._device,
                verbose=False,
                stream=True,
            )
            candidates: list[Candidate] = []
            for result in stream:
                names = getattr(result, "names", {})
                boxes = getattr(result, "boxes", None)
                if boxes is None:
                    continue
                original_shape = getattr(result, "orig_shape", None)
                if (
                    not isinstance(original_shape, (tuple, list))
                    or len(original_shape) != 2
                ):
                    with Image.open(image) as source:
                        original_width, original_height = source.size
                else:
                    original_height, original_width = (
                        int(original_shape[0]),
                        int(original_shape[1]),
                    )
                for box in boxes:
                    values = _tensor_values(box.xyxy[0])
                    if len(values) != 4:
                        continue
                    bbox = (
                        max(0, min(original_width - 1, int(round(values[0])))),
                        max(0, min(original_height - 1, int(round(values[1])))),
                        max(1, min(original_width, int(round(values[2])))),
                        max(1, min(original_height, int(round(values[3])))),
                    )
                    if bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
                        continue
                    confidence = _tensor_scalar(box.conf[0])
                    class_id = int(round(_tensor_scalar(box.cls[0])))
                    name = str(names.get(class_id, f"object-{class_id}"))
                    candidates.append(
                        Candidate(
                            candidate_id=f"local-{len(candidates) + 1}",
                            name=name,
                            description=f"Locally detected {name}",
                            bounding_box=bbox,  # type: ignore[arg-type]
                            confidence=max(0.0, min(1.0, confidence)),
                        )
                    )
                    if len(candidates) >= limit:
                        return tuple(candidates)
            return tuple(candidates)
        except Exception as exc:
            raise BackendUnavailable(f"local candidate detection failed: {exc}") from exc


class EmptyOcr:
    async def detect_text(self, image: Path, limit: int) -> Sequence[Candidate]:
        del image, limit
        return ()


class Sam2Segmenter:
    def __init__(self, model: Any, device: str) -> None:
        self._model = model
        self._device = device

    async def segment(
        self,
        image: Any,
        candidates: Sequence[Candidate],
        workdir: Path,
        correction: CorrectionRequest | None = None,
        mask_path: Path | None = None,
    ) -> Sequence[LayerArtifact]:
        return await asyncio.to_thread(
            self._segment_sync,
            image,
            tuple(candidates),
            workdir,
            correction,
            mask_path,
        )

    def _segment_sync(
        self,
        image: Path,
        candidates: tuple[Candidate, ...],
        workdir: Path,
        correction: CorrectionRequest | None,
        mask_path: Path | None,
    ) -> tuple[LayerArtifact, ...]:
        np, cv2 = _image_modules()
        with Image.open(image) as source_image:
            source = np.asarray(source_image.convert("RGB"))
        height, width = source.shape[:2]
        artifacts: list[LayerArtifact] = []
        for index, candidate in enumerate(candidates):
            if index == 0 and correction is not None and mask_path is not None:
                mask = _load_mask(mask_path, width, height, np, cv2)
            else:
                mask = self._predict_mask(source, candidate, width, height, np, cv2)
            if not bool(np.any(mask)):
                raise BackendUnavailable(
                    f"SAM2 returned an empty mask for candidate '{candidate.name}'"
                )
            output = workdir / f"segmented-{index:02d}.png"
            rgba = np.empty((height, width, 4), dtype=np.uint8)
            rgba[:, :, :3] = source
            rgba[:, :, 3] = mask
            Image.fromarray(rgba, "RGBA").save(output, "PNG", optimize=False)
            del rgba, mask
            artifacts.append(
                LayerArtifact(
                    candidate=candidate,
                    rgba_path=output,
                    confidence=candidate.confidence,
                )
            )
        return tuple(artifacts)

    def _predict_mask(
        self,
        image: Any,
        candidate: Candidate,
        width: int,
        height: int,
        np: Any,
        cv2: Any,
    ) -> Any:
        try:
            results = self._model.predict(
                # Feed the decoded RGB array so uploads without a filename
                # extension (and all Pillow-supported raster formats) work
                # consistently across Ultralytics versions.
                source=image,
                bboxes=[list(candidate.bounding_box)],
                device=self._device,
                verbose=False,
            )
            if not results or getattr(results[0], "masks", None) is None:
                raise BackendUnavailable("SAM2 returned no mask")
            masks = results[0].masks.data
            if len(masks) == 0:
                raise BackendUnavailable("SAM2 returned no mask")
            raw = masks[0]
            if hasattr(raw, "detach"):
                raw = raw.detach()
            if hasattr(raw, "cpu"):
                raw = raw.cpu()
            if hasattr(raw, "numpy"):
                raw = raw.numpy()
            mask = np.asarray(raw)
            if mask.shape != (height, width):
                mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR)
            return np.where(mask >= 0.5, 255, 0).astype(np.uint8)
        except BackendUnavailable:
            raise
        except Exception as exc:
            raise BackendUnavailable(f"local SAM2 segmentation failed: {exc}") from exc


class OpenCvMatting:
    """Cleans SAM2 masks while keeping the source RGB pixels unchanged."""

    async def refine(
        self, image: Path, layers: Sequence[LayerArtifact], workdir: Path
    ) -> Sequence[LayerArtifact]:
        del image
        return await asyncio.to_thread(self._refine_sync, tuple(layers), workdir)

    def _refine_sync(
        self, layers: tuple[LayerArtifact, ...], workdir: Path
    ) -> tuple[LayerArtifact, ...]:
        np, cv2 = _image_modules()
        refined: list[LayerArtifact] = []
        for index, layer in enumerate(layers):
            rgba = cv2.imread(str(layer.rgba_path), cv2.IMREAD_UNCHANGED)
            if rgba is None or rgba.ndim != 3 or rgba.shape[2] != 4:
                raise BackendUnavailable("SAM2 produced an invalid RGBA layer")
            alpha = _refine_alpha_mask(
                rgba[:, :, 3], layer.candidate.bounding_box, np, cv2
            )
            if not bool(np.any(alpha)):
                raise BackendUnavailable("alpha refinement removed an entire layer")
            rgba[:, :, 3] = alpha
            output = workdir / f"refined-{index:02d}.png"
            if not cv2.imwrite(str(output), rgba, [cv2.IMWRITE_PNG_COMPRESSION, 3]):
                raise BackendUnavailable("failed to write a refined layer")
            refined.append(
                LayerArtifact(layer.candidate, output, layer.confidence)
            )
            del rgba, alpha
        return tuple(refined)


def _refine_alpha_mask(
    alpha: Any,
    bbox: tuple[int, int, int, int],
    np: Any,
    cv2: Any,
) -> Any:
    """Keep the prompted subject, repair small holes, and antialias its edge."""
    height, width = alpha.shape
    x1, y1, x2, y2 = bbox
    margin = max(2, min(24, round(max(x2 - x1, y2 - y1) * 0.06)))
    allowed = np.zeros((height, width), dtype=np.uint8)
    allowed[
        max(0, y1 - margin) : min(height, y2 + margin),
        max(0, x1 - margin) : min(width, x2 + margin),
    ] = 255

    binary = np.where((alpha >= 96) & (allowed > 0), 255, 0).astype(np.uint8)
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if component_count <= 1:
        return np.zeros_like(alpha, dtype=np.uint8)

    areas = stats[1:, cv2.CC_STAT_AREA]
    largest_label = int(np.argmax(areas)) + 1
    largest_area = int(stats[largest_label, cv2.CC_STAT_AREA])
    min_component_area = max(8, round(largest_area * 0.015))
    cleaned = np.zeros_like(binary)
    for label in range(1, component_count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if label == largest_label or area >= min_component_area:
            cleaned[labels == label] = 255

    cleaned = _fill_small_mask_holes(cleaned, largest_area, np, cv2)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)

    # Ultralytics exposes thresholded SAM2 masks at this API level. A narrow
    # Gaussian edge is therefore the most stable version-independent alpha.
    feathered = cv2.GaussianBlur(cleaned, (0, 0), sigmaX=0.65, sigmaY=0.65)
    solid_core = cv2.erode(cleaned, kernel, iterations=1)
    feathered[solid_core > 0] = 255
    feathered[allowed == 0] = 0
    return feathered.astype(np.uint8)


def _fill_small_mask_holes(
    binary: Any, foreground_area: int, np: Any, cv2: Any
) -> Any:
    inverse = cv2.bitwise_not(binary)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(inverse, 8)
    if count <= 1:
        return binary
    maximum_hole_area = max(8, round(foreground_area * 0.01))
    height, width = binary.shape
    filled = binary.copy()
    for label in range(1, count):
        left = int(stats[label, cv2.CC_STAT_LEFT])
        top = int(stats[label, cv2.CC_STAT_TOP])
        component_width = int(stats[label, cv2.CC_STAT_WIDTH])
        component_height = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        touches_border = (
            left == 0
            or top == 0
            or left + component_width == width
            or top + component_height == height
        )
        if not touches_border and area <= maximum_hole_area:
            filled[labels == label] = 255
    return filled


class GeometricDepthEstimator:
    """Orders back-to-front using the lower image contact point and object area."""

    async def order(
        self, image: Path, layers: Sequence[LayerArtifact]
    ) -> Sequence[str]:
        del image
        ordered = sorted(
            layers,
            key=lambda layer: (
                layer.candidate.bounding_box[3],
                _box_area(layer.candidate.bounding_box),
                layer.candidate.candidate_id,
            ),
        )
        return tuple(layer.candidate.candidate_id for layer in ordered)


class OpenCvInpainter:
    def __init__(self, radius: float) -> None:
        self._radius = radius

    async def remove_layers(
        self, image: Path, layers: Sequence[LayerArtifact], workdir: Path
    ) -> BackgroundArtifact:
        return await asyncio.to_thread(
            self._remove_sync, image, tuple(layers), workdir
        )

    def _remove_sync(
        self, image: Path, layers: tuple[LayerArtifact, ...], workdir: Path
    ) -> BackgroundArtifact:
        np, cv2 = _image_modules()
        source = cv2.imread(str(image), cv2.IMREAD_COLOR)
        if source is None:
            raise BackendUnavailable("OpenCV could not decode the source image")
        mask = np.zeros(source.shape[:2], dtype=np.uint8)
        for layer in layers:
            rgba = cv2.imread(str(layer.rgba_path), cv2.IMREAD_UNCHANGED)
            if rgba is None or rgba.ndim != 3 or rgba.shape[2] != 4:
                raise BackendUnavailable("matting produced an invalid RGBA layer")
            mask = cv2.bitwise_or(mask, rgba[:, :, 3])
            del rgba
        # Keep the antialias fringe from the source background so recomposition
        # stays lossless; only fully opaque subject pixels need reconstruction.
        binary = np.where(mask >= 254, 255, 0).astype(np.uint8)
        if not bool(np.any(binary)):
            raise BackendUnavailable("no foreground pixels are available for inpainting")
        background = cv2.inpaint(source, binary, self._radius, cv2.INPAINT_TELEA)
        output = workdir / "background.png"
        if not cv2.imwrite(str(output), background, [cv2.IMWRITE_PNG_COMPRESSION, 3]):
            raise BackendUnavailable("failed to write the inpainted background")
        coverage = float(np.count_nonzero(binary)) / float(binary.size)
        confidence = max(0.5, min(0.95, 1.0 - coverage * 0.5))
        return BackgroundArtifact(output, confidence)


class ReconstructionQualityEvaluator:
    def __init__(self, max_pixels: int) -> None:
        self._max_pixels = max_pixels

    async def evaluate(
        self,
        source: Path,
        background: Path,
        layers: Sequence[LayerArtifact],
    ) -> QualityMetrics:
        return await asyncio.to_thread(
            self._evaluate_sync, source, background, tuple(layers)
        )

    def _evaluate_sync(
        self,
        source: Path,
        background: Path,
        layers: tuple[LayerArtifact, ...],
    ) -> QualityMetrics:
        np, _ = _image_modules()
        try:
            from skimage.metrics import structural_similarity
        except ImportError as exc:
            raise BackendUnavailable(
                "local quality evaluation requires scikit-image; install the 'local' extra"
            ) from exc

        _validate_layer_masks(source, layers, np, self._max_pixels)
        with Image.open(source) as source_image:
            original = source_image.convert("RGBA")
            size = _bounded_size(original.size, self._max_pixels)
            if original.size != size:
                original = original.resize(size, Image.Resampling.NEAREST)
            with Image.open(background) as background_image:
                composite = background_image.convert("RGBA")
                if composite.size != size:
                    composite = composite.resize(size, Image.Resampling.NEAREST)
            for layer in layers:
                with Image.open(layer.rgba_path) as layer_image:
                    foreground = layer_image.convert("RGBA")
                    if foreground.size != size:
                        foreground = foreground.resize(size, Image.Resampling.NEAREST)
                    composite = Image.alpha_composite(composite, foreground)

            original_array = np.asarray(original.convert("RGB"), dtype=np.uint8)
            composite_array = np.asarray(composite.convert("RGB"), dtype=np.uint8)
        delta = np.abs(
            original_array.astype(np.int16) - composite_array.astype(np.int16)
        )
        within_one = float(np.mean(delta <= 1))
        min_side = min(original_array.shape[:2])
        if min_side >= 3:
            window = min(7, min_side if min_side % 2 else min_side - 1)
            ssim = float(
                structural_similarity(
                    original_array,
                    composite_array,
                    channel_axis=2,
                    data_range=255,
                    win_size=window,
                )
            )
        else:
            mse = float(np.mean(delta.astype(np.float32) ** 2))
            ssim = max(0.0, 1.0 - mse / (255.0 * 255.0))
        ssim = max(0.0, min(1.0, ssim))
        passed = ssim >= 0.999 and within_one >= 0.999
        return QualityMetrics(
            ssim=ssim,
            channel_error_within_one_ratio=within_one,
            passed=passed,
        )


def _validate_layer_masks(
    source: Path, layers: tuple[LayerArtifact, ...], np: Any, max_pixels: int
) -> None:
    try:
        with Image.open(source) as source_image:
            original_size = source_image.size
            bounded_size = _bounded_size(original_size, max_pixels)
            source_rgb = np.asarray(
                source_image.convert("RGB").resize(
                    bounded_size, Image.Resampling.NEAREST
                ),
                dtype=np.uint8,
            )
    except OSError as exc:
        raise BackendUnavailable("quality evaluator could not decode the source image") from exc

    height, width = source_rgb.shape[:2]
    original_width, original_height = original_size
    scale_x = width / original_width
    scale_y = height / original_height
    occupied: list[tuple[Any, int]] = []
    bit_counts = np.unpackbits(
        np.arange(256, dtype=np.uint8)[:, None], axis=1
    ).sum(axis=1)
    for layer in layers:
        try:
            with Image.open(layer.rgba_path) as layer_image:
                rgba = np.asarray(
                    layer_image.convert("RGBA").resize(
                        (width, height), Image.Resampling.NEAREST
                    ),
                    dtype=np.uint8,
                )
        except OSError as exc:
            raise BackendUnavailable("quality evaluator could not decode a layer") from exc
        if rgba.shape[:2] != (height, width):
            raise BackendUnavailable("layer quality check found an invalid canvas size")
        alpha = rgba[:, :, 3]
        visible = alpha >= 16
        visible_pixels = int(np.count_nonzero(visible))
        if visible_pixels == 0:
            raise BackendUnavailable("layer quality check found an empty alpha mask")
        if not bool(np.array_equal(rgba[:, :, :3], source_rgb)):
            raise BackendUnavailable("layer quality check found modified source RGB pixels")

        source_x1, source_y1, source_x2, source_y2 = layer.candidate.bounding_box
        x1 = max(0, min(width, round(source_x1 * scale_x)))
        y1 = max(0, min(height, round(source_y1 * scale_y)))
        x2 = max(x1 + 1, min(width, round(source_x2 * scale_x)))
        y2 = max(y1 + 1, min(height, round(source_y2 * scale_y)))
        box_area = max(1, (x2 - x1) * (y2 - y1))
        if visible_pixels < max(8, round(box_area * 0.015)):
            raise BackendUnavailable("layer quality check found insufficient subject coverage")
        inside_pixels = int(np.count_nonzero(visible[y1:y2, x1:x2]))
        leakage = (visible_pixels - inside_pixels) / visible_pixels
        if leakage > 0.3:
            raise BackendUnavailable("layer quality check found excessive background leakage")

        packed = np.packbits(visible)
        for previous, previous_pixels in occupied:
            overlap = int(bit_counts[np.bitwise_and(packed, previous)].sum())
            smaller = min(visible_pixels, previous_pixels)
            if smaller and overlap / smaller > 0.72:
                raise BackendUnavailable("layer quality check found duplicate overlapping layers")
        occupied.append((packed, visible_pixels))


class LocalArtifactPublisher:
    """Atomically streams artifacts into the owning task's bounded temp directory."""

    def __init__(self, max_total_bytes: int) -> None:
        self._roots: dict[str, Path] = {}
        self._published_bytes: dict[str, int] = {}
        self._max_total_bytes = max_total_bytes
        self._lock = asyncio.Lock()

    async def bind_request(self, request: BackendRequest) -> None:
        root = request.image.path.parent / "local-assets"
        async with self._lock:
            active = {key for key, value in self._roots.items() if value.parent.exists()}
            self._roots = {key: value for key, value in self._roots.items() if key in active}
            self._published_bytes = {
                key: value for key, value in self._published_bytes.items() if key in active
            }
            self._roots[request.request_id] = root
            self._published_bytes.setdefault(request.request_id, 0)

    async def publish(self, path: Path, object_key: str, content_type: str) -> str:
        if content_type != "image/png":
            raise BackendUnavailable("local publisher only accepts PNG artifacts")
        key = _safe_object_key(object_key)
        request_id = key.parts[0]
        try:
            artifact_bytes = path.stat().st_size
        except OSError as exc:
            raise BackendUnavailable("local publisher received a missing artifact") from exc
        async with self._lock:
            root = self._roots.get(request_id)
            if root is None:
                raise BackendUnavailable("local publisher has no bound task destination")
            used = sum(self._published_bytes.values())
            if used + artifact_bytes > self._max_total_bytes:
                raise BackendUnavailable(
                    "local artifact storage limit would be exceeded"
                )
            destination = root.joinpath(*key.parts)
            try:
                destination.parent.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(_copy_atomic, path, destination)
            except OSError as exc:
                raise BackendUnavailable(f"failed to publish a local artifact: {exc}") from exc
            self._published_bytes[request_id] = (
                self._published_bytes.get(request_id, 0) + artifact_bytes
            )
        task_id = request_id.rsplit("-r", 1)[0]
        return f"/api/layer-decompositions/{task_id}/assets/{key.as_posix()}"

    async def discard_prefix(self, prefix: str) -> None:
        request_id = prefix.rstrip("/")
        if not _valid_attempt_id(request_id):
            return
        async with self._lock:
            root = self._roots.pop(request_id, None)
            self._published_bytes.pop(request_id, None)
        if root is None:
            return
        destination = root / request_id
        await asyncio.to_thread(_remove_local_tree, destination, root)


def create_local_backend(settings: Settings) -> LocalModelBackend:
    detector_path = _required_weight(
        settings.local_detector_weights,
        "LAYER_DECOMPOSER_LOCAL_DETECTOR_WEIGHTS",
    )
    segmenter_path = _required_weight(
        settings.local_segmenter_weights,
        "LAYER_DECOMPOSER_LOCAL_SEGMENTER_WEIGHTS",
    )
    _validate_sam2_weight_path(segmenter_path)
    try:
        from ultralytics import YOLO
        _image_modules()
        from skimage.metrics import structural_similarity as _
    except ImportError as exc:
        dependency = getattr(exc, "name", None) or str(exc)
        raise BackendUnavailable(
            f"local backend dependency '{dependency}' is missing; install with pip install -e '.[local]'"
        ) from exc
    try:
        detector_model = YOLO(str(detector_path))
        segmenter_model = _load_sam2_model(segmenter_path)
    except Exception as exc:
        raise BackendUnavailable(f"local model weights failed to load: {exc}") from exc

    publisher = LocalArtifactPublisher(settings.task_max_storage_bytes)
    components = OrchestrationComponents(
        grounding_dino=LocalCandidateDetector(
            detector_model,
            settings.local_device,
            settings.local_detection_confidence,
            settings.local_detection_iou,
        ),
        sam2=Sam2Segmenter(segmenter_model, settings.local_device),
        ocr=EmptyOcr(),
        matting=OpenCvMatting(),
        depth=GeometricDepthEstimator(),
        inpainting=OpenCvInpainter(settings.local_inpaint_radius),
        publisher=publisher,
        quality=ReconstructionQualityEvaluator(settings.local_quality_pixels),
    )
    return LocalModelBackend(
        OrchestrationBackend(components),
        publisher,
        settings.local_max_working_pixels,
    )


def _load_sam2_model(path: Path) -> Any:
    """Load SAM2 without silently accepting a SAM1 weight file."""
    _validate_sam2_weight_path(path)
    try:
        from ultralytics import SAM2  # type: ignore[attr-defined]
    except ImportError:
        # Older Ultralytics releases expose SAM2 through the shared SAM facade.
        from ultralytics import SAM

        return SAM(str(path))
    return SAM2(str(path))


def _validate_sam2_weight_path(path: Path) -> None:
    if "sam2" not in path.stem.lower():
        raise BackendUnavailable(
            "LAYER_DECOMPOSER_LOCAL_SEGMENTER_WEIGHTS must point to a SAM2 weight file"
        )


def parse_supplied_candidates(
    prompt: str | None, image: Path, limit: int
) -> tuple[Candidate, ...]:
    if not prompt or _CANDIDATE_MARKER not in prompt:
        return ()
    payload_text = prompt.split(_CANDIDATE_MARKER, 1)[1].lstrip()
    try:
        payload, _ = json.JSONDecoder().raw_decode(payload_text)
        values = payload.get("candidates") if isinstance(payload, dict) else None
        if not isinstance(values, list):
            return ()
        with Image.open(image) as source:
            width, height = source.size
        parsed: list[Candidate] = []
        for index, value in enumerate(values[:limit]):
            candidate = _parse_candidate(value, index, width, height)
            if candidate is not None:
                parsed.append(candidate)
        return tuple(parsed)
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return ()


def _parse_candidate(
    value: Any, index: int, width: int, height: int
) -> Candidate | None:
    if not isinstance(value, dict):
        return None
    bbox = value.get("bbox")
    if (
        not isinstance(bbox, (list, tuple))
        or len(bbox) != 4
        or any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in bbox)
    ):
        return None
    x1, y1, x2, y2 = (float(item) for item in bbox)
    if not (0 <= x1 < x2 <= 1000 and 0 <= y1 < y2 <= 1000):
        return None
    absolute = (
        max(0, min(width - 1, round(x1 * width / 1000))),
        max(0, min(height - 1, round(y1 * height / 1000))),
        max(1, min(width, round(x2 * width / 1000))),
        max(1, min(height, round(y2 * height / 1000))),
    )
    if absolute[0] >= absolute[2] or absolute[1] >= absolute[3]:
        return None
    confidence_value = value.get("confidence", 0.8)
    if isinstance(confidence_value, bool) or not isinstance(
        confidence_value, (int, float)
    ):
        confidence_value = 0.8
    confidence = max(0.0, min(1.0, float(confidence_value)))
    name = str(value.get("name") or f"object-{index + 1}").strip()[:200]
    description = str(value.get("description") or "Vision-model candidate").strip()[:1000]
    raw_id = str(value.get("id") or f"provided-{index + 1}")
    sanitized_id = "".join(
        character for character in raw_id if character.isalnum() or character in "-_"
    )[:100]
    candidate_id = f"provided-{sanitized_id or index + 1}"
    return Candidate(
        candidate_id=candidate_id,
        name=name or f"object-{index + 1}",
        description=description,
        bounding_box=absolute,
        confidence=confidence,
    )


def _required_weight(value: str | None, variable: str) -> Path:
    if not value:
        raise BackendUnavailable(f"{variable} is not configured")
    path = Path(value).expanduser()
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise BackendUnavailable(f"{variable} does not point to an existing file") from exc
    if not resolved.is_file():
        raise BackendUnavailable(f"{variable} must point to a model weight file")
    return resolved


def _image_modules() -> tuple[Any, Any]:
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise BackendUnavailable(
            "local image processing requires numpy and opencv-python; install the 'local' extra"
        ) from exc
    return np, cv2


def _tensor_values(value: Any) -> list[float]:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "tolist"):
        value = value.tolist()
    return [float(item) for item in value]


def _tensor_scalar(value: Any) -> float:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "item"):
        value = value.item()
    return float(value)


def _load_mask(
    path: Path, width: int, height: int, np: Any, cv2: Any
) -> Any:
    try:
        with Image.open(path) as image:
            mask = np.asarray(image.convert("L"))
    except OSError as exc:
        raise BackendUnavailable("correction mask could not be decoded") from exc
    if mask.shape != (height, width):
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
    return np.where(mask >= 128, 255, 0).astype(np.uint8)


def _box_area(box: tuple[int, int, int, int]) -> int:
    return (box[2] - box[0]) * (box[3] - box[1])


def _bounded_size(size: tuple[int, int], max_pixels: int) -> tuple[int, int]:
    width, height = size
    pixels = width * height
    if pixels <= max_pixels:
        return size
    scale = math.sqrt(max_pixels / pixels)
    return max(1, round(width * scale)), max(1, round(height * scale))


def _safe_object_key(value: str) -> PurePosixPath:
    key = PurePosixPath(value)
    if key.is_absolute() or ".." in key.parts or len(key.parts) < 2:
        raise BackendUnavailable("local publisher received an unsafe object key")
    if not _valid_attempt_id(key.parts[0]):
        raise BackendUnavailable("local publisher received an invalid request id")
    if key.suffix.lower() != ".png":
        raise BackendUnavailable("local publisher only accepts PNG object keys")
    return key


def _valid_attempt_id(value: str) -> bool:
    task_id, separator, revision = value.rpartition("-r")
    return (
        separator == "-r"
        and len(task_id) == 32
        and all(character in "0123456789abcdef" for character in task_id)
        and revision.isdigit()
    )


def _copy_atomic(source: Path, destination: Path) -> None:
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        with source.open("rb") as input_file, temporary.open("wb") as output_file:
            shutil.copyfileobj(input_file, output_file, length=_COPY_CHUNK_SIZE)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _remove_local_tree(path: Path, root: Path) -> None:
    try:
        resolved_path = path.resolve()
        resolved_root = root.resolve()
    except OSError:
        return
    if resolved_root in resolved_path.parents and _valid_attempt_id(resolved_path.name):
        shutil.rmtree(resolved_path, ignore_errors=True)
