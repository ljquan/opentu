from __future__ import annotations

from .backend import BackendRequest, BackendResult
from .contracts import BackgroundResult, BoundingBox, LayerResult, QualityMetrics


class DeterministicMockBackend:
    """Contract-only backend. Construction is prohibited outside a test environment."""

    result_kind = "test"

    def __init__(self, environment: str) -> None:
        if environment != "test":
            raise RuntimeError("DeterministicMockBackend is test-only")

    @property
    def is_ready(self) -> bool:
        return True

    @property
    def unavailable_reason(self) -> None:
        return None

    async def decompose(self, request: BackendRequest) -> BackendResult:
        task_id = request.request_id.rsplit("-r", 1)[0]
        base_url = f"/api/layer-decompositions/{task_id}/test-assets"
        layer_count = min(request.max_layers, 2)
        layers = tuple(
            LayerResult(
                url=f"{base_url}/layer-{index}.png",
                z_index=index,
                bounding_box=BoundingBox(
                    absolute=(
                        0,
                        0,
                        request.image.width,
                        request.image.height,
                    ),
                    normalized=(0, 0, 1000, 1000),
                ),
                name=f"mock-layer-{index}",
                description="Deterministic test layer; not a model inference result",
                confidence=1.0,
            )
            for index in range(1, layer_count + 1)
        )
        return BackendResult(
            background=BackgroundResult(
                url=f"{base_url}/background.png",
                bounding_box=BoundingBox(
                    absolute=(0, 0, request.image.width, request.image.height),
                    normalized=(0, 0, 1000, 1000),
                ),
                description="Deterministic test background; not a model inference result",
                confidence=1.0,
            ),
            layers=layers,
            quality=QualityMetrics(ssim=1.0, channel_error_within_one_ratio=1.0, passed=True),
            result_kind="test",
        )

    async def discard(self, request_id: str) -> None:
        del request_id


def create_mock_backend(settings: object) -> DeterministicMockBackend:
    environment = getattr(settings, "environment", "production")
    return DeterministicMockBackend(environment)
