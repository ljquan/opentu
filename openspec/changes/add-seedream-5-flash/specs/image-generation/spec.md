## ADDED Requirements

### Requirement: Support Seedream Flash Generation Contract

The system SHALL expose `doubao-seedream-5-0-flash-260915` through the existing image generation entry points using an isolated Flash request contract.

#### Scenario: Select Flash generation controls

- **WHEN** the user selects the exact Flash model
- **THEN** the model SHALL offer `1K`, `1.5K`, and `2K` size tiers
- **AND** SHALL NOT inherit legacy Seedream 3K/4K quality or ratio-to-pixel mappings
- **AND** SHALL preserve the exact outbound model ID and selected provider identity

#### Scenario: Submit ordinary generation

- **GIVEN** a non-empty prompt and zero to ten valid reference images
- **WHEN** a Flash image task is submitted
- **THEN** the adapter SHALL construct a synchronous JSON request using only documented fields
- **AND** SHALL preserve an explicit boolean `watermark:false`
- **AND** SHALL NOT send `n`, `quality`, `seed`, mask fields, unknown fields, or null values

#### Scenario: Validate precise dimensions

- **WHEN** a caller supplies explicit pixel dimensions
- **THEN** the system SHALL require positive integer dimensions, a pixel count from 921600 through 4624220, and an aspect ratio from 1:16 through 16:1, including boundaries
- **AND** invalid dimensions SHALL fail before a generation request is sent

### Requirement: Enforce Flash Transparent Reference Constraints

The system SHALL permit transparent Flash output only with exactly one valid PNG reference containing an alpha channel and PNG output, preserving reference transparency during preparation.

#### Scenario: Submit a valid transparent reference

- **GIVEN** one valid alpha-bearing PNG reference and transparent PNG output
- **WHEN** the task is prepared and submitted
- **THEN** the submitted reference SHALL retain its alpha channel
- **AND** the request SHALL contain `background:transparent` and `output_format:png`

#### Scenario: Reject invalid transparent combinations

- **WHEN** transparent output is requested with no reference, multiple references, an invalid reference, or explicit JPEG output
- **THEN** the task SHALL fail with an actionable validation error before sending a generation request
- **AND** a PNG filename or signature alone SHALL NOT establish alpha-channel validity

### Requirement: Normalize Flash Image Results Without Guessing Layer Geometry

The system SHALL support URL and Base64 Flash generation results through the existing image result contract, retain the raw response, and distinguish provider size metadata from measured image dimensions.

#### Scenario: Normalize JPEG Base64

- **GIVEN** a successful `b64_json` response reporting JPEG output
- **WHEN** the adapter normalizes the image
- **THEN** the result SHALL use the JPEG MIME type
- **AND** SHALL retain the raw response and any valid size metadata

#### Scenario: Fail without valid image output

- **WHEN** the service returns an HTTP error, an error payload, or no valid image data
- **THEN** the task SHALL report failure without automatic generation resubmission

#### Scenario: Keep Flash native layers out of ordinary generation

- **WHEN** ordinary Flash generation is configured
- **THEN** it SHALL NOT expose `layer_decomposition:true` as a generation option or infer canvas geometry from undocumented layer metadata
- **AND** the existing local decomposition and Pro recovery path SHALL retain their current behavior
