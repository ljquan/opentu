## ADDED Requirements

### Requirement: Route Provider-Backed Models Through Explicit Protocol Bindings

The system SHALL resolve provider-backed invocations through explicit protocol bindings instead of inferring the execution path from the bare model identifier alone.

#### Scenario: Same model ID uses different protocols in different provider profiles

- **GIVEN** two enabled provider profiles both expose a model with the ID `gemini-3-pro-image-preview`
- **AND** one profile binds image generation to an OpenAI-compatible `/images/generations` protocol while the other binds image generation to a Gemini official `:generateContent` protocol
- **WHEN** the user invokes image generation with a `ModelRef` that points to one of those provider profiles
- **THEN** the system SHALL choose the protocol binding that belongs to that provider profile
- **AND** SHALL not assume that the same model ID implies the same protocol across providers

#### Scenario: Same provider model has multiple protocol bindings

- **GIVEN** a provider-backed model has more than one protocol binding for the same operation
- **WHEN** the user invokes that operation without a manual binding override
- **THEN** the system SHALL choose the highest-priority valid binding for that invocation
- **AND** SHALL allow lower-priority bindings to remain available for advanced override flows

### Requirement: Adapt Request Bodies Through Request Schemas

The system SHALL separate protocol selection from request body construction so that models using the same protocol can still be invoked with different request schemas.

#### Scenario: Same protocol requires different fields for different models

- **GIVEN** two models use the same logical protocol family
- **AND** one requires a JSON body while the other requires multipart form fields such as `input_reference` or `first_frame_image`
- **WHEN** the system builds a request for either model
- **THEN** it SHALL use the request schema associated with that model binding
- **AND** SHALL not rely on a single shared payload shape for every model in that protocol family

#### Scenario: Same operation uses different request schemas under one provider

- **GIVEN** a provider exposes multiple video-capable models
- **AND** those models require different request field layouts for the same video generation operation
- **WHEN** the user invokes video generation
- **THEN** the system SHALL select the request schema attached to the chosen binding
- **AND** SHALL serialize the request body accordingly

### Requirement: Unify Text, Image, And Video Invocation Planning

The system SHALL use one invocation planner for text, image, and video requests so that every modality resolves through the same provider context and binding model.

#### Scenario: Text invocation follows the same planner as image and video

- **GIVEN** a provider profile exposes text and image models through different protocols
- **WHEN** the user invokes a text request and then an image request
- **THEN** both requests SHALL resolve through the same invocation planning pipeline
- **AND** each request SHALL select its own binding based on the requested operation

### Requirement: Apply Provider Transport Strategies At Runtime

The system SHALL execute each binding through a provider transport that applies the binding's provider-specific authentication and request transport rules.

#### Scenario: Different providers require different authentication styles

- **GIVEN** one provider binding requires Bearer authentication
- **AND** another provider binding requires a provider-specific header or query parameter
- **WHEN** the system executes invocations for those bindings
- **THEN** the provider transport SHALL apply the correct authentication strategy for each provider
- **AND** the protocol adapter SHALL not hardcode a single authentication style for all providers

### Requirement: Preserve Binding Identity Across Discovery And Selection

The system SHALL preserve provider and binding provenance across discovery, model selection, and runtime invocation.

#### Scenario: Discovery keeps same model ID separate by provider

- **GIVEN** two provider profiles discover models with the same `modelId`
- **WHEN** the discovery results are stored and exposed to selectors
- **THEN** the system SHALL preserve each model's `profileId` and selection identity
- **AND** SHALL not collapse those entries into one global runtime model solely by `modelId`

#### Scenario: Runtime invocation can resolve binding metadata from selection

- **GIVEN** the user selected a provider-backed model in a selector
- **WHEN** a request is submitted later from another entry point
- **THEN** the system SHALL be able to recover the provider context and binding metadata from that selection
- **AND** SHALL route the request through the same provider-specific protocol binding
