## ADDED Requirements

### Requirement: AI Input Bar SHALL Follow The Current Image Target

The system SHALL reuse the existing AI input bar near a selected generated image or regular uploaded image.

#### Scenario: Select a generated image

- **GIVEN** a single image has stored generation prompt metadata
- **WHEN** the user selects the image
- **THEN** the AI input bar SHALL move near the image
- **AND** SHALL restore the image prompt for editing

#### Scenario: Clear target selection

- **GIVEN** the AI input bar is bound to a generated image
- **WHEN** the user clears the selection or selects unsupported content
- **THEN** the AI input bar SHALL return to its default bottom position

#### Scenario: Select a regular uploaded image

- **GIVEN** an image has no generation prompt or task binding
- **WHEN** the user selects the image
- **THEN** the AI input bar SHALL move near the image
- **AND** SHALL show the selected image as the current target
- **AND** SHALL use an empty prompt
- **AND** SHALL NOT match an image task by an asset-library URL
- **AND** SHALL NOT inherit another image's prompt, task, anchor, attachments or knowledge context

#### Scenario: Change the current image target

- **GIVEN** the AI input bar is bound to image A
- **WHEN** the user selects image B
- **THEN** the target thumbnail SHALL display image B
- **AND** image A's asynchronous Blob result or retry timer SHALL NOT overwrite image B

#### Scenario: Replace the source of the same image element

- **GIVEN** an image remains selected
- **WHEN** its URL, prompt, task ID or anchor ID changes in place
- **THEN** the AI input bar SHALL refresh the target context without requiring reselection

### Requirement: AI Input Bar SHALL Allow Detaching The Current Image Target

The system SHALL let the user close the current image binding without changing the selected image or the existing target-following behavior.

#### Scenario: Close the current binding

- **GIVEN** the AI input bar is bound to a single image
- **WHEN** the user activates the close button at the top-right edge of the input bar
- **THEN** the input bar SHALL return to its default bottom position
- **AND** the automatic target thumbnail SHALL be removed
- **AND** the prompt, model, parameters, manually added references and knowledge context SHALL remain unchanged

#### Scenario: Keep the same image selected after closing

- **GIVEN** the user closed the binding for image A
- **AND** image A remains selected
- **WHEN** viewport or pointer events refresh the selection
- **THEN** the input bar SHALL NOT automatically bind to image A again

#### Scenario: Selection changes after closing

- **GIVEN** the user closed the binding for image A
- **WHEN** the user clears the selection, selects other content or selects an image again
- **THEN** the suppression SHALL be cleared
- **AND** the existing target-following behavior SHALL work normally for the newly selected image

#### Scenario: Hide the close guidance after five uses

- **GIVEN** the binding close button is visible
- **WHEN** the user has closed a real image binding fewer than five times in the current browser
- **THEN** the input bar SHALL prominently show `关闭任务栏跟随，后续生成新图片` beside the button
- **WHEN** the fifth close is recorded
- **THEN** the guidance SHALL remain hidden across page reloads and boards
- **AND** the close button SHALL remain available
