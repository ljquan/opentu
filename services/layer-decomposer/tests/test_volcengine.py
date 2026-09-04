from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path

from PIL import Image

from layer_decomposer.backend import BackendRequest
from layer_decomposer.config import Settings
from layer_decomposer.image_input import ImageAsset
from layer_decomposer.volcengine import VolcengineLayerBackend


class _Response:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self, limit: int = -1) -> bytes:
        return self.body[:limit]


def test_posts_seedream_layer_decomposition_request(monkeypatch, tmp_path: Path) -> None:
    source_path = tmp_path / "source.png"
    Image.new("RGB", (20, 10), (20, 30, 40)).save(source_path, "PNG")
    captured: dict[str, object] = {}

    def fake_urlopen(request: object, **_: object) -> _Response:
        captured["request"] = request
        return _Response(
            json.dumps(
                {
                    "data": [
                        {
                            "url": "https://cdn.example.com/background.png",
                            "z_index": 0,
                            "bounding_box": [0, 0, 20, 10],
                            "name": "底图",
                            "description": "背景",
                        },
                        {
                            "url": "https://cdn.example.com/person.png",
                            "z_index": 1,
                            "bounding_box": [2, 1, 18, 9],
                            "name": "人物",
                            "description": "前景人物",
                        },
                    ]
                }
            ).encode()
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    backend = VolcengineLayerBackend(
        Settings(
            ark_api_key="secret",
            ark_endpoint="https://ark.example.com/images/generations",
            ark_model="explicit-layer-model",
        )
    )
    result = asyncio.run(
        backend.decompose(
            BackendRequest(
                request_id="task-1-r0",
                image=ImageAsset(source_path, 20, 10, "image/png", "digest"),
                prompt=None,
                mode="auto",
                max_layers=8,
            )
        )
    )

    request = captured["request"]
    body = json.loads(request.data.decode("utf-8"))  # type: ignore[attr-defined]
    assert body["model"] == "explicit-layer-model"
    assert body["layer_decomposition"] is True
    assert body["output_format"] == "png"
    assert base64.b64decode(body["image"].split(",", 1)[1]) == source_path.read_bytes()
    assert result.background.name == "底图"
    assert [layer.name for layer in result.layers] == ["人物"]
    assert result.layers[0].bounding_box.absolute == (2, 1, 18, 9)
