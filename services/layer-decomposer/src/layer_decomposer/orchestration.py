from __future__ import annotations

import asyncio
import json
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

from PIL import Image

from .backend import BackendRequest, BackendResult, ensure_local_artifact
from .contracts import (
    BackgroundResult,
    BoundingBox,
    CorrectionRequest,
    LayerResult,
    QualityMetrics,
)
from .errors import BackendUnavailable

BBox = tuple[int, int, int, int]
_NORMALIZED_BBOX_PATTERN = re.compile(
    r"<bbox>\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+"
    r"(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*</bbox>",
    re.IGNORECASE,
)
_PROVIDER_CANDIDATES_PREFIX = "__opentu_layer_candidates__"


@dataclass(frozen=True, slots=True)
class Candidate:
    candidate_id: str
    name: str
    description: str
    bounding_box: BBox
    confidence: float


@dataclass(frozen=True, slots=True)
class LayerArtifact:
    candidate: Candidate
    rgba_path: Path
    confidence: float


@dataclass(frozen=True, slots=True)
class BackgroundArtifact:
    path: Path
    confidence: float


class CandidateDetector(Protocol):
    async def detect(
        self, image: Path, prompt: str | None, limit: int
    ) -> Sequence[Candidate]: ...


class Sam2(Protocol):
    async def segment(
        self,
        image: Path,
        candidates: Sequence[Candidate],
        workdir: Path,
        correction: CorrectionRequest | None = None,
        mask_path: Path | None = None,
    ) -> Sequence[LayerArtifact]: ...


class Ocr(Protocol):
    async def detect_text(self, image: Path, limit: int) -> Sequence[Candidate]: ...


class Matting(Protocol):
    async def refine(
        self, image: Path, layers: Sequence[LayerArtifact], workdir: Path
    ) -> Sequence[LayerArtifact]: ...


class DepthEstimator(Protocol):
    async def order(self, image: Path, layers: Sequence[LayerArtifact]) -> Sequence[str]: ...


class Inpainting(Protocol):
    async def remove_layers(
        self, image: Path, layers: Sequence[LayerArtifact], workdir: Path
    ) -> BackgroundArtifact: ...


class ArtifactPublisher(Protocol):
    async def publish(self, path: Path, object_key: str, content_type: str) -> str: ...

    async def discard_prefix(self, prefix: str) -> None: ...


class QualityEvaluator(Protocol):
    async def evaluate(
        self,
        source: Path,
        background: Path,
        layers: Sequence[LayerArtifact],
    ) -> QualityMetrics: ...


@dataclass(frozen=True, slots=True)
class OrchestrationComponents:
    grounding_dino: CandidateDetector
    sam2: Sam2
    ocr: Ocr
    matting: Matting
    depth: DepthEstimator
    inpainting: Inpainting
    publisher: ArtifactPublisher
    quality: QualityEvaluator


