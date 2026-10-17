## ADDED Requirements

### Requirement: Bind Tuzi FLUX 3 Image to Its Dedicated Protocol

The system SHALL infer a dedicated Tuzi `flux-3-image` binding that uses the OpenAI-compatible image generation protocol and SHALL keep the legacy `flux.task` binding for other FLUX model IDs.

#### Scenario: Exact model selects Tuzi image binding

- **GIVEN** a Tuzi provider profile and model ID `flux-3-image`
- **WHEN** provider bindings are inferred
- **THEN** one binding SHALL use protocol `openai.images.generations`
- **AND** request schema `tuzi.image.flux-3-generation-json`
- **AND** submit path `/images/generations`

#### Scenario: Existing FLUX models keep polling

- **GIVEN** a Tuzi provider profile and a legacy FLUX model such as `bfl-flux-2-pro`
- **WHEN** provider bindings are inferred
- **THEN** the existing `flux.task` binding SHALL remain available
- **AND** its `/flux/v1/{model}` submission and `/flux/v1/get_result?id={taskId}` polling paths SHALL remain unchanged
