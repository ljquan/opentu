from __future__ import annotations

import asyncio
import sys

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from layer_decomposer.app import create_app
from layer_decomposer.backend import BackendRequest, load_backend
from layer_decomposer.config import Settings
from layer_decomposer.errors import BackendUnavailable
from layer_decomposer.local_backend import (
    OpenCvMatting,
    ReconstructionQualityEvaluator,
    _refine_alpha_mask,
    create_local_backend,
    parse_supplied_candidates,
)
from layer_decomposer.orchestration import (
    Candidate,
    LayerArtifact,
    OrchestrationBackend,
    OrchestrationComponents,
    _filter_redundant_candidates,
    _is_background_structure_candidate,
    _prepare_layer_for_publish,
)
from layer_decomposer.contracts import DecompositionMode
from layer_decomposer.image_input import ImageAsset


def _image(path, size=(10, 20)):
    Image.new("RGB", size, (12, 34, 56)).save(path, "PNG")
    return path


def test_candidate_prompt_is_reused_and_normalized(tmp_path) -> None:
    image = _image(tmp_path / "source.png")
    prompt = (
        "__opentu_layer_candidates__"
        '{"candidates":[{"id":"person/1","name":"人物",'
        '"description":"主体","bbox":[100,200,900,800],"confidence":0.93}]}'
    )
    candidates = parse_supplied_candidates(prompt, image, 4)
    assert len(candidates) == 1
    assert candidates[0].candidate_id == "provided-person1"
    assert candidates[0].bounding_box == (1, 4, 9, 16)
    assert candidates[0].confidence == 0.93


def test_candidate_prompt_rejects_invalid_boxes(tmp_path) -> None:
    image = _image(tmp_path / "source.png")
    prompt = '__opentu_layer_candidates__{"candidates":[{"bbox":[1,2,900,1001]}]}'
    assert parse_supplied_candidates(prompt, image, 4) == ()


def test_nested_lower_confidence_detector_box_is_removed() -> None:
    parent = Candidate("plant", "potted plant", "", (10, 10, 80, 90), 0.8)
    child = Candidate("vase", "vase", "", (12, 45, 42, 88), 0.4)
    distinct = Candidate("flower", "flower", "", (55, 20, 90, 50), 0.7)

    assert _filter_redundant_candidates((parent, child, distinct)) == (parent, distinct)


def test_background_structure_hint_is_not_published_as_a_foreground_layer() -> None:
    railing = Candidate(
        "railing",
        "阳台黑色栏杆",
        "背景中的黑色金属阳台栏杆结构",
        (400, 0, 1000, 500),
        0.72,
    )
    cat = Candidate(
        "cat",
        "猫",
        "画面中央的猫，可作为独立图层",
        (300, 300, 700, 900),
        0.99,
    )

    assert _is_background_structure_candidate(railing) is True
    assert _is_background_structure_candidate(cat) is False


def test_publish_layer_is_cropped_to_visible_alpha_bounds(tmp_path) -> None:
    source = tmp_path / "full-canvas.png"
    image = Image.new("RGBA", (20, 10), (0, 0, 0, 0))
    image.paste((12, 34, 56, 255), (3, 2, 17, 9))
    image.save(source, "PNG")
    candidate = Candidate("subject", "主体", "", (2, 1, 18, 10), 0.9)

    published = _prepare_layer_for_publish(
        LayerArtifact(candidate, source, 0.9), tmp_path, 1
    )

    assert published.candidate.bounding_box == (3, 2, 17, 9)
    with Image.open(published.rgba_path) as cropped:
        assert cropped.size == (14, 7)


def test_alpha_refinement_removes_fragments_fills_small_holes_and_keeps_soft_edge() -> None:
    np = pytest.importorskip("numpy")
    cv2 = pytest.importorskip("cv2")
    alpha = np.zeros((80, 100), dtype=np.uint8)
    alpha[20:65, 25:75] = 255
    alpha[40:43, 45:48] = 0
    alpha[2:5, 2:5] = 255

    refined = _refine_alpha_mask(alpha, (20, 15, 80, 70), np, cv2)

    assert refined[3, 3] == 0
    assert refined[41, 46] == 255
    assert refined[35, 50] == 255
    assert bool(np.any((refined > 0) & (refined < 255)))


