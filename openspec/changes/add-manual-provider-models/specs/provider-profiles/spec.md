## ADDED Requirements

### Requirement: Manage Custom Interface Models Within Provider Profiles

The provider profile management surface SHALL provide a lightweight way to add provider-owned models that are not returned by automatic discovery and bind them to existing built-in invocation methods.

#### Scenario: Open custom interface model form from provider detail

- **GIVEN** the user is viewing a provider profile detail
- **WHEN** the user chooses to add a custom model
- **THEN** the system SHALL show fields for model ID, model type, invocation method, optional display name, and optional description
- **AND** the selected invocation method SHALL supply its protocol, request schema, submit path, request handling, and optional poll path automatically
- **AND** the saved model SHALL belong only to the current provider profile

#### Scenario: Configure an independent custom HTTP model

- **GIVEN** the user is adding a text, image, video, or audio model
- **WHEN** the user selects the custom HTTP invocation method
- **THEN** the system SHALL allow a request URL, HTTP method, body type, request template, response field path, and optional polling configuration
- **AND** SHALL inject prompt, reference images, size, duration, messages, and model ID from the existing generation surfaces through bounded template variables
- **AND** SHALL save the binding as `custom-http` instead of mapping it to a built-in model protocol

#### Scenario: Custom interface model does not create a new provider

- **GIVEN** the user adds a custom interface model under an existing provider
- **WHEN** the model is saved
- **THEN** the system SHALL reuse the provider's existing Base URL, API Key, auth type, capabilities, and compatibility settings
- **AND** SHALL NOT create a separate provider profile or script runtime

#### Scenario: Custom interface model stores a manual binding for any supported model type

- **GIVEN** the user configures a custom interface model using a text, image, video, or audio preset
- **WHEN** the model is saved
- **THEN** the provider catalog SHALL store a manual binding containing the built-in invocation method's protocol, request schema, response schema, submit path, and optional poll path
- **AND** the binding SHALL be available to invocation planning for the saved model

#### Scenario: Remove custom interface model from provider

- **GIVEN** a provider profile contains a custom interface model
- **WHEN** the user removes that model from the provider model list
- **THEN** the model SHALL no longer appear in selectors for that provider
- **AND** manual bindings for that model SHALL be removed
- **AND** unrelated discovered or selected models SHALL remain unchanged
