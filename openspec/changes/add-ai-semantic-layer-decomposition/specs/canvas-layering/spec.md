## ADDED Requirements

### Requirement: Reconstructable editable layer group

The canvas SHALL represent a successful decomposition as one group containing a background and independently editable image elements. Each layer SHALL retain its name, description, z-index, source group identifier, confidence, and absolute and normalized bounding boxes. Service z-index zero maps to the bottom-most `board.children` entry; larger values are inserted above it and the LayerPanel displays them in reverse order.

#### Scenario: Preserve visual composition

- **WHEN** all returned layers are visible
- **THEN** the group SHALL occupy the original image bounds and visually reconstruct the source image within the configured quality tolerance

#### Scenario: One-click automatic application

- **WHEN** a user selects one image and clicks the AI layer command
- **THEN** the client SHALL immediately run automatic decomposition and atomically apply a valid result without requiring configuration or a second confirmation

#### Scenario: Quality gate

- **WHEN** all layers are recomposed
- **THEN** the client SHALL commit only when SSIM is at least 0.999 and at least 99.9% of pixel channels have absolute error no greater than 1; otherwise it SHALL preserve the source and expose correction/retry

#### Scenario: Independent editing

- **WHEN** a user hides, moves, scales, locks, or reorders one layer
- **THEN** only that layer or its explicit group operation SHALL change, while the remaining layers retain their geometry

#### Scenario: Source transform preservation

- **WHEN** a source image has a canvas position, scale, rotation, or opacity
- **THEN** the decomposition group SHALL inherit the source bounds and transform, and each layer bbox SHALL be converted from source pixels into those canvas units without changing the group's visual placement

### Requirement: Durable layer state

The system SHALL cache remote outputs as stable local assets and SHALL preserve layer state, ordering, visibility, locking, and metadata across reload and export.

#### Scenario: Reload and export

- **WHEN** a decomposed canvas is reopened or exported
- **THEN** the same layer manifest and transparent PNG assets SHALL remain available without relying on an expiring provider URL

#### Scenario: Export manifest

- **WHEN** a user exports a decomposed group
- **THEN** the client SHALL provide the reconstructed background, each transparent PNG layer in z-order, and a JSON manifest containing names, descriptions, confidence, z-index, source group id, and both bbox forms
