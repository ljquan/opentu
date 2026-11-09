## ADDED Requirements

### Requirement: Isolate GPT Image 2.6 1K Request Capabilities
The system SHALL recognize `gpt-image-2.6-1k` independently from GPT Image 2, GPT Image 2.5, and Gemini parameter families, preserve the exact requested model ID, and send only parameters verified for the selected provider's contract.

#### Scenario: Switching from a high-resolution model
- **GIVEN** a user previously selected a model with 4K resolution and advanced quality parameters
- **WHEN** the user switches to `gpt-image-2.6-1k`
- **THEN** unsupported inherited parameters SHALL NOT be sent
- **AND** the UI SHALL NOT promise fixed output pixels or expose unverified resolution tiers

#### Scenario: Preserve the selected provider and model
- **WHEN** the user submits a `gpt-image-2.6-1k` image request
- **THEN** the request SHALL use the selected provider's existing compatible adapter
- **AND** the model ID SHALL remain `gpt-image-2.6-1k` without an implicit 2.5 alias substitution

#### Scenario: Preserve a verified explicit image size
- **WHEN** the user selects automatic sizing, 1:1, 2:3, 3:2, 16:9, or 9:16 for `gpt-image-2.6-1k`
- **THEN** generation and editing adapters SHALL preserve the corresponding verified request value (`auto`, `1024x1024`, `1024x1536`, `1536x1024`, `16x9`, or `9x16`)
- **AND** explicit supported sizes SHALL NOT be overwritten with `auto`
- **AND** unsupported inherited dimensions SHALL fall back to `auto` without forwarding unverified resolution or quality tiers
- **AND** the UI SHALL describe these choices as requested ratios while preserving actual returned pixels and GIF media

### Requirement: Preserve Returned Image Media
The system SHALL preserve actual returned dimensions and verified PNG/JPEG/WebP, GIF, and SVG media formats through image-result handling, original-media caching, image preview, and original-file download.

#### Scenario: Prompt requests an animated GIF
- **GIVEN** a prompt requests a GIF and the provider returns a valid animated GIF
- **WHEN** the result is inserted, cached, previewed, restored, or downloaded
- **THEN** the original media SHALL retain its GIF MIME type and animation frames
- **AND** an original-file download SHALL use the GIF extension
- **AND** thumbnail generation SHALL NOT replace the original asset

#### Scenario: Provider returns SVG media
- **GIVEN** the provider returns valid SVG media in a verified response form
- **WHEN** the result is displayed or downloaded
- **THEN** the system SHALL preserve the SVG format and use the `image/svg+xml` MIME type
- **AND** the preview SHALL treat SVG as an image resource rather than injecting it into application DOM

#### Scenario: Actual dimensions differ from request
- **GIVEN** the generated image has different dimensions from the requested size
- **WHEN** the result is placed on the canvas
- **THEN** the system SHALL use the actual media dimensions
- **AND** SHALL NOT resize the original merely to match the model's `1k` suffix

#### Scenario: Unexpected or invalid media response
- **WHEN** the provider returns an unsupported or invalid media payload
- **THEN** the system SHALL report an actionable failure rather than mark a broken image as successfully generated

### Requirement: Select GPT Image 2.6 Channel Output
The system SHALL register the exact `gpt-image-2.6`, Flare, and Sunburst model IDs and expose automatic output, one GIF option, and SVG without changing the selected provider, token group, or default image model. Client parameter availability SHALL NOT be presented as proof of provider acceptance for an untested model.

#### Scenario: Preserve the 1K GIF contract
- **WHEN** the user selects GIF for the existing `-1k` model
- **THEN** the request prompt SHALL append `生成 GIF 图` without sending unverified format or frame fields
- **AND** the UI SHALL label this single option `GIF`

#### Scenario: Parameter GIF generation
- **WHEN** the user selects GIF for `gpt-image-2.6`, Flare, or Sunburst
- **THEN** the generation request SHALL contain `output_format=gif` and optional positive-integer `frame_count`
- **AND** the request prompt SHALL append `生成 GIF 图`
- **AND** the UI SHALL explain that the default group can also use parameter GIF without switching token groups
- **AND** both persisted `gif` and `gif_official` mode values SHALL select the same GIF option and parameter request
- **AND** reference-image and mask editing SHALL fail before submission because the parameter GIF integration confirms text generation only

