## ADDED Requirements

### Requirement: Complete Model-Specific Video Controls

The system SHALL expose composer attachments, generation controls and programmatic inputs for the documented Gemini Omni 1.2 Flash, Wan 3.0, HappyHorse 1.1 T2V/I2V/R2V and Kling 4.0 capabilities, and SHALL serialize only the selected model's valid fields through all existing generation entry points.

#### Scenario: Configure Wan advanced generation
- **WHEN** the user selects Wan mixed references, audio, prompt extension and seed
- **THEN** workflow, MCP and both video submission paths SHALL preserve the values, including false and zero
- **AND** the request SHALL use the Wan contract rather than the generic pricing-page template

#### Scenario: Configure Kling media roles
- **WHEN** a programmatic caller supplies frame, image, video, element and voice entries
- **THEN** the request SHALL preserve their roles and unique IDs in contents with settings and options
- **AND** duplicate IDs, unsupported media, mutually exclusive input forms and exceeded limits SHALL fail before submission

### Requirement: Gemini Local Multimodal Inputs

The system SHALL support local/cached Gemini reference media using the documented content array with explicit MIME and raw Base64 data, and SHALL preserve URI media without misrepresenting local or protected addresses as public URLs.

#### Scenario: Generate from a cached image
- **WHEN** a user selects a local or cached PNG, JPEG or WebP reference for Gemini
- **THEN** the selected submission path SHALL read it and build an input array with MIME and raw Base64 data
- **AND** it SHALL include the prompt as a text entry without also sending top-level prompt or input_reference

#### Scenario: Continue an existing Gemini task
- **WHEN** the user selects edit or extend with an accessible completed service task
- **THEN** the client SHALL submit the service task identity and the verified action contract
- **AND** extension duration SHALL not exceed 10 seconds
- **AND** service rejection SHALL remain visible without changing the model or creating a retry task

### Requirement: Capability-Aware Prompt And Media Validation

The system SHALL enforce each model's prompt and media requirements consistently across UI, MCP, task validation and request construction, including locally verifiable HappyHorse image constraints.

#### Scenario: HappyHorse image-to-video without text
- **WHEN** HappyHorse 1.1 I2V receives one valid image and no prompt
- **THEN** every generation layer SHALL permit submission
- **AND** the request SHALL send image and parameters without a ratio field

#### Scenario: Invalid Wan input combination
- **WHEN** a user supplies a last frame without the first frame, mixes frame and reference modes, or disables prompt extension while supplying file or link
- **THEN** the client SHALL report the relevant constraint before creating a generation request

### Requirement: Preserve Routes And Historical Generation

The system SHALL preserve provider/model identity, ordered references, existing generation recovery and legacy model contracts while saving and restoring the new parameters.

#### Scenario: Restore an existing Kling task
- **WHEN** the client restores a legacy combined Kling 4.0 size
- **THEN** it SHALL recover the corresponding resolution and ratio without discarding an explicit ratio
- **AND** it SHALL not alter an already accepted task or submit another generation for result recovery

#### Scenario: Provider capability unavailable
- **WHEN** Gemini 1.2 is unavailable or a Wan route rejects reference video or smart duration
- **THEN** the original provider error SHALL be shown
- **AND** the system SHALL not silently drop input, substitute another model, or repeat generation

### Requirement: Automatic Composer Reference Inputs

The composer SHALL use its current attachments directly without a second reference form or stale saved media. Programmatic callers SHALL retain explicit role and mode support.

#### Scenario: Automatic Wan reference mode
- **WHEN** current composer attachments contain more than two images or include video or audio
- **THEN** the workflow SHALL use mixed references without requiring a manual mode change
- **AND** one or two images alone SHALL map to first frame or first and last frame in order

#### Scenario: Generate without attachments
- **WHEN** the composer has no attachments and submits a prompt to a text-capable model
- **THEN** saved media drafts SHALL NOT enter the request
- **AND** image-required HappyHorse variants SHALL still reject missing images without switching models
