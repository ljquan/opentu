## ADDED Requirements

### Requirement: Inspect Actual SVG Capabilities
The system SHALL derive editable-vector and animation capabilities from the returned SVG content. SVG format or model identity alone SHALL NOT imply animation, independent layers, or full editability.

#### Scenario: Static vector SVG
- **WHEN** a returned SVG contains supported vector structures and no animation
- **THEN** the system SHALL offer only applicable editing operations and preserve a static presentation
- **AND** SHALL NOT inject animation or submit another generation request

#### Scenario: Embedded bitmap
- **WHEN** an SVG contains an embedded raster image without independently editable vector structures
- **THEN** the system SHALL preserve that image and SHALL NOT label it as decomposable vector artwork

### Requirement: Preserve Source During Vector Editing
The system SHALL preserve the original SVG while converting supported source structures into independently editable canvas elements. Unsupported structures SHALL have an explicit fallback rather than silently losing content.

#### Scenario: Supported conversion
- **WHEN** the user explicitly converts a supported SVG
- **THEN** the resulting elements SHALL preserve source geometry, appearance and applicable grouping within the confirmed conversion scope
- **AND** support individual selection, movement and applicable color changes
- **AND** preserve the original SVG for recovery and download

#### Scenario: Unsupported effects or conversion failure
- **WHEN** the SVG cannot be converted within the supported scope, a resource is missing, or conversion fails
- **THEN** the original image SHALL remain intact and the system SHALL explain the limitation
- **AND** a partial conversion SHALL NOT replace the original image

### Requirement: Play Only Existing SVG Animation
The system SHALL expose playback controls only when a returned SVG contains a supported native animation. This SHALL NOT be presented as a guarantee of SVG animation generation for any GPT Image 2.6 model.

#### Scenario: Supported existing animation
- **WHEN** the original SVG contains a supported native animation
- **THEN** the system SHALL preserve and allow playback of that animation from the original source
- **AND** a static thumbnail SHALL NOT be reported as successful animation playback

#### Scenario: Static or unsupported animation content
- **WHEN** the SVG is static or its animation mechanism is unsupported
- **THEN** the system SHALL retain an accurate static or fallback presentation without fabricating motion
- **AND** SHALL NOT enable playback controls that imply working animation
- **AND** SHALL NOT execute arbitrary SVG JavaScript to obtain playback
