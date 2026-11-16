## ADDED Requirements

### Requirement: Explicit Seedream 5.5 Native Layer Options
The system SHALL offer native Seedream 5.5 layer decomposition with one input, one background and up to 99 foreground artifacts, while retaining the local pipeline's existing limits and behavior.

#### Scenario: User requests the maximum layer limit
- **WHEN** a user explicitly chooses 99 foreground layers
- **THEN** the request SHALL use /api/v3/images/generations with size=auto, output_format=png, response_format=url, watermark=false and layer_decomposition_options.max_images=100
- **AND** up to 100 valid output artifacts SHALL pass native response validation and persist without truncation
- **AND** the normal default SHALL remain 16 foreground layers

#### Scenario: Native failure
- **WHEN** the native request fails or its outcome is unknown
- **THEN** the system SHALL NOT automatically resubmit or switch to another paid model
- **AND** the original image SHALL remain intact

### Requirement: Preserve and Edit Native Rich Text Recognition
The system SHALL request OCR only when enabled and preserve validated data[].text_recognition text, line bounds and style runs through layer persistence and manifest export.

#### Scenario: Convert recognized text
- **WHEN** a user converts a layer with valid OCR into editable text
- **THEN** text lines SHALL be positioned using the output background coordinate system and the source canvas transform
- **AND** text, color and supported styles SHALL be mapped to editable native text nodes
- **AND** font family and size SHALL be described as approximate
- **AND** the original raster layer SHALL remain recoverable, be hidden during text display, and be restored by undo

#### Scenario: Missing or malformed optional recognition
- **WHEN** a valid image artifact has no usable OCR or unsupported style fields
- **THEN** the image SHALL remain available
- **AND** unsupported precision SHALL NOT be fabricated
- **AND** conversion SHALL require usable recognized text and geometry

### Requirement: Recover Native Layer Results Without Resubmission
The system SHALL recover interrupted native Seedream 5.5 requests on supported Tuzi endpoints using a stable request ID and GET-only result polling with the original provider configuration.

#### Scenario: Completed result after submission interruption
- **WHEN** a submitted request loses its response and the result endpoint retains full metadata
- **THEN** GET polling SHALL restore image URLs, z-order, bounds and valid optional OCR
- **AND** the system SHALL NOT replay the POST or switch providers
- **AND** cancellation, source changes and board changes SHALL prevent stale insertion

#### Scenario: Historical URL-only result
- **WHEN** the result endpoint returns success without layer geometry
- **THEN** recovery SHALL report missing metadata instead of inventing geometry or submitting another generation

#### Scenario: Retrieval after a recoverable failure
- **WHEN** the user selects “获取已有结果” in the same dialog after submission
- **THEN** the system SHALL query the same request ID with the captured provider configuration
- **AND** the query SHALL remain bounded and cancellable
