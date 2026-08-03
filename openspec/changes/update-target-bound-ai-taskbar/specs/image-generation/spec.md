## ADDED Requirements

### Requirement: Regeneration SHALL Replace The Bound Image In Place

The system SHALL create a new image task for an edited prompt and replace only the bound image target, including a regular uploaded image.

#### Scenario: Regeneration succeeds

- **GIVEN** a generated image is bound to the AI input bar
- **WHEN** the edited prompt task succeeds
- **THEN** the existing image element SHALL update to the new resource
- **AND** its element ID, position and dimensions SHALL remain unchanged
- **AND** its generation metadata SHALL update to the new task and prompt

#### Scenario: Regeneration fails

- **GIVEN** a generated image is bound to the AI input bar
- **WHEN** the edited prompt task fails
- **THEN** the original image SHALL remain unchanged
- **AND** the AI input bar SHALL expose a recoverable failure state

#### Scenario: Target was removed during generation

- **GIVEN** a replacement task references a bound image
- **AND** the image is removed before generation completes
- **WHEN** the result is processed
- **THEN** the system SHALL report post-processing failure
- **AND** SHALL NOT insert a new unbound image

#### Scenario: Edit one image from a batch

- **GIVEN** a batch produced independently bound images
- **WHEN** one image prompt is edited
- **THEN** only that image SHALL be replaced

#### Scenario: Generate from a regular uploaded image target

- **GIVEN** a regular uploaded image is bound to the AI input bar
- **AND** it has no generation task or anchor
- **WHEN** the user submits a new prompt
- **THEN** the system SHALL create a new image task for that target
- **AND** SHALL NOT inherit a source task, anchor or prompt from another image
- **AND** SHALL replace the uploaded image in place when generation succeeds

### Requirement: Generation After Detaching SHALL Create A New Image

The system SHALL use the ordinary image generation flow after the user closes the current image binding.

#### Scenario: Submit after closing the binding

- **GIVEN** the user closed the AI input bar binding for an image
- **WHEN** the user submits the preserved prompt and configuration
- **THEN** the original image SHALL remain unchanged
- **AND** the result SHALL be inserted as a new image
- **AND** the task SHALL NOT include `replaceElementId`, `targetElementId`, `anchorId`, `sourceTaskId` or `sourcePrompt` from the detached target

#### Scenario: Submit without closing the binding

- **GIVEN** the AI input bar remains bound to an image
- **WHEN** the user submits an edited prompt
- **THEN** the existing in-place replacement behavior SHALL remain unchanged
