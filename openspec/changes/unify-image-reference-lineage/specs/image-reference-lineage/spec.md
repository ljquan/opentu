## ADDED Requirements

### Requirement: Actual image references define lineage
The system SHALL capture actual image reference identities at submission, reuse existing canvas sources, and materialize missing references only when sending. It SHALL finish loading all missing references before committing source elements and SHALL cancel a commit if the submission board changes.

#### Scenario: Mixed existing and uploaded references
- **WHEN** a submitted image request uses canvas images and an uploaded image
- **THEN** existing canvas images retain their identities and positions, the uploaded image is inserted once, and all used sources are recorded on every image task

#### Scenario: Reference preparation fails or board changes
- **WHEN** a missing reference cannot be loaded or the active board changes during preparation
- **THEN** no partially prepared sources are inserted and generation is not submitted

### Requirement: Direction communicates derivation
The system SHALL place ordinary image derivations to the right of their sources and independent image creations below existing independent creation groups. Sibling derivations SHALL share a result column with downward collision avoidance. Explicit frame generation and semantic replacement SHALL retain their dedicated behavior.

#### Scenario: Portrait reference and repeated generation
- **WHEN** a portrait reference is used for consecutive generation requests
- **THEN** both result groups are on its right, later groups avoid earlier groups downwards, and the original remains unchanged

#### Scenario: Independent generation with unrelated selection
- **WHEN** no image references are submitted even though the canvas has selected elements
- **THEN** the new independent generation is placed downwards without source lines

### Requirement: Placeholder and result share lineage
The system SHALL reserve positions before generation and replace placeholders at those positions. Every image in a batch SHALL be connected to the actual sources; retries SHALL reuse the original reservation and sources.

#### Scenario: Batch tasks complete in reverse order
- **WHEN** multiple image tasks complete out of order
- **THEN** each result occupies its own reserved position and retains its own source connections
