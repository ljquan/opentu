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

### Requirement: Submit Server-Reachable Seedance 2.0 Reference Media

The system SHALL submit only HTTP(S) or `asset://` reference audio and video addresses for Seedance 2.0 tasks.

#### Scenario: Submit supported reference media

- **GIVEN** a Seedance 2.0 task includes reference audio or video
- **WHEN** each reference uses an HTTP(S) or `asset://` address
- **THEN** the system SHALL include the normalized address in the video submission

#### Scenario: Reject browser-local reference media

- **GIVEN** a Seedance 2.0 task includes a Data URL, Blob URL, or malformed reference address
- **WHEN** video generation is submitted
- **THEN** the system SHALL reject the request before sending it to the provider

### Requirement: Expose Seedance 2.0 Confirmed Parameters

The system SHALL constrain Seedance 2.0 controls to the confirmed duration and resolution ranges for each model tier.

#### Scenario: Standard model parameter options

- **GIVEN** the selected model is Seedance 2.0 standard
- **WHEN** generation controls are rendered
- **THEN** durations from 4 through 15 seconds SHALL be available
- **AND** only the currently priced 480p and 720p resolutions SHALL be available
- **AND** the aspect ratio SHALL be constrained to 16:9

#### Scenario: Fast and Mini parameter options

- **GIVEN** the selected model is Seedance 2.0 Fast or Seedance 2.0 Mini
- **WHEN** generation controls are rendered
- **THEN** durations from 4 through 15 seconds SHALL be available
- **AND** only 480p and 720p resolutions SHALL be available
- **AND** the aspect ratio SHALL be constrained to 16:9
