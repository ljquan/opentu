## ADDED Requirements

### Requirement: Generate FLUX 3 Images Through the Verified Tuzi Contract

The system SHALL route a Tuzi `flux-3-image` image request through the OpenAI-compatible `/images/generations` contract and SHALL NOT use the legacy FLUX polling contract by default.

#### Scenario: Text generation returns a normalized image

- **GIVEN** a Tuzi provider profile and model `flux-3-image`
- **WHEN** an image generation request is submitted
- **THEN** the adapter SHALL POST JSON to `/images/generations`
- **AND** include the exact model ID and prompt
- **AND** normalize URL or base64 image data into the existing image result type

#### Scenario: Multiple outputs are preserved

- **GIVEN** the provider returns more than one image in `data`
- **WHEN** the response is normalized
- **THEN** the primary URL SHALL be returned in `url`
- **AND** all usable image URLs SHALL be preserved in `urls`

### Requirement: Expose FLUX 3 Image Size Controls

The system SHALL expose the documented FLUX 3 Image aspect ratios and Tuzi 1K/2K/4K resolution controls for `flux-3-image`. It SHALL translate resolution to `generationConfig.imageConfig.imageSize`, reject unknown controls and unverified 768sq/1.5k tiers, and obtain actual dimensions from returned images.

#### Scenario: Ratio and resolution are serialized

- **GIVEN** a request selects a supported aspect ratio and resolution tier
- **WHEN** the adapter builds the provider request
- **THEN** the corresponding fields SHALL be serialized according to the Tuzi compatibility schema

#### Scenario: Unsupported values do not reach the provider

- **GIVEN** a request contains an unknown ratio or resolution value
- **WHEN** request validation runs
- **THEN** the adapter SHALL reject the value or omit it according to the established parameter policy
- **AND** SHALL NOT send an unvalidated value to the provider

### Requirement: Report Protocol Mismatches Clearly

The system SHALL detect non-JSON responses when a configured FLUX image endpoint is expected to return a task or image response.

#### Scenario: Screenshot endpoint returns HTML

- **GIVEN** a response has `content-type: text/html` for `/flux/v1/flux-3-image`
- **WHEN** the provider response is parsed
- **THEN** the adapter SHALL return an actionable protocol/configuration error
- **AND** SHALL NOT parse the HTML as a task ID or start polling