class OrchestrationBackend:
    """Provider-neutral detection -> SAM2 -> matting/depth/inpainting pipeline."""

    result_kind = "inference"

    def __init__(self, components: OrchestrationComponents) -> None:
        self._components = components

    @property
    def is_ready(self) -> bool:
        return True

    @property
    def unavailable_reason(self) -> None:
        return None

    async def decompose(self, request: BackendRequest) -> BackendResult:
        with tempfile.TemporaryDirectory(prefix="opentu-layer-pipeline-") as directory:
            workdir = Path(directory)
            detector_prompt, target_bbox = _resolve_target(request)
            hinted = _parse_provider_candidates(
                detector_prompt, request.image.width, request.image.height
            )
            if hinted is not None:
                detector_prompt = None
                detected, text = await asyncio.gather(
                    asyncio.sleep(0, result=hinted),
                    self._components.ocr.detect_text(
                        request.image.path, request.max_layers
                    ),
                )
            else:
                detected, text = await asyncio.gather(
                    self._components.grounding_dino.detect(
                        request.image.path, detector_prompt, request.max_layers
                    ),
                    self._components.ocr.detect_text(
                        request.image.path, request.max_layers
                    ),
                )
            all_candidates = _deduplicate_candidates(
                (*detected, *text), request.image.width, request.image.height
            )
            all_candidates = tuple(
                candidate
                for candidate in all_candidates
                if not _is_background_structure_candidate(
                    candidate, request.image.width, request.image.height
                )
            )
            all_candidates = _filter_redundant_candidates(all_candidates)
            if target_bbox is not None:
                all_candidates = tuple(
                    sorted(
                        all_candidates,
                        key=lambda candidate: _intersection_area(
                            candidate.bounding_box, target_bbox
                        ),
                        reverse=True,
                    )
                )
            if request.correction is not None and request.correction.action == "remove":
                all_candidates = _remove_correction_target(all_candidates, target_bbox)
            candidates = all_candidates[: request.max_layers]
            if not candidates:
                if request.correction is not None and request.correction.action == "remove":
                    raise BackendUnavailable("model pipeline found no decomposable layers")
                raise BackendUnavailable("model pipeline found no decomposable foreground layers")

            segmented = await self._components.sam2.segment(
                request.image.path,
                candidates,
                workdir,
                request.correction,
                request.mask_path,
            )
            refined = tuple(
                await self._components.matting.refine(request.image.path, segmented, workdir)
            )
            _validate_artifacts(refined, candidates, workdir)
            order = tuple(await self._components.depth.order(request.image.path, refined))
            ordered = _apply_depth_order(refined, order)
            background = await self._components.inpainting.remove_layers(
                request.image.path, ordered, workdir
            )
            background_path = ensure_local_artifact(background.path, workdir)
            quality = await self._components.quality.evaluate(
                request.image.path, background_path, ordered
            )
            expected_passed = (
                quality.ssim >= 0.999
                and quality.channel_error_within_one_ratio >= 0.999
            )
            if quality.passed != expected_passed:
                raise BackendUnavailable("quality component returned inconsistent pass status")
            if not quality.passed:
                raise BackendUnavailable("reconstructed layers did not pass the quality gate")

            # The pipeline works on full-canvas RGBA masks for recomposition,
            # while the canvas places each output at its semantic bbox. Publish
            # bbox-sized PNGs so transparent padding is not scaled into the
            # object bounds. Quality is intentionally evaluated before this
            # presentation crop against the full-canvas artifacts.
            published_layers = tuple(
                _prepare_layer_for_publish(artifact, workdir, index)
                for index, artifact in enumerate(ordered, start=1)
            )

            # Publish sequentially so one request cannot open 17 simultaneous image streams.
            background_url = await self._components.publisher.publish(
                background_path,
                f"{request.request_id}/background.png",
                "image/png",
            )
            layers: list[LayerResult] = []
            for z_index, artifact in enumerate(published_layers, start=1):
                layer_path = ensure_local_artifact(artifact.rgba_path, workdir)
                url = await self._components.publisher.publish(
                    layer_path,
                    f"{request.request_id}/layers/{z_index:02d}.png",
                    "image/png",
                )
                candidate = artifact.candidate
                layers.append(
                    LayerResult(
                        url=url,
                        z_index=z_index,
                        bounding_box=BoundingBox(
                            absolute=candidate.bounding_box,
                            normalized=_normalize_bbox(
                                candidate.bounding_box,
                                request.image.width,
                                request.image.height,
                            ),
                        ),
                        name=candidate.name,
                        description=candidate.description,
                        confidence=min(candidate.confidence, artifact.confidence),
                    )
                )
            return BackendResult(
                background=BackgroundResult(
                    url=background_url,
                    bounding_box=BoundingBox(
                        absolute=(0, 0, request.image.width, request.image.height),
                        normalized=(0, 0, 1000, 1000),
                    ),
                    confidence=background.confidence,
                ),
                layers=tuple(layers),
                quality=quality,
                decisions=(
                    (
                        f"omitted {len(all_candidates) - len(candidates)} lower-priority candidates",
                    )
                    if len(all_candidates) > len(candidates)
                    else ()
                ),
            )

    async def discard(self, request_id: str) -> None:
        await self._components.publisher.discard_prefix(f"{request_id}/")


def _resolve_target(request: BackendRequest) -> tuple[str | None, BBox | None]:
    prompt = request.prompt
    target: BBox | None = None
    if prompt:
        match = _NORMALIZED_BBOX_PATTERN.search(prompt)
        if match:
            x1, y1, x2, y2 = (float(value) for value in match.groups())
            if not (0 <= x1 < x2 <= 1000 and 0 <= y1 < y2 <= 1000):
                raise BackendUnavailable("normalized prompt bbox is out of range")
            target = (
                round(x1 * request.image.width / 1000),
                round(y1 * request.image.height / 1000),
                round(x2 * request.image.width / 1000),
                round(y2 * request.image.height / 1000),
            )
            prompt = _NORMALIZED_BBOX_PATTERN.sub("", prompt).strip() or None
    if request.correction is not None and request.correction.bbox is not None:
        x1, y1, x2, y2 = request.correction.bbox
        if x2 <= 1000 and y2 <= 1000:
            target = (
                round(x1 * request.image.width / 1000),
                round(y1 * request.image.height / 1000),
                round(x2 * request.image.width / 1000),
                round(y2 * request.image.height / 1000),
            )
    elif (
        request.correction is not None
        and request.correction.layer_z_index is not None
        and request.correction.layer_z_index <= len(request.previous_layers)
    ):
        target = request.previous_layers[request.correction.layer_z_index - 1].bounding_box.absolute
    return prompt, target


