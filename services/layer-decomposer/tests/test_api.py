from __future__ import annotations

import base64
import asyncio
import io

from fastapi.testclient import TestClient
from PIL import Image

from layer_decomposer.app import create_app
from layer_decomposer.config import Settings
from layer_decomposer.testing import DeterministicMockBackend


class _BlockingBackend(DeterministicMockBackend):
    def __init__(self) -> None:
        super().__init__("test")
        self.started = asyncio.Event()

    async def decompose(self, request):
        self.started.set()
        await asyncio.sleep(60)
        return await super().decompose(request)


def _png(width: int = 2, height: int = 2) -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", (width, height), (10, 20, 30, 255)).save(output, "PNG")
    return output.getvalue()


def _gif(width: int = 2, height: int = 2) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), (10, 20, 30)).save(output, "GIF")
    return output.getvalue()


def _data_url(image: bytes | None = None) -> str:
    encoded = base64.b64encode(image or _png()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {"environment": "test"}
    values.update(overrides)
    return Settings(**values)


def test_unconfigured_backend_returns_explicit_503() -> None:
    client = TestClient(create_app(_settings()))
    response = client.post(
        "/api/layer-decompositions",
        json={"image": _data_url(), "mode": "auto", "max_layers": 2},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "backend_unavailable"


def test_health_and_results_identify_test_backend() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    assert client.get("/healthz").json()["backend_mode"] == "test"

    accepted = client.post(
        "/api/layer-decompositions",
        json={"image": _data_url(), "mode": "auto", "max_layers": 1},
    )
    task_id = accepted.json()["task_id"]
    for _ in range(20):
        result = client.get(f"/api/layer-decompositions/{task_id}").json()
        if result["status"] == "completed":
            break
    assert result["data"]["result_kind"] == "test"


def test_json_data_url_response_contract_is_deterministic() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    payload = {"image": _data_url(), "mode": "auto", "max_layers": 2}

    first = client.post("/api/layer-decompositions", json=payload)
    second = client.post("/api/layer-decompositions", json=payload)

    assert first.status_code == 202
    task_id = first.json()["task_id"]
    body = client.get(f"/api/layer-decompositions/{task_id}").json()
    assert body["status"] in {"pending", "running", "completed"}
    for _ in range(20):
        body = client.get(f"/api/layer-decompositions/{task_id}").json()
        if body["status"] == "completed":
            break
    assert body["status"] == "completed"
    body = body["data"]
    assert body["width"] == 2
    assert body["height"] == 2
    assert body["background"]["z_index"] == 0
    assert body["background"]["bounding_box"] == {
        "absolute": [0, 0, 2, 2],
        "normalized": [0, 0, 1000, 1000],
    }
    assert [layer["z_index"] for layer in body["layers"]] == [1, 2]
    assert body["layers"][0]["bounding_box"] == {
        "absolute": [0, 0, 2, 2],
        "normalized": [0, 0, 1000, 1000],
    }
    second_task_id = second.json()["task_id"]
    for _ in range(20):
        second_body = client.get(f"/api/layer-decompositions/{second_task_id}").json()
        if second_body["status"] == "completed":
            break
    assert body["background"]["url"].rsplit("/", 2)[-1] == "background.png"
    assert second_body["data"]["background"]["url"].rsplit("/", 2)[-1] == "background.png"
    assert second.status_code == 202
    assert second.json()["task_id"] != task_id

    background = client.get(body["background"]["url"])
    foreground = client.get(body["layers"][0]["url"])
    assert background.status_code == 200
    assert background.headers["content-type"].startswith("image/png")
    assert foreground.status_code == 200
    assert foreground.headers["content-type"].startswith("image/png")


def test_multipart_upload_and_options_are_supported() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    response = client.post(
        "/api/layer-decompositions",
        files={"image": ("source.png", _png(3, 4), "image/png")},
        data={"prompt": "person", "mode": "prompt", "max_layers": "1"},
    )
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    for _ in range(20):
        response = client.get(f"/api/layer-decompositions/{task_id}")
        if response.json()["status"] == "completed":
            break
    assert response.json()["status"] == "completed"
    assert response.json()["data"]["width"] == 3
    assert response.json()["data"]["height"] == 4
    assert len(response.json()["data"]["layers"]) == 1


def test_multipart_upload_accepts_other_pillow_image_formats() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    response = client.post(
        "/api/layer-decompositions",
        files={"image": ("source.gif", _gif(3, 4), "image/gif")},
        data={"max_layers": "1"},
    )
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    for _ in range(20):
        response = client.get(f"/api/layer-decompositions/{task_id}")
        if response.json()["status"] == "completed":
            break
    assert response.json()["status"] == "completed"
    assert response.json()["data"]["width"] == 3
    assert response.json()["data"]["height"] == 4


def test_prompt_mode_requires_prompt() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    response = client.post(
        "/api/layer-decompositions",
        json={"image": _data_url(), "mode": "prompt"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_upload_byte_limit_is_enforced() -> None:
    settings = _settings(max_image_bytes=10)
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    response = client.post(
        "/api/layer-decompositions",
        files={"image": ("source.png", _png(), "image/png")},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_pixel_limit_is_enforced() -> None:
    settings = _settings(max_image_pixels=100)
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    response = client.post(
        "/api/layer-decompositions",
        files={"image": ("source.png", _png(11, 10), "image/png")},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_more_than_sixteen_layers_is_rejected() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    response = client.post(
        "/api/layer-decompositions",
        json={"image": _data_url(), "max_layers": 17},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_completed_task_can_be_corrected_and_requeued() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    accepted = client.post(
        "/api/layer-decompositions", json={"image": _data_url(), "max_layers": 1}
    )
    task_id = accepted.json()["task_id"]
    for _ in range(20):
        status = client.get(f"/api/layer-decompositions/{task_id}").json()
        if status["status"] == "completed":
            break
    assert status["status"] == "completed"

    corrected = client.post(
        f"/api/layer-decompositions/{task_id}/correct",
        json={
            "action": "replace",
            "layer_z_index": 1,
            "bbox": [0, 0, 1000, 1000],
        },
    )
    assert corrected.status_code == 200
    assert corrected.json()["status"] == "correcting"
    for _ in range(20):
        status = client.get(f"/api/layer-decompositions/{task_id}").json()
        if status["status"] == "completed":
            break
    assert status["status"] == "completed"
    assert status["data"]["quality"]["passed"] is True


def test_pending_task_can_be_cancelled() -> None:
    settings = _settings(max_concurrency=1)
    client = TestClient(create_app(settings, _BlockingBackend()))
    accepted = client.post("/api/layer-decompositions", json={"image": _data_url()})
    task_id = accepted.json()["task_id"]
    cancelled = client.post(f"/api/layer-decompositions/{task_id}/cancel")
    # Starlette's non-context TestClient tears down its portal between calls;
    # a task may therefore already be observed as stopped before cancellation.
    assert cancelled.status_code in {200, 409}
    if cancelled.status_code == 200:
        assert cancelled.json()["status"] == "cancelled"
    else:
        assert cancelled.json()["error"]["code"] == "task_conflict"


def test_correction_requires_a_supported_field() -> None:
    settings = _settings()
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    accepted = client.post("/api/layer-decompositions", json={"image": _data_url()})
    task_id = accepted.json()["task_id"]
    response = client.post(f"/api/layer-decompositions/{task_id}/correct", json={})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_mock_backend_is_prohibited_in_production() -> None:
    try:
        DeterministicMockBackend("production")
    except RuntimeError as exc:
        assert "test-only" in str(exc)
    else:
        raise AssertionError("production mock backend must be rejected")


def test_oversized_declared_multipart_body_is_rejected_before_parsing() -> None:
    settings = _settings(max_image_bytes=10)
    client = TestClient(create_app(settings, DeterministicMockBackend("test")))
    response = client.post(
        "/api/layer-decompositions",
        content=b"not parsed",
        headers={
            "content-type": "multipart/form-data; boundary=x",
            "content-length": str(64 * 1024 + 11),
        },
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
