from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DecompositionMode(str, Enum):
    AUTO = "auto"
    PROMPT = "prompt"


class DecompositionOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: Annotated[str | None, Field(default=None, max_length=4_096)]
    mode: DecompositionMode = DecompositionMode.AUTO
    max_layers: Annotated[int, Field(default=16, ge=1, le=16)]

    @model_validator(mode="after")
    def require_prompt_in_prompt_mode(self) -> "DecompositionOptions":
        if self.mode is DecompositionMode.PROMPT and not (self.prompt or "").strip():
            raise ValueError("prompt is required when mode is 'prompt'")
        return self


class JsonDecompositionRequest(DecompositionOptions):
    image: Annotated[str, Field(min_length=1)]


class BoundingBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    absolute: tuple[int, int, int, int]
    normalized: tuple[int, int, int, int]


class LayerResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    z_index: Annotated[int, Field(ge=1)]
    bounding_box: BoundingBox
    name: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=1_000)]
    confidence: Annotated[float, Field(ge=0, le=1)]


class BackgroundResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    z_index: int = Field(default=0, ge=0, le=0)
    bounding_box: BoundingBox
    name: str = "background"
    description: str = "Inpainted background"
    confidence: Annotated[float, Field(ge=0, le=1)]


class DecompositionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str
    width: Annotated[int, Field(gt=0)]
    height: Annotated[int, Field(gt=0)]
    background: BackgroundResult
    layers: Annotated[list[LayerResult], Field(max_length=16)]


class QualityMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ssim: Annotated[float, Field(ge=0, le=1)]
    channel_error_within_one_ratio: Annotated[float, Field(ge=0, le=1)]
    passed: bool


# Retained for callers that imported the original synchronous contract.


class CorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: Annotated[str | None, Field(default=None, max_length=4_096)]
    action: Literal["add", "remove", "replace"] | None = None
    layer_z_index: Annotated[int | None, Field(default=None, ge=1, le=16)]
    bbox: tuple[int, int, int, int] | None = None
    mask: Annotated[str | None, Field(default=None, min_length=1, max_length=8_192)]

    @model_validator(mode="after")
    def require_one_correction(self) -> "CorrectionRequest":
        if self.prompt is None and self.layer_z_index is None and self.bbox is None and self.mask is None:
            raise ValueError("at least one correction field is required")
        if self.prompt is not None and not self.prompt.strip():
            raise ValueError("prompt cannot be blank")
        if self.bbox is not None:
            x1, y1, x2, y2 = self.bbox
            if not (0 <= x1 < x2 <= 1_000 and 0 <= y1 < y2 <= 1_000):
                raise ValueError("bbox must be a normalized [x1, y1, x2, y2] within 0..1000")
        if self.mask is not None and not (
            self.mask.startswith("data:image/")
            or self.mask.startswith("http://")
            or self.mask.startswith("https://")
        ):
            raise ValueError("mask must be an image data URL or HTTP(S) URL")
        return self


class LayerDecompositionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_id: Annotated[str, Field(min_length=1)]
    width: Annotated[int, Field(gt=0)]
    height: Annotated[int, Field(gt=0)]
    background: BackgroundResult
    layers: Annotated[list[LayerResult], Field(max_length=16)]
    quality: QualityMetrics
    result_kind: Literal["inference", "test"] = "inference"
    decisions: list[str] = Field(default_factory=list, max_length=32)


TaskStatus = Literal[
    "pending", "running", "correcting", "completed", "failed", "cancelled", "stopped"
]


class TaskAcceptedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: Annotated[str, Field(min_length=1)]
    status: Literal["pending"]
    phase: str = "queued"
    progress: Annotated[float, Field(ge=0, le=1)] = 0


class TaskError(BaseModel):
    code: str
    message: str


class TaskStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: Annotated[str, Field(min_length=1)]
    status: TaskStatus
    phase: str
    progress: Annotated[float, Field(ge=0, le=1)]
    data: LayerDecompositionData | None = None
    error: TaskError | None = None


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
