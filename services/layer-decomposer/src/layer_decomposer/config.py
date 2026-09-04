from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str = "production"
    backend_factory: str | None = None
    # Ark remains an opt-in compatibility adapter only. There is deliberately
    # no default credential or model so the local pipeline is the only default.
    ark_api_key: str | None = None
    ark_endpoint: str | None = None
    ark_model: str | None = None
    ark_timeout_seconds: float = 180.0
    max_image_bytes: int = 30 * 1024 * 1024
    max_image_pixels: int = 36_000_000
    max_layers: int = 16
    max_concurrency: int = 2
    queue_timeout_seconds: float = 5.0
    download_timeout_seconds: float = 20.0
    max_redirects: int = 3
    task_ttl_seconds: float = 3_600.0
    task_max_tasks: int = 64
    task_max_storage_bytes: int = 512 * 1024 * 1024
    # Match the local detector confidence floor. Confidence is metadata for
    # ranking, while the reconstruction quality gate remains authoritative.
    min_layer_confidence: float = 0.25
    local_detector_weights: str | None = None
    local_segmenter_weights: str | None = None
    local_device: str = "cpu"
    local_detection_confidence: float = 0.25
    local_detection_iou: float = 0.7
    local_max_working_pixels: int = 8_000_000
    local_quality_pixels: int = 1_000_000
    local_inpaint_radius: float = 3.0

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            environment=os.getenv("LAYER_DECOMPOSER_ENV", "production"),
            backend_factory=os.getenv("LAYER_DECOMPOSER_BACKEND_FACTORY") or None,
            ark_api_key=(
                os.getenv("LAYER_DECOMPOSER_ARK_API_KEY") or None
            ),
            ark_endpoint=os.getenv("LAYER_DECOMPOSER_ARK_ENDPOINT") or None,
            ark_model=os.getenv("LAYER_DECOMPOSER_ARK_MODEL") or None,
            ark_timeout_seconds=_positive_float(
                "LAYER_DECOMPOSER_ARK_TIMEOUT_SECONDS", 180.0
            ),
            max_image_bytes=_positive_int("LAYER_DECOMPOSER_MAX_IMAGE_BYTES", 30 * 1024 * 1024),
            max_image_pixels=_positive_int("LAYER_DECOMPOSER_MAX_IMAGE_PIXELS", 36_000_000),
            max_layers=min(_positive_int("LAYER_DECOMPOSER_MAX_LAYERS", 16), 16),
            max_concurrency=_positive_int("LAYER_DECOMPOSER_MAX_CONCURRENCY", 2),
            queue_timeout_seconds=_positive_float("LAYER_DECOMPOSER_QUEUE_TIMEOUT_SECONDS", 5.0),
            download_timeout_seconds=_positive_float("LAYER_DECOMPOSER_DOWNLOAD_TIMEOUT_SECONDS", 20.0),
            max_redirects=min(_non_negative_int("LAYER_DECOMPOSER_MAX_REDIRECTS", 3), 5),
            task_ttl_seconds=_positive_float("LAYER_DECOMPOSER_TASK_TTL_SECONDS", 3_600.0),
            task_max_tasks=_positive_int("LAYER_DECOMPOSER_TASK_MAX_TASKS", 64),
            task_max_storage_bytes=_positive_int("LAYER_DECOMPOSER_TASK_MAX_STORAGE_BYTES", 512 * 1024 * 1024),
            min_layer_confidence=_ratio("LAYER_DECOMPOSER_MIN_LAYER_CONFIDENCE", 0.25),
            local_detector_weights=(
                os.getenv("LAYER_DECOMPOSER_LOCAL_DETECTOR_WEIGHTS") or None
            ),
            local_segmenter_weights=(
                os.getenv("LAYER_DECOMPOSER_LOCAL_SEGMENTER_WEIGHTS") or None
            ),
            local_device=os.getenv("LAYER_DECOMPOSER_LOCAL_DEVICE", "cpu").strip()
            or "cpu",
            local_detection_confidence=_ratio(
                "LAYER_DECOMPOSER_LOCAL_DETECTION_CONFIDENCE", 0.25
            ),
            local_detection_iou=_ratio(
                "LAYER_DECOMPOSER_LOCAL_DETECTION_IOU", 0.7
            ),
            local_max_working_pixels=_positive_int(
                "LAYER_DECOMPOSER_LOCAL_MAX_WORKING_PIXELS", 8_000_000
            ),
            local_quality_pixels=_positive_int(
                "LAYER_DECOMPOSER_LOCAL_QUALITY_PIXELS", 1_000_000
            ),
            local_inpaint_radius=_positive_float(
                "LAYER_DECOMPOSER_LOCAL_INPAINT_RADIUS", 3.0
            ),
        )


def _positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _non_negative_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value < 0:
        raise ValueError(f"{name} must be non-negative")
    return value


def _positive_float(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _ratio(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not 0 <= value <= 1:
        raise ValueError(f"{name} must be between zero and one")
    return value