def _parse_provider_candidates(
    prompt: str | None, width: int, height: int
) -> tuple[Candidate, ...] | None:
    if not prompt or not prompt.startswith(_PROVIDER_CANDIDATES_PREFIX):
        return None
    try:
        payload = json.loads(prompt[len(_PROVIDER_CANDIDATES_PREFIX) :])
        raw_candidates = payload.get("candidates")
        if not isinstance(raw_candidates, list):
            return None
        candidates: list[Candidate] = []
        for index, raw in enumerate(raw_candidates[:16]):
            if not isinstance(raw, dict):
                continue
            bbox = raw.get("bbox")
            if (
                not isinstance(bbox, list)
                or len(bbox) != 4
                or not all(isinstance(value, (int, float)) for value in bbox)
            ):
                continue
            normalized = tuple(round(float(value)) for value in bbox)
            if not (
                0 <= normalized[0] < normalized[2] <= 1000
                and 0 <= normalized[1] < normalized[3] <= 1000
            ):
                continue
            confidence = raw.get("confidence", 0.8)
            if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
                continue
            name = raw.get("name")
            description = raw.get("description", "")
            candidates.append(
                Candidate(
                    candidate_id=str(raw.get("id") or f"provider-{index + 1}"),
                    name=str(name).strip()[:128] or f"layer-{index + 1}",
                    description=str(description).strip()[:1000],
                    bounding_box=(
                        round(normalized[0] * width / 1000),
                        round(normalized[1] * height / 1000),
                        round(normalized[2] * width / 1000),
                        round(normalized[3] * height / 1000),
                    ),
                    confidence=float(confidence),
                )
            )
        return tuple(candidates)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _remove_correction_target(
    candidates: Sequence[Candidate], target_bbox: BBox | None
) -> tuple[Candidate, ...]:
    if not candidates or target_bbox is None:
        return tuple(candidates)
    target = max(
        candidates,
        key=lambda candidate: _intersection_area(candidate.bounding_box, target_bbox),
    )
    return tuple(candidate for candidate in candidates if candidate is not target)


def _intersection_area(left: BBox, right: BBox) -> int:
    width = max(0, min(left[2], right[2]) - max(left[0], right[0]))
    height = max(0, min(left[3], right[3]) - max(left[1], right[1]))
    return width * height


def _box_area(box: BBox) -> int:
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _deduplicate_candidates(
    candidates: Sequence[Candidate], width: int, height: int
) -> tuple[Candidate, ...]:
    accepted: list[Candidate] = []
    ids: set[str] = set()
    for candidate in sorted(candidates, key=lambda item: item.confidence, reverse=True):
        if candidate.candidate_id in ids:
            continue
        _validate_bbox(candidate.bounding_box, width, height)
        if any(_iou(candidate.bounding_box, item.bounding_box) >= 0.95 for item in accepted):
            continue
        if not 0 <= candidate.confidence <= 1:
            raise BackendUnavailable("model component returned invalid confidence")
        ids.add(candidate.candidate_id)
        accepted.append(candidate)
    return tuple(accepted)


def _filter_redundant_candidates(
    candidates: Sequence[Candidate],
) -> tuple[Candidate, ...]:
    """Drop nested detector boxes that would create duplicate cutouts.

    Object detectors commonly emit a parent object and a child part (for
    example, a potted plant and its vase). Keep genuinely distinct objects,
    while removing a much smaller, lower-confidence box almost fully covered
    by an already accepted candidate.
    """
    accepted: list[Candidate] = []
    for candidate in candidates:
        candidate_area = _box_area(candidate.bounding_box)
        redundant = False
        for previous in accepted:
            overlap = _intersection_area(candidate.bounding_box, previous.bounding_box)
            smaller_area = min(candidate_area, _box_area(previous.bounding_box))
            if not smaller_area or overlap / smaller_area < 0.9:
                continue
            same_name = candidate.name.casefold() == previous.name.casefold()
            smaller_and_weaker = (
                candidate_area <= _box_area(previous.bounding_box) * 0.55
                and candidate.confidence < previous.confidence * 0.85
            )
            if same_name or smaller_and_weaker:
                redundant = True
                break
        if not redundant:
            accepted.append(candidate)
    return tuple(accepted)


