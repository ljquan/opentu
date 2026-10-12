## ADDED Requirements

### Requirement: Reference Image Compression SHALL Follow User Preference

Shared reference-image upload, asset-library import, cache-to-AI conversion and generation-request materialization SHALL honor the Keep Original Image preference across image models that use those paths.

#### Scenario: Preserve large reference bytes throughout submission
- **GIVEN** Keep Original Image is enabled
- **AND** an accepted reference exceeds an existing optional compression threshold
- **WHEN** the application converts the reference for caching or submission
- **THEN** optional JPEG re-encoding SHALL be skipped
- **AND** Base64 or multipart transport conversion SHALL preserve the source bytes and MIME type

#### Scenario: Preserve existing compression when disabled
- **GIVEN** Keep Original Image is disabled
- **WHEN** a reference meets the existing compression conditions
- **THEN** the application SHALL apply the existing compression policy

#### Scenario: Enforce input and provider constraints
- **WHEN** a reference violates the existing supported input limits
- **THEN** the application SHALL preserve existing validation and failure behavior
- **AND** the fidelity preference SHALL NOT bypass mandatory provider size or format requirements

#### Scenario: Keep display previews separate
- **GIVEN** a smaller display thumbnail exists
- **WHEN** Keep Original Image is enabled for a reference request
- **THEN** the application SHALL use the original source rather than the display thumbnail

#### Scenario: Default to the existing compact path
- **WHEN** no Keep Original Image preference has been saved
- **THEN** image processing SHALL follow the existing compression policy
- **AND** the original-image option SHALL remain opt-in