#### Scenario: Keep automatic prompt hints out of task display
- **WHEN** transparent background or GIF output is selected and a task is created, batched, or retried
- **THEN** stored task and workflow prompts SHALL preserve the user's original input
- **AND** `透明图` and `生成 GIF 图` SHALL be appended only during request construction for the applicable modes
- **AND** repeated normalization or retries SHALL NOT duplicate existing hint lines or mutate the source task
- **AND** user-written occurrences SHALL remain part of the original visible prompt
- **AND** historical stored prompts SHALL NOT be destructively rewritten to guess which text was automatically added

#### Scenario: Official SVG generation
- **WHEN** the user selects official SVG for `gpt-image-2.6`, Flare, or Sunburst
- **THEN** the generation request SHALL contain `output_format=svg`, `svg.model` defaulting to `gpt-5.5`, and `stream=false`
- **AND** the UI SHALL retain the official or official-discount token group requirement for SVG
- **AND** the system SHALL reject reference-image or mask editing before submitting because this integration only confirms the generation protocol

#### Scenario: Preserve output intent across the task pipeline
- **WHEN** a chosen output mode is submitted, split into queued tasks, or normalized by a compatible adapter
- **THEN** its parameters SHALL survive using the existing task parameter record
- **AND** internal UI mode names SHALL NOT leak into upstream requests
- **AND** absent output mode parameters on historical tasks SHALL preserve previous behavior

#### Scenario: Upstream returns a different format
- **WHEN** an explicit GIF or SVG request returns a different media format
- **THEN** the system SHALL report the mismatch without marking it as successful requested-format output or automatically resubmitting the generation request

#### Scenario: Official upstream rejects legacy response format parameters
- **GIVEN** `gpt-image-2.6`, Flare, or Sunburst may route to an official upstream that rejects `response_format`
- **WHEN** any automatic, GIF, SVG, or editing request is normalized
- **THEN** `response_format` SHALL be omitted even when inherited from a saved task
- **AND** valid Base64 media responses SHALL remain readable without that request parameter
- **AND** the verified `-1k` channel SHALL retain its existing request behavior

#### Scenario: Search or enter an SVG writer model
- **WHEN** the user edits the SVG writer model in advanced parameters
- **THEN** the selector SHALL offer searchable model IDs explicitly given by the channel's SVG documentation without changing provider credentials
- **AND** general text-model catalog visibility SHALL NOT be used to infer SVG writer support
- **AND** SHALL accept a custom model ID, preserve saved values absent from the catalog, and continue sending the selected string as `svg.model`
- **AND** choosing an option or confirming with the keyboard SHALL NOT prematurely close the outer parameter menu
- **AND** the UI SHALL explain that model-list visibility does not guarantee SVG endpoint support

### Requirement: Preserve Optional GPT Image 2.6 Raster Controls
For all registered GPT Image 2.6 IDs (`gpt-image-2.6`, `gpt-image-2.6-1k`, Flare, and Sunburst) in automatic image output mode, the system SHALL expose and preserve optional native-compatible image controls without claiming model-specific provider acceptance. Background and quality controls SHALL also remain available in applicable GIF modes. The `-1k` route alias SHALL retain its existing response-format and GIF/SVG rules while sharing these image controls.

#### Scenario: Transparent image output
- **WHEN** a user selects transparent background
- **THEN** JSON and multipart requests SHALL contain `background=transparent`
- **AND** applicable raster and GIF request prompts SHALL append `透明图` without changing the stored user prompt
- **AND** absent an explicit image format, the request SHALL select PNG
- **AND** explicitly combining transparent background with JPEG SHALL fail before generation submission
- **AND** WebP SHALL remain available as a transparent-capable requested format
- **AND** the automatic PNG choice SHALL apply only to static output and SHALL NOT replace GIF output

