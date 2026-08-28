## ADDED Requirements

### Requirement: Discoverable Seedance 2.5 Model Metadata

The system SHALL expose `doubao-seedance-2-5-260628` as a video model with Seedance 2 JSON-compatible capabilities in both the static catalog and runtime-discovered model flows.

#### Scenario: Select Seedance 2.5

- **GIVEN** the model catalog contains `doubao-seedance-2-5-260628`
- **WHEN** a user opens a video model selector
- **THEN** the model SHALL be classified as a Seedance video model
- **AND** SHALL expose 4–30 second durations and 16:9/4:3/1:1/3:4/9:16/21:9/adaptive ratios
- **AND** SHALL NOT expose a resolution control while the endpoint schema does not declare one

#### Scenario: Preserve version-specific controls

- **GIVEN** a user switches between Seedance 2.0 and 2.5
- **WHEN** generation parameters are resolved
- **THEN** each model SHALL use its own duration, ratio, and reference-count limits
- **AND** Seedance 2.5 SHALL NOT inherit controls that are not declared by its endpoint metadata
