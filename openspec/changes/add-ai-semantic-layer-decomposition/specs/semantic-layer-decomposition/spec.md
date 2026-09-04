## ADDED Requirements

### Requirement: Semantic decomposition contract

The system SHALL expose a provider-neutral asynchronous semantic decomposition operation that accepts one raster image supported by the configured decoder (URL, image data URL, or multipart upload), an optional natural-language or normalized-bbox prompt, and a maximum of sixteen foreground semantic layers. The background is returned separately and is not counted against the sixteen-layer limit. The service SHALL NOT require Seedream 5.0 Pro.

The client MAY reuse the active OpenTu vision-capable provider for semantic candidate hints or an explicitly declared native layer capability. Existing provider credentials SHALL remain in the existing provider transport and SHALL NOT be copied into the local decomposition service. Ordinary image-generation results SHALL NOT be interpreted as layer results.

#### Scenario: Automatic decomposition

- **WHEN** a valid image is submitted without a prompt
- **THEN** the service SHALL identify the major visible elements and return one reconstructed background plus transparent PNG layers

#### Scenario: Targeted decomposition

- **WHEN** a prompt names an element or includes a normalized `<bbox>`
- **THEN** the service SHALL prioritize that region and return metadata describing the selected element

#### Scenario: Reuse configured provider

- **WHEN** the active text binding supports image input
- **THEN** the client SHALL request bounded candidate hints through the existing provider route and pass only validated names, boxes, and confidence values to the local service

#### Scenario: Ordinary image model

- **WHEN** the active image provider returns ordinary image URLs without explicit z-index and bounding boxes
- **THEN** the client SHALL reject that response as unsupported and continue with the local decomposition pipeline without fabricating layers

#### Scenario: Task lifecycle

- **WHEN** a valid request is accepted
- **THEN** the service SHALL return an operation id, expose `pending`, `running`, `correcting`, `completed`, `failed`, `cancelled`, and `stopped` states, and report the current phase and progress through status polling

#### Scenario: Generated foreground second-pass cutout

- **WHEN** a generated image is used to replace an existing semantic foreground
- **THEN** the client SHALL use the active vision model or local detection to relocate the named subject on the generated canvas, run a one-layer second-pass segmentation/matting request, and cache one real alpha-bearing, tightly cropped transparent PNG before changing the target

### Requirement: Generated artifact defect repair

When a generated image is used for a bound image edit or semantic foreground replacement, the client SHALL perform one bounded post-generation artifact inspection when an image-capable text binding is available. A repair SHALL only be attempted for a high-confidence, localized defect diagnosis with normalized bounding boxes; uncertain differences, normal hair, shadows, reflections, and unedited regions SHALL be preserved. The client SHALL submit at most one internal image-edit repair pass using the existing selected image model and SHALL not create a user-visible canvas task or recursively trigger artifact inspection.

#### Scenario: Protect unedited pixels

- **WHEN** a masked image edit completes
- **THEN** pixels outside the transparent edit mask SHALL be restored from the source image before and after any repair pass

#### Scenario: Repair a localized defect

- **WHEN** the vision inspection reports a defect with confidence at least 0.78 and a bounded box
- **THEN** the client SHALL edit only an expanded local repair mask, preserve all other pixels, and continue to foreground extraction

#### Scenario: Ambiguous inspection

- **WHEN** the inspection provider is unavailable, returns invalid JSON, or reports low-confidence/unclear differences
- **THEN** the client SHALL skip the repair pass and use the best available generated image without blocking insertion

#### Scenario: Bounded retries

- **WHEN** a repair pass is attempted
- **THEN** no more than one repair generation and one final local composition SHALL run for that source task

### Requirement: Atomic and bounded output

The system SHALL return no partial result when a required layer fails, SHALL enforce a 30 MB upload limit, a 36-megapixel decoded-image limit, a 4096-character prompt limit, and a maximum of sixteen foreground layers, and SHALL process large images in bounded-memory tiles.

#### Scenario: Layer failure

- **WHEN** any required layer cannot be segmented, matted, quality-checked, or cached
- **THEN** the operation SHALL fail atomically, remove uncommitted outputs, and leave the source canvas image unchanged

#### Scenario: No valid semantic foreground

- **WHEN** no valid foreground is detected, a cutout has empty or invalid alpha, quality validation fails, or the output cannot be cached
- **THEN** the operation SHALL fail with no canvas mutation, SHALL discard uncommitted assets, and SHALL NOT return or apply a `fallback_full_canvas` result

#### Scenario: Cancellation

- **WHEN** a client cancels a pending or running operation
- **THEN** the service SHALL stop new inference and asset writes, remove uncommitted outputs, and report `cancelled` without changing the source image

#### Scenario: Output limit

- **WHEN** decomposition would produce more than sixteen foreground layers
- **THEN** the service SHALL merge or omit low-confidence candidates explicitly and report the decision rather than silently returning an incomplete manifest

### Requirement: Correction and security boundaries

The system SHALL expose a correction operation for adding, removing, or replacing a layer mask or bbox, SHALL return confidence and quality metrics, SHALL reject private/loopback source URLs and invalid image MIME/types, and SHALL enforce request timeout, GPU queue, and per-user rate limits.

#### Scenario: Low confidence

- **WHEN** a candidate falls below the configured confidence threshold or recomposition quality fails
- **THEN** the operation SHALL enter `correcting`, preserve the source, and allow a user correction or explicit retry before committing layers

#### Scenario: Unsafe source

- **WHEN** an image URL resolves to localhost, a private/link-local address, a redirect outside the allowlist, or a payload the configured image decoder cannot decode
- **THEN** the service SHALL reject the request without fetching or storing the payload
