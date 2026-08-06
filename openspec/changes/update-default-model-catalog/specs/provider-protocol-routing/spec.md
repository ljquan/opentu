## ADDED Requirements

### Requirement: Route Seedance 2.0 Through Unified Async Video API

The system SHALL route Seedance 2.0, Seedance 2.0 Fast, and Seedance 2.0 Mini through the model marketplace `/v1/videos` asynchronous task protocol without applying Seedance 1.x model-name transformation.

#### Scenario: Submit Seedance 2.0 task

- **GIVEN** a user selects a Seedance 2.0 family model
- **WHEN** video generation is submitted
- **THEN** the system SHALL POST the official model ID and supported parameters to `/v1/videos`
- **AND** SHALL retain the returned task ID for polling and recovery

#### Scenario: Poll Seedance 2.0 task

- **GIVEN** a Seedance 2.0 task has been accepted
- **WHEN** the task is not yet terminal
- **THEN** the system SHALL poll `/v1/videos/{taskId}` with bounded retry and exponential backoff for transient failures
- **AND** SHALL stop immediately on a business failure response

#### Scenario: Preserve Seedance 1.x routing

- **GIVEN** a user selects an existing Seedance 1.x logical model
- **WHEN** video generation is submitted
- **THEN** the system SHALL continue to use the existing Seedance 1.x adapter and resolution model-name transformation

### Requirement: Submit Official Seedance 2.0 Reference Media

The system SHALL encode Seedance 2.0 reference media as typed `content` items using the formats allowed for each official media type.

#### Scenario: Submit supported reference media

- **GIVEN** a Seedance 2.0 task includes reference video or audio
- **WHEN** a video uses a public HTTP(S) address, and audio uses HTTP(S), `asset://`, a valid bounded audio Data URL, or a material ID
- **THEN** the system SHALL include the normalized address in the video submission

#### Scenario: Reject browser-local reference media

- **GIVEN** a Seedance 2.0 task includes a Blob URL, malformed media value, or a Data URL with the wrong media type
- **WHEN** video generation is submitted
- **THEN** the system SHALL reject the request before sending it to the provider

#### Scenario: Prevent inline audio amplification

- **GIVEN** a Seedance 2.0 task uses an audio Data URL
- **WHEN** the user requests multiple generated videos in one submission
- **THEN** the system SHALL require a single task or a reusable public URL or material ID

### Requirement: Expose Seedance 2.0 Confirmed Parameters

The system SHALL expose and submit Seedance 2.0 controls according to the official JSON request contract.

#### Scenario: Standard model parameter options

- **GIVEN** the selected model is Seedance 2.0 standard
- **WHEN** generation controls are rendered
- **THEN** durations from 4 through 12 seconds SHALL be available
- **AND** 480p, 720p, and 1080p resolutions SHALL be available independently from aspect ratio
- **AND** 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, and adaptive ratios SHALL be available
- **AND** generate-audio, watermark, seed, and camera-fixed controls SHALL map to their official JSON fields

#### Scenario: Fast and Mini parameter options

- **GIVEN** the selected model is Seedance 2.0 Fast or Seedance 2.0 Mini
- **WHEN** generation controls are rendered
- **THEN** the same official 4-12 second, resolution, ratio, and optional control fields SHALL be available

#### Scenario: Restore a historical combined size

- **GIVEN** a historical Seedance 2.0 task stores `resolution@ratio` in its size field
- **WHEN** the task is edited or retried
- **THEN** the system SHALL split the legacy value into the official resolution and ratio fields
