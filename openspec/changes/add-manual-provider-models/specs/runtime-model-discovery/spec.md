## ADDED Requirements

### Requirement: Manually Add Provider Models With Interface Bindings

The system SHALL allow users to manually add a model and controlled interface binding to a specific provider catalog when automatic model discovery is unavailable, incomplete, or unable to infer the desired endpoint.

#### Scenario: Add manual model to provider catalog

- **GIVEN** the user is editing a provider profile
- **WHEN** the user enters a model ID, chooses text, image, video, or audio, and chooses a built-in invocation method
- **THEN** the system SHALL create a runtime model config under that provider catalog
- **AND** the model SHALL be selected for that provider by default
- **AND** the catalog SHALL persist a manual binding for the selected built-in protocol and submit path

#### Scenario: Manual model preserves provider ownership

- **GIVEN** a manually added model belongs to a provider profile
- **WHEN** the model appears in selectors or preset editors
- **THEN** the model SHALL preserve its owning `profileId`
- **AND** invocations using the model SHALL resolve credentials from that provider profile
- **AND** invocation planning SHALL prefer the matching manual binding over inferred template bindings

#### Scenario: Refresh keeps manual models

- **GIVEN** a provider catalog contains manually added models
- **WHEN** the user refreshes models from the remote `/models` endpoint
- **THEN** manually added models SHALL remain available unless the user explicitly removes them
- **AND** manual bindings SHALL remain available unless the user explicitly removes the model
- **AND** newly discovered models SHALL be merged without deleting manual entries

#### Scenario: Duplicate manual model updates metadata and binding

- **GIVEN** a provider catalog already contains a manual model with the same model ID and type
- **WHEN** the user adds that model again with a new display name, description, or invocation method
- **THEN** the system SHALL update the existing model metadata instead of creating a duplicate selectable entry
- **AND** the system SHALL replace the previous manual binding for that model

#### Scenario: Same manual model ID cannot be reused across types

- **GIVEN** a provider catalog already contains a manual model with a model ID and a different model type
- **WHEN** the user adds another manual model with the same model ID under that provider
- **THEN** the system SHALL refuse to save it
- **AND** the system SHALL ask the user to choose another model ID or remove the existing model first

### Requirement: Validate Manual Model Input

The system SHALL validate manual model input before persisting it.

#### Scenario: Reject empty manual model ID

- **GIVEN** the user opens the manual model form
- **WHEN** the model ID is empty or only whitespace
- **THEN** the system SHALL refuse to save the model
- **AND** show a visible validation message

#### Scenario: Require model type

- **GIVEN** the user opens the manual model form
- **WHEN** no model type is selected
- **THEN** the system SHALL refuse to save the model
- **AND** ask the user to choose text, image, video, or audio

### Requirement: Route Manual Interface Bindings

The system SHALL route manually bound text, image, video, and audio models through existing provider transport and built-in adapters in the same way as fixed models.

#### Scenario: Custom HTTP binding remains independent from inferred routes

- **GIVEN** a manual model has a `custom-http` binding and automatic discovery also infers a built-in binding for the same model ID
- **WHEN** the model is invoked with schema preferences or asynchronous image preferences
- **THEN** invocation planning SHALL select the explicit manual `custom-http` binding
- **AND** SHALL call the configured request URL without rewriting it to a built-in endpoint

#### Scenario: Manual text binding reuses the built-in chat call

- **GIVEN** a custom text model is saved with the OpenAI chat invocation method
- **WHEN** the text generation or chat flow invokes that model
- **THEN** invocation planning SHALL select the manual `openai.chat.completions` binding
- **AND** the text executor SHALL build and parse the request in the same way as a fixed OpenAI-compatible text model

#### Scenario: Manual Tuzi image edit binding returns data urls

- **GIVEN** a custom image model is saved with the Tuzi image edit JSON preset
- **WHEN** the image generation flow invokes that model
- **THEN** invocation planning SHALL select the manual `tuzi.image.gpt-edit-json` binding
- **AND** the existing image adapter SHALL parse OpenAI-style `data[].url` or `data[].b64_json` responses

#### Scenario: Manual image binding switches generation and edit calls automatically

- **GIVEN** a custom image model is saved with a built-in image invocation method
- **WHEN** the image generation flow invokes that model with or without reference images
- **THEN** the existing image adapter SHALL choose the matching generation or edit endpoint automatically
- **AND** prompt, reference images, size, and quality SHALL come from the existing generation panel

#### Scenario: Manual video binding uses configured submit and poll paths

- **GIVEN** a custom video model is saved with a video task preset
- **WHEN** the video generation flow invokes that model
- **THEN** invocation planning SHALL select the matching manual video binding
- **AND** the video executor SHALL submit and poll using the configured binding paths

#### Scenario: Manual audio binding uses configured Suno paths

- **GIVEN** a custom audio model is saved with the Suno music preset
- **WHEN** the audio generation flow invokes that model
- **THEN** invocation planning SHALL select the manual `tuzi.suno.music` binding
- **AND** the audio executor SHALL submit and poll using the configured binding paths

## MODIFIED Requirements

### Requirement: Reuse Runtime Model Lists Across Selectors

All model selectors that currently depend on static model lists SHALL resolve models from provider-scoped catalogs while preserving provider provenance, with static models remaining available as system defaults and manually added provider models treated as first-class runtime models.

#### Scenario: Selectors show manual provider models

- **GIVEN** a user has manually added a model to an enabled provider profile
- **WHEN** the user opens an image, video, audio, or text model selector matching that model type
- **THEN** the selector SHALL include the manual model in the provider-backed model list
- **AND** choosing it SHALL preserve both `modelId` and owning `profileId`
