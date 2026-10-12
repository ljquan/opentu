## ADDED Requirements

### Requirement: Exact Model Contracts For The Scoped Top 50 Set

The system SHALL track the 26 exact model IDs listed in this change without changing their selected provider or outbound model identity, including explicit unchanged or unconfirmed entries after the Image 2 rollback.

#### Scenario: Runtime display alias is a real API model ID

- **GIVEN** a provider returns `nano-banana-2` as a distinct usable image model ID
- **WHEN** its contract is confirmed and parameter metadata is associated with a known family
- **THEN** the system SHALL reuse only confirmed parameter metadata
- **AND** SHALL preserve `nano-banana-2` in the outbound request and stored ModelRef

#### Scenario: Non-preview Gemini identity remains unchanged

- **WHEN** `gemini-3-pro-image` appears in runtime discovery
- **THEN** the system SHALL reuse the finite parameter metadata mapping
- **AND** SHALL NOT rewrite its outbound ID to `gemini-3-pro-image-preview`
- **AND** delivery documentation SHALL distinguish local metadata from unverified supplier support

### Requirement: Exact Seedream API Parameter Contract

The system SHALL associate doubao-seedream-5-0-lite-260128 and the verified seedream-5.0 ID with existing size and 2K/3K quality metadata, while preserving their outbound IDs and selected providers.

#### Scenario: Discovered Lite ID exposes existing controls

- **WHEN** a provider returns doubao-seedream-5-0-lite-260128 or seedream-5.0
- **THEN** ordinary and native parameter menus SHALL expose the existing size and seedream_quality controls
- **AND** selected values SHALL reach the existing Seedream size conversion and request consumer
- **AND** the request model ID SHALL remain the selected original ID
- **AND** no watermark or Pro-specific parameters SHALL be added

#### Scenario: Verified alias does not imply an engine version

- **WHEN** seedream-5.0 accepts the tested 2K/3K dimensions
- **THEN** the client SHALL expose the corresponding size and quality controls
- **AND** SHALL NOT describe that channel alias as a verified Lite or Pro engine

### Requirement: Preserve Fixed 1K Baseline Contracts

The system SHALL preserve the pre-change absence of a static `gpt-image-2-1k` entry and SHALL preserve the existing fixed contract of `gpt-image-2.5-1k`.

#### Scenario: Image 2 fixed 1K registration is rolled back

- **WHEN** the built-in image catalog is loaded after the rollback
- **THEN** this change SHALL NOT add a static `gpt-image-2-1k` entry or new parameter group
- **AND** pre-existing runtime and adapter behavior SHALL remain unchanged

#### Scenario: Preserve Image 2.5 fixed 1K behavior

- **WHEN** `gpt-image-2.5-1k` is selected
- **THEN** its existing size, quality, background and advanced output options SHALL remain available
- **AND** no extended resolution selector SHALL be added
