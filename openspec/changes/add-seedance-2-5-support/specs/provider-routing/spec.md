## ADDED Requirements

### Requirement: Route Seedance 2.5 Through the Seedance 2 JSON Adapter

The system SHALL route `doubao-seedance-2-5-260628` through the existing asynchronous `/v1/videos` JSON protocol without applying Seedance 1.x model-name transformation.

#### Scenario: Submit Seedance 2.5 task

- **GIVEN** a user selects `doubao-seedance-2-5-260628`
- **WHEN** video generation is submitted
- **THEN** the system SHALL send the exact model ID in the JSON request
- **AND** SHALL encode text, image, video, and audio references as typed `content` items

#### Scenario: Validate Seedance 2.5 capabilities

- **GIVEN** a Seedance 2.5 request
- **WHEN** the request contains a duration outside 1–30 seconds, an unsupported ratio, or more than 30 images, 10 videos, or 10 audios
- **THEN** the system SHALL reject the request before transport

#### Scenario: Preserve Seedance 1.x behavior

- **GIVEN** a user selects an existing Seedance 1.x model
- **WHEN** video generation is submitted
- **THEN** the system SHALL continue using the existing Seedance 1.x adapter and model-name transformation