def test_matting_preserves_source_rgb_and_limits_mask_to_candidate_region(tmp_path) -> None:
    source = tmp_path / "source.png"
    image = Image.new("RGB", (100, 80), (12, 34, 56))
    image.save(source, "PNG")
    segmented = tmp_path / "segmented.png"
    rgba = Image.new("RGBA", (100, 80), (12, 34, 56, 0))
    rgba.putalpha(Image.new("L", (100, 80), 255))
    rgba.save(segmented, "PNG")
    candidate = Candidate("subject", "subject", "", (20, 15, 80, 70), 0.9)

    result = asyncio.run(
        OpenCvMatting().refine(
            source, (LayerArtifact(candidate, segmented, 0.9),), tmp_path
        )
    )

    with Image.open(result[0].rgba_path) as refined:
        assert refined.convert("RGB").tobytes() == image.tobytes()
        assert refined.getchannel("A").getbbox() == (16, 11, 84, 74)


def test_layer_quality_rejects_background_leakage(tmp_path) -> None:
    source = _image(tmp_path / "source.png", (100, 100))
    layer_path = tmp_path / "layer.png"
    layer = Image.new("RGBA", (100, 100), (12, 34, 56, 255))
    layer.save(layer_path, "PNG")
    candidate = Candidate("subject", "subject", "", (30, 30, 70, 70), 0.9)
    background = _image(tmp_path / "background.png", (100, 100))

    with pytest.raises(BackendUnavailable, match="background leakage"):
        asyncio.run(
            ReconstructionQualityEvaluator(10_000).evaluate(
                source,
                background,
                (LayerArtifact(candidate, layer_path, 0.9),),
            )
        )


def test_orchestration_does_not_publish_when_quality_gate_fails(tmp_path) -> None:
    image = _image(tmp_path / "source.png", (10, 20))
    candidate = Candidate("subject", "subject", "", (1, 2, 9, 18), 0.9)

    class Detector:
        async def detect(self, image, prompt, limit):
            del image, prompt, limit
            return (candidate,)

    class Ocr:
        async def detect_text(self, image, limit):
            del image, limit
            return ()

    class Segmenter:
        async def segment(self, image, candidates, workdir, correction=None, mask_path=None):
            del image, correction, mask_path
            path = workdir / "layer.png"
            Image.new("RGBA", (10, 20), (12, 34, 56, 255)).save(path, "PNG")
            return (LayerArtifact(candidates[0], path, 0.9),)

    class Matting:
        async def refine(self, image, layers, workdir):
            del image, workdir
            return layers

    class Depth:
        async def order(self, image, layers):
            del image
            return (layers[0].candidate.candidate_id,)

    class Inpainting:
        async def remove_layers(self, image, layers, workdir):
            del layers
            path = workdir / "background.png"
            Image.open(image).save(path, "PNG")
            from layer_decomposer.orchestration import BackgroundArtifact

            return BackgroundArtifact(path, 0.9)

    class Quality:
        async def evaluate(self, source, background, layers):
            del source, background, layers
            from layer_decomposer.contracts import QualityMetrics

            return QualityMetrics(ssim=0.5, channel_error_within_one_ratio=0.5, passed=False)

    class Publisher:
        def __init__(self):
            self.published = []

        async def publish(self, path, object_key, content_type):
            self.published.append((path, object_key, content_type))
            return f"/assets/{object_key}"

        async def discard_prefix(self, prefix):
            del prefix

    publisher = Publisher()
    backend = OrchestrationBackend(
        OrchestrationComponents(
            grounding_dino=Detector(),
            sam2=Segmenter(),
            ocr=Ocr(),
            matting=Matting(),
            depth=Depth(),
            inpainting=Inpainting(),
            publisher=publisher,
            quality=Quality(),
        )
    )
    request = BackendRequest(
        request_id="0123456789abcdef0123456789abcdef-r0",
        image=ImageAsset(image, 10, 20, "image/png", "hash"),
        prompt=None,
        mode=DecompositionMode.AUTO,
        max_layers=1,
    )

    with pytest.raises(BackendUnavailable, match="quality gate"):
        asyncio.run(backend.decompose(request))
    assert publisher.published == []


