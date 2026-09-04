## ADDED Requirements

### Requirement: Image Regeneration SHALL Replace The Bound Target

The system SHALL support regenerating a generated image from an edited prompt and replacing the bound target image in place.

#### Scenario: Regeneration succeeds
- **GIVEN** a generated image is bound to a prompt control
- **WHEN** the user submits an edited prompt and the new image generation task succeeds
- **THEN** the existing image element SHALL update to the new generated image resource
- **AND** its position, dimensions, and selection context SHALL be preserved
- **AND** its stored prompt metadata SHALL update to the edited prompt

#### Scenario: Regeneration fails
- **GIVEN** a generated image is bound to a prompt control
- **WHEN** the user submits an edited prompt and the new image generation task fails
- **THEN** the existing image element SHALL remain unchanged
- **AND** the bound AI input bar SHALL expose the failure state and allow recovery

#### Scenario: Batch image target editing
- **GIVEN** a batch image generation produced multiple inserted images
- **WHEN** the user edits the prompt for one image
- **THEN** only that image target SHALL be replaced after the new generation succeeds
- **AND** sibling generated images SHALL remain unchanged

#### Scenario: Image target is used as reference instead
- **GIVEN** a generated image is bound to the prompt control
- **AND** the user switches the target to reference-only mode
- **WHEN** the user submits a generation request
- **THEN** the original image SHALL remain unchanged
- **AND** the image MAY be passed through the existing reference-image input flow
- **AND** the request SHALL NOT include an in-place replacement binding for that image

#### Scenario: Follow is disabled while a replacement task is still running
- **GIVEN** a follow-controlled image replacement task has already been submitted
- **AND** its result has not yet been inserted
- **WHEN** the user disables taskbar follow
- **THEN** the original image SHALL remain unchanged
- **AND** the completed result SHALL be inserted as a new image
- **AND** the result anchor SHALL NOT restore the old image as its replacement target