#### Scenario: Static image controls through compatible routes
- **WHEN** optional raster controls are submitted for any registered 2.6 ID from shared parameter menus, queued tasks, or adapter request fields
- **THEN** supported client values SHALL survive GPT, Tuzi, and basic-compatible request construction: `background=auto|transparent|opaque`, `output_format=png|jpeg|webp`, `quality=auto|low|medium|high`, `moderation=auto|low`, and an optional nonempty `user`
- **AND** `output_compression` SHALL accept integers 0 through 100 only for JPEG or WebP, preserving zero
- **AND** invalid applicable compression values SHALL fail before submission, while blank or inapplicable compression SHALL be omitted
- **AND** existing batch scheduling SHALL retain one image per upstream request

#### Scenario: 1K raster compatibility
- **WHEN** the user selects transparent background, a static image format, compression, quality, or reference fidelity for `gpt-image-2.6-1k`
- **THEN** the same raster validation and request field rules SHALL apply as for the other registered 2.6 models
- **AND** its existing `response_format=b64_json` and prompt GIF mode SHALL remain compatible
- **AND** enabling raster controls SHALL NOT enable parameter GIF or SVG for the `-1k` alias

#### Scenario: Reference image fidelity
- **WHEN** reference images accompany a static image edit with `input_fidelity=low|high`
- **THEN** the compatible edit request SHALL preserve the requested fidelity exactly once
- **AND** text-only generation SHALL omit input fidelity
- **AND** existing reference files and optional masks SHALL be preserved

#### Scenario: Switching media output modes
- **WHEN** the user switches from automatic static output to prompt GIF, official GIF, or SVG
- **THEN** static encoding, compression, and reference fidelity fields SHALL be hidden and omitted from GIF or SVG requests
- **AND** background, quality, moderation, and user fields SHALL remain available and be forwarded in applicable GIF modes
- **AND** SVG mode SHALL omit these image fields
- **AND** only the applicable frame count or SVG writer control SHALL be shown
- **AND** returning to automatic output SHALL allow retained static choices to be used again

#### Scenario: Parameter GIF transparency with advanced controls collapsed
- **WHEN** a user opens the parameters while parameter GIF is selected
- **THEN** transparent background and image quality controls SHALL be visible without enabling advanced controls
- **AND** choosing transparency SHALL preserve `output_format=gif` and the existing frame-count field
- **AND** a previously saved JPEG/WebP selection or compression SHALL NOT override the GIF output

#### Scenario: Static output mismatch and unsupported legacy fields
- **WHEN** an explicitly requested PNG, JPEG, or WebP receives a different media format
- **THEN** the result SHALL report `IMAGE_OUTPUT_FORMAT_MISMATCH` without another generation submission
- **AND** actual media bytes SHALL NOT be relabeled to satisfy the request
- **AND** incompatible legacy resolution tiers, DALL-E style, response-format, and streaming-preview fields SHALL NOT be forwarded by the 2.6 non-streaming request path

### Requirement: Keep GPT Image 2.6 Outputs in Task Columns
When a registered GPT Image 2.6 task returns multiple images, the system SHALL preserve all outputs and place them in one task column, with identifiable GIFs above static source images. Adjacent tasks SHALL occupy separate columns without changing result-array order or cache associations.

#### Scenario: Automatic insertion and manual insertion
- **WHEN** one or more completed 2.6 tasks with multiple outputs are inserted automatically, retried, or inserted through a task list or batch selection
- **THEN** each task's outputs SHALL remain in the same column and GIF positions SHALL precede static image positions
- **AND** layout SHALL use each image's actual aspect ratio and avoid existing content as a complete group
- **AND** loading failure or a board switch SHALL NOT commit a partial group or mark an unsuccessful insertion as completed

#### Scenario: Reserve columns before completion
- **WHEN** a new ordinary non-SVG 2.6 batch is submitted
- **THEN** tasks SHALL reserve adjacent columns with room for an animation and a source image
- **AND** reversed completion order SHALL preserve each task's reserved position
- **AND** existing canvas images SHALL NOT be moved by the change
