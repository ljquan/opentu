## ADDED Requirements

### Requirement: Automatically Open Details On Image Click

The system SHALL automatically open image details on an ordinary primary-button click on a single image by default. The details panel header SHALL provide an accessible switch to disable or enable this behavior. The preference SHALL persist locally when storage is available and remain effective for the current session when storage fails.

#### Scenario: Default automatic opening

- **WHEN** the user clicks a single image with no recorded preference
- **THEN** the image details panel SHALL open automatically
- **AND** another ordinary click on the same image after closing the panel SHALL open it again
- **AND** dragging, modifier clicks, right-clicks, multi-selection and toolbar interactions SHALL NOT request automatic opening

#### Scenario: Automatic opening disabled

- **WHEN** the user disables the header switch
- **THEN** subsequent image clicks SHALL NOT open details automatically
- **AND** the toolbar information icon SHALL still open details manually
- **AND** enabling the switch again SHALL restore automatic opening for subsequent image clicks

#### Scenario: Preference storage fails

- **WHEN** preference storage is unavailable
- **THEN** automatic opening SHALL default to enabled
- **AND** a user-selected preference SHALL remain effective for the current session

### Requirement: View Canvas Image Generation Details

The system SHALL provide an accessible information icon after the delete action in the toolbar for a single selected canvas image. Activating the icon SHALL open a read-only details panel with recorded generation time, completion time when available, model, prompt, generation parameters and image dimensions. Displayed parameters SHALL exclude credentials and authentication data.

#### Scenario: Details are placed outside the main image

- **WHEN** the details panel opens and the image has sufficient space on its right
- **THEN** the panel SHALL appear to the right of the image with a gap
- **WHEN** the right side is too narrow but the left side has sufficient space
- **THEN** the panel SHALL appear on the left instead of covering the image
- **WHEN** neither side has sufficient space
- **THEN** the panel SHALL use vertical space outside the image with scrollable content

#### Scenario: Generated image has a recorded task

- **WHEN** the user opens details for an image associated with a generation task
- **THEN** the panel SHALL display the recorded task creation time as generation time, the recorded model, prompt and generation parameters
- **AND** the panel SHALL display completion time when recorded
- **AND** task lookup SHALL prefer the image's bound generation task ID and fall back to the existing result URL lookup when no bound task is available
- **AND** opening details SHALL NOT submit a generation request or modify the image

#### Scenario: Image has no generation record

- **WHEN** the user opens details for an uploaded image or an image whose original generation record is unavailable
- **THEN** the panel SHALL show available image dimensions and prompt
- **AND** missing generation fields SHALL be labeled as unrecorded without inferring a model or timestamp

#### Scenario: Task lookup fails

- **WHEN** reading the generation record fails
- **THEN** the panel SHALL display a readable error and offer retry
- **AND** the failure SHALL NOT be represented as an image without a generation record

#### Scenario: Selection and panel lifecycle

- **WHEN** multiple elements or a non-image element are selected
- **THEN** the image details action SHALL NOT be displayed
- **WHEN** the panel is closed
- **THEN** the image selection SHALL be preserved
- **WHEN** the selected image changes during an asynchronous lookup
- **THEN** the panel SHALL NOT display a previous image's generation record for the new selection
