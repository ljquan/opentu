## ADDED Requirements

### Requirement: Support Audio As A First-Class Generation Modality

The system SHALL treat audio as a first-class generation modality across routing, task execution, and UI entry points.

#### Scenario: Audio default route is configured in presets

- **GIVEN** the user manages invocation presets
- **WHEN** the user selects a default provider-backed model for audio generation
- **THEN** the preset SHALL store an `audio` route independently from `text`, `image`, and `video`

#### Scenario: Audio mode is available in the AI input bar

- **GIVEN** the current workspace supports AI generation entry from the input bar
- **WHEN** the user switches generation type
- **THEN** the user SHALL be able to choose an `audio` mode
- **AND** the request SHALL be parsed as an audio generation request rather than being routed through text or video fallbacks

### Requirement: Resolve Suno Capability Identifiers Separately From Execution Versions

The system SHALL distinguish discovered Suno capability identifiers from the executable version fields required by submit requests.

#### Scenario: Discovered Suno capability is not used as submit version directly

- **GIVEN** a provider profile exposes discovered capabilities such as `suno_music` or `suno-continue`
- **WHEN** the user submits a music generation request
- **THEN** the system SHALL map the chosen capability to an executable binding
- **AND** SHALL send the actual Suno version through the request field `mv`
- **AND** SHALL not assume the discovered capability identifier itself is the executable version string

#### Scenario: Uploaded continuation appends upload suffix to mv

- **GIVEN** the selected audio action represents continuation from an uploaded clip
- **WHEN** the user submits the request with a base Suno version such as `chirp-v3-5`
- **THEN** the system SHALL transform the submitted version to the upload variant required by the provider
- **AND** SHALL keep the rest of the request flow on the same submit endpoint

### Requirement: Submit Suno Music Requests Through Provider-Specific Audio Bindings

The system SHALL submit Suno music generation requests through provider-specific audio bindings that describe the provider endpoint, request fields, and supported parameters.

#### Scenario: Submit a basic music generation request

- **GIVEN** the active audio binding targets Suno music generation
- **WHEN** the user provides lyrics or prompt text and submits an audio request
- **THEN** the system SHALL send the request to `/suno/submit/music`
- **AND** SHALL include the selected `mv`
- **AND** SHALL include `prompt`

#### Scenario: Submit music request with optional tags and title

- **GIVEN** the active audio binding supports Suno custom music generation fields
- **WHEN** the user provides `tags` and `title`
- **THEN** the system SHALL forward those fields in the submit request
- **AND** SHALL keep them associated with the created audio task

#### Scenario: Submit continuation fields when continuing a clip

- **GIVEN** the user is continuing an existing clip
- **WHEN** the user provides `continue_clip_id` and `continue_at`
- **THEN** the system SHALL include those fields in the submit request
- **AND** SHALL execute the request through the same provider-specific audio binding

### Requirement: Poll Suno Audio Tasks Through Fetch Endpoint

The system SHALL poll Suno audio tasks through the provider fetch endpoint and normalize provider statuses into internal task states.

#### Scenario: Audio task is queried after submit

- **GIVEN** a Suno audio submit request returns a task identifier
- **WHEN** the system tracks that task asynchronously
- **THEN** it SHALL query `/suno/fetch/{task_id}`
- **AND** SHALL update the internal audio task status based on the provider response

#### Scenario: Completed Suno task returns audio output

- **GIVEN** a Suno fetch response indicates success or completion
- **WHEN** the result payload includes audio clip data
- **THEN** the system SHALL extract at least one playable audio URL
- **AND** SHALL store it in the internal task result for audio history and follow-up actions

### Requirement: Expose Audio Parameters In User-Facing Controls

The system SHALL expose the audio parameters needed for Suno music generation in user-facing configuration and submission flows.

#### Scenario: Audio parameters are editable before submit

- **GIVEN** the user is preparing an audio generation request
- **WHEN** the current binding supports Suno music generation
- **THEN** the UI SHALL allow the user to review and edit `mv`, `title`, `tags`, and continuation parameters when relevant

#### Scenario: Unsupported advanced Suno actions stay hidden from primary flow

- **GIVEN** the provider profile exposes additional Suno capabilities beyond initial music generation
- **WHEN** those capabilities are not implemented in the current product slice
- **THEN** the primary audio generation flow SHALL not expose them as if they were fully supported submit actions
- **AND** the runtime MAY preserve their metadata for future expansion