def test_empty_detection_fails_without_a_synthetic_full_canvas_layer(tmp_path) -> None:
    image = _image(tmp_path / "source.png")

    class EmptyDetector:
        async def detect(self, image, prompt, limit):
            del image, prompt, limit
            return ()

    class EmptyOcr:
        async def detect_text(self, image, limit):
            del image, limit
            return ()

    backend = OrchestrationBackend(
        OrchestrationComponents(
            grounding_dino=EmptyDetector(),
            sam2=object(),
            ocr=EmptyOcr(),
            matting=object(),
            depth=object(),
            inpainting=object(),
            publisher=object(),
            quality=object(),
        )
    )
    request = BackendRequest(
        request_id="empty-detection",
        image=ImageAsset(image, 10, 20, "image/png", "hash"),
        prompt=None,
        mode=DecompositionMode.AUTO,
        max_layers=1,
    )

    with pytest.raises(BackendUnavailable, match="no decomposable foreground"):
        asyncio.run(backend.decompose(request))


def test_local_factory_requires_explicit_weights() -> None:
    settings = Settings()
    try:
        create_local_backend(settings)
    except BackendUnavailable as exc:
        assert "LAYER_DECOMPOSER_LOCAL_DETECTOR_WEIGHTS" in str(exc)
    else:
        raise AssertionError("local backend must not start without explicit weights")


def test_health_reports_missing_local_weights() -> None:
    client = TestClient(
        create_app(
            Settings(
                backend_factory="layer_decomposer.local_backend:create_local_backend"
            )
        )
    )
    response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["backend_ready"] is False
    assert "LAYER_DECOMPOSER_LOCAL_DETECTOR_WEIGHTS" in response.json()["reason"]


def test_ark_key_does_not_enable_an_implicit_backend() -> None:
    backend = load_backend(Settings(ark_api_key="not-used"))
    assert backend.is_ready is False
    assert "local decomposition backend" in (backend.unavailable_reason or "")


def test_ark_adapter_requires_an_explicit_model() -> None:
    from layer_decomposer.volcengine import VolcengineLayerBackend

    try:
        VolcengineLayerBackend(
            Settings(
                ark_api_key="secret",
                ark_endpoint="https://ark.example.com/images/generations",
            )
        )
    except BackendUnavailable as exc:
        assert "LAYER_DECOMPOSER_ARK_MODEL" in str(exc)
    else:
        raise AssertionError("the opt-in Ark adapter must not choose a model implicitly")


def test_health_reports_missing_local_dependency(tmp_path, monkeypatch) -> None:
    detector = tmp_path / "detector.pt"
    segmenter = tmp_path / "sam2.pt"
    detector.write_bytes(b"explicit-local-weight-placeholder")
    segmenter.write_bytes(b"explicit-local-weight-placeholder")
    monkeypatch.setitem(sys.modules, "ultralytics", None)
    client = TestClient(
        create_app(
            Settings(
                backend_factory="layer_decomposer.local_backend:create_local_backend",
                local_detector_weights=str(detector),
                local_segmenter_weights=str(segmenter),
            )
        )
    )
    response = client.get("/healthz")
    assert response.status_code == 503
    assert "dependency 'ultralytics' is missing" in response.json()["reason"]


def test_local_factory_rejects_non_sam2_segmenter_weight(tmp_path) -> None:
    detector = tmp_path / "detector.pt"
    segmenter = tmp_path / "sam_b.pt"
    detector.write_bytes(b"placeholder")
    segmenter.write_bytes(b"placeholder")
    try:
        create_local_backend(
            Settings(
                local_detector_weights=str(detector),
                local_segmenter_weights=str(segmenter),
            )
        )
    except BackendUnavailable as exc:
        assert "SAM2" in str(exc)
    else:
        raise AssertionError("SAM1 weights must not be accepted as a SAM2 backend")