def _is_background_structure_candidate(
    candidate: Candidate, width: int | None = None, height: int | None = None
) -> bool:
    """Reject scene structure that a vision hint mislabeled as an object."""
    name = candidate.name.casefold().replace(" ", "")
    description = candidate.description.casefold().replace(" ", "")
    exact_background_names = {
        "背景",
        "background",
        "backdrop",
        "scene",
        "环境",
        "environment",
    }
    structural_tokens = (
        "栏杆",
        "窗户",
        "窗框",
        "玻璃窗",
        "天空",
        "地板",
        "地面",
        "墙壁",
        "墙面",
        "天花板",
        "建筑背景",
        "城市背景",
        "railing",
        "balustrade",
        "window",
        "windowframe",
        "sky",
        "floor",
        "wall",
        "ceiling",
        "cityscape",
        "backgroundbuilding",
    )
    if name in exact_background_names or any(
        token in name for token in structural_tokens
    ):
        return True
    return (
        ("background" in description)
        and any(token in description for token in structural_tokens)
    )


def _validate_bbox(bbox: BBox, width: int, height: int) -> None:
    x1, y1, x2, y2 = bbox
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        raise BackendUnavailable("model component returned an out-of-bounds bounding box")


def _iou(left: BBox, right: BBox) -> float:
    x1 = max(left[0], right[0])
    y1 = max(left[1], right[1])
    x2 = min(left[2], right[2])
    y2 = min(left[3], right[3])
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    if not intersection:
        return 0
    left_area = (left[2] - left[0]) * (left[3] - left[1])
    right_area = (right[2] - right[0]) * (right[3] - right[1])
    return intersection / (left_area + right_area - intersection)


def _validate_artifacts(
    artifacts: Sequence[LayerArtifact],
    candidates: Sequence[Candidate],
    workdir: Path,
) -> None:
    expected = {candidate.candidate_id: candidate for candidate in candidates}
    actual = {artifact.candidate.candidate_id for artifact in artifacts}
    if actual != set(expected) or len(actual) != len(artifacts):
        raise BackendUnavailable("segmentation pipeline returned incomplete or duplicate layers")
    for artifact in artifacts:
        if artifact.candidate != expected[artifact.candidate.candidate_id]:
            raise BackendUnavailable("segmentation pipeline changed candidate metadata")
        ensure_local_artifact(artifact.rgba_path, workdir)
        if not 0 <= artifact.confidence <= 1:
            raise BackendUnavailable("segmentation pipeline returned invalid confidence")


def _apply_depth_order(
    artifacts: Sequence[LayerArtifact], order: Sequence[str]
) -> tuple[LayerArtifact, ...]:
    by_id = {artifact.candidate.candidate_id: artifact for artifact in artifacts}
    if len(order) != len(by_id) or set(order) != set(by_id):
        raise BackendUnavailable("depth pipeline returned an invalid layer order")
    return tuple(by_id[candidate_id] for candidate_id in order)


def _normalize_bbox(bbox: BBox, width: int, height: int) -> BBox:
    x1, y1, x2, y2 = bbox
    return (
        round(x1 * 1000 / width),
        round(y1 * 1000 / height),
        round(x2 * 1000 / width),
        round(y2 * 1000 / height),
    )


def _prepare_layer_for_publish(
    artifact: LayerArtifact, workdir: Path, index: int
) -> LayerArtifact:
    """Crop a full-canvas RGBA artifact to its non-transparent source bounds."""
    source_path = ensure_local_artifact(artifact.rgba_path, workdir)
    try:
        with Image.open(source_path) as image:
            rgba = image.convert("RGBA")
            alpha_bounds = rgba.getchannel("A").getbbox()
            if alpha_bounds is None:
                raise BackendUnavailable("segmentation artifact has no visible pixels")
            cropped = rgba.crop(alpha_bounds)
            output = workdir / f"published-layer-{index:02d}.png"
            cropped.save(output, "PNG", optimize=False)
    except BackendUnavailable:
        raise
    except (OSError, ValueError) as exc:
        raise BackendUnavailable("failed to prepare a publishable RGBA layer") from exc
    candidate = artifact.candidate
    return LayerArtifact(
        candidate=Candidate(
            candidate_id=candidate.candidate_id,
            name=candidate.name,
            description=candidate.description,
            bounding_box=alpha_bounds,
            confidence=candidate.confidence,
        ),
        rgba_path=output,
        confidence=artifact.confidence,
    )
