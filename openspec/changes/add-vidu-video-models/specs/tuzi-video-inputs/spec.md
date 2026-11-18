## ADDED Requirements

### Requirement: Exact Vidu Series Contracts

The system SHALL expose the eight documented Tuzi Vidu model IDs with their own supported actions, duration limits, resolutions and explicit defaults, without extending these contracts to unknown IDs.

#### Scenario: Select a reference-only Vidu model
- **WHEN** the user selects viduq3-ad, viduq3-drama, viduq3 or viduq3-mix
- **THEN** the system SHALL require reference images and submit referenceGenerate for the selected exact model
- **AND** the model SHALL accept a prompt and reference images as input and return video

#### Scenario: Configure Mix reference generation
- **WHEN** the user selects viduq3-mix
- **THEN** the system SHALL offer 3–15 seconds, 720p/1080p, six aspect ratio choices, optional seed, watermark controls, reference sounds, JSON metadata, payload and callback URL
- **AND** submission SHALL preserve explicit zero and false, give metadata controls precedence, and enforce the 5000-character prompt and 20 MiB JSON limits

#### Scenario: Configure Vidu Turbo reference generation
- **WHEN** the user explicitly selects reference generation for viduq3-turbo
- **THEN** referenceGenerate SHALL be sent and duration SHALL be limited to 3–15 seconds
- **AND** other Turbo modes SHALL retain their documented 1–16 second range

### Requirement: Shared Vidu JSON Submission

The system SHALL use one Vidu request contract through composer workflows, programmatic calls, main-thread and shared video submission, preserving the selected provider and ordered media.

#### Scenario: Submit ordered first and last frames
- **WHEN** a supported Vidu model receives firstTailGenerate and exactly two valid images
- **THEN** the request SHALL be JSON with the exact model, prompt, images in order, integer duration, size and metadata.action
- **AND** the request SHALL NOT use generic video multipart fields or a legacy Vidu model alias

#### Scenario: Reject invalid inputs before submission
- **WHEN** the action is unavailable, images are missing or excessive, a duration is invalid, or unsupported media is supplied
- **THEN** the system SHALL report the relevant validation error before creating a provider task

### Requirement: Preserve Vidu Task Identity And Recovery

The system SHALL reuse existing async video polling, result extraction, caching and canvas insertion for Vidu, without creating additional tasks to recover a result.

#### Scenario: Accepted task completes with a video URL
- **WHEN** a Vidu task moves from queued or in_progress to completed with metadata.url
- **THEN** the existing task SHALL recover the video and preserve its provider and model identity
- **AND** a nonterminal completed_at field SHALL NOT independently mark generation successful

#### Scenario: Provider fails or result is ambiguous
- **WHEN** the provider rejects a request, reports a failed task, or submission outcome is unknown
- **THEN** the error and known task identity SHALL remain available
- **AND** the client SHALL NOT silently switch models or repeat generation
