## ADDED Requirements

### Requirement: Actual image references define lineage
The system SHALL capture actual image reference identities at submission, reuse existing canvas sources, and materialize missing references only when sending with automatic insertion enabled. It SHALL finish loading all missing references before committing source elements and SHALL cancel a commit if the submission board changes.

#### Scenario: Mixed existing and uploaded references
- **WHEN** a submitted image request uses canvas images and an uploaded image
- **THEN** existing canvas images retain their identities and positions, the uploaded image is inserted once, and all used sources are recorded on every image task

#### Scenario: Reference preparation fails or board changes
- **WHEN** a missing reference cannot be loaded or the active board changes during preparation
- **THEN** no partially prepared sources are inserted and generation is not submitted

### Requirement: Optional reference insertion
The taskbar SHALL provide a locally persisted "Add reference images to canvas" toggle enabled by default. When disabled, off-canvas images SHALL remain in generation requests without creating canvas sources or lines. Existing sources and board/source validation SHALL be preserved. If storage is unavailable, changes SHALL remain effective for the current page session.

#### Scenario: Automatic reference insertion is disabled
- **WHEN** the user disables automatic reference insertion and sends an image request using off-canvas images
- **THEN** all request images SHALL still be used for generation, without inserting missing source images into the canvas
- **AND** existing canvas image sources SHALL retain their identities and source lines in mixed requests

#### Scenario: Insertion preference is restored
- **WHEN** the user changes the toggle and reloads the app
- **THEN** the saved local preference SHALL be restored
- **AND** if local storage is unavailable, the choice SHALL remain effective for the current page session

### Requirement: Direction communicates derivation
The system SHALL place ordinary image derivations to the right of their sources and independent image creations below existing independent creation groups. Sibling batches SHALL share a starting column with downward collision avoidance. Explicit frame generation and semantic replacement SHALL retain their dedicated behavior.

#### Scenario: Portrait reference and repeated generation
- **WHEN** a portrait reference is used for consecutive generation requests
- **THEN** both result groups are on its right, later groups avoid earlier groups downwards, and the original remains unchanged

#### Scenario: Independent generation with unrelated selection
- **WHEN** no image references are submitted even though the canvas has selected elements
- **THEN** the new independent generation is placed downwards without source lines

### Requirement: Configurable batch direction
Taskbar settings SHALL provide a locally persisted "Arrange batch in a row" toggle, disabled by default. Ordinary multi-image requests SHALL reserve one horizontal row when enabled and one column when disabled. Horizontal batches SHALL move down as a whole to avoid obstacles without wrapping. The setting SHALL affect only newly planned tasks; single images, existing slots, frame layouts, and semantic replacement SHALL retain their behavior.

#### Scenario: Horizontal multi-image generation
- **WHEN** the user enables the toggle and submits multiple images in one ordinary image request
- **THEN** all slots SHALL share the same y coordinate with increasing x coordinates, including when the row exceeds the viewport width
- **AND** horizontal rows SHALL start to the right of actual canvas references, or in the independent creation lane when none exist

#### Scenario: Obstacles and consecutive batches
- **WHEN** any slot in a horizontal batch would overlap occupied content
- **THEN** the whole row SHALL move down until all its slots are clear
- **AND** existing sources, results, and pending slots SHALL remain in place

#### Scenario: Switch back to vertical layout
- **WHEN** the user disables the toggle before a new multi-image request
- **THEN** the new batch SHALL use the original column layout
- **AND** pending and completed batches SHALL keep their previous positions

### Requirement: Placeholder and result share lineage
The system SHALL reserve positions before generation and replace placeholders at those positions. Every image in a batch SHALL be connected to the actual sources; retries SHALL reuse the original reservation and sources.

#### Scenario: Batch tasks complete in reverse order
- **WHEN** multiple image tasks complete out of order
- **THEN** each result occupies its own reserved position and retains its own source connections
