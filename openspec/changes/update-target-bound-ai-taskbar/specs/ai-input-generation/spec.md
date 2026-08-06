## ADDED Requirements

### Requirement: AI Input Bar SHALL Follow The Current Image Target

The system SHALL reuse the existing AI input bar near a selected generated image or regular uploaded image.

#### Scenario: Select a generated image

- **GIVEN** a single image has stored generation prompt metadata
- **WHEN** the user selects the image
- **THEN** the AI input bar SHALL move near the image
- **AND** the image's current taskbar draft SHALL be restored
- **AND** the stored prompt SHALL initialize the editable prompt when the image has no saved draft

#### Scenario: Restore an image-specific draft

- **GIVEN** image A has an edited prompt, manual references and knowledge context
- **WHEN** the user selects image B and then selects image A again
- **THEN** image A's prompt, manual references and knowledge context SHALL be restored
- **AND** image B's draft SHALL remain independent

#### Scenario: Refresh prompt metadata for the same image

- **GIVEN** image A remains selected
- **WHEN** image A's stored prompt metadata changes
- **THEN** an unedited default prompt SHALL update to the new metadata
- **AND** a user-edited prompt SHALL NOT be overwritten

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

#### Scenario: Disable persistent taskbar positioning

- **GIVEN** the AI input bar is bound to a single image on a desktop viewport
- **WHEN** the user turns off the taskbar follow switch at the top-right edge
- **THEN** the input bar SHALL return to its default bottom position
- **AND** the target thumbnail, per-image draft, prompt suggestion, model parameters, knowledge context and in-place replacement binding SHALL remain unchanged
- **AND** the existing close guidance and close button SHALL be hidden so that only the taskbar follow switch remains at the top-right edge
- **AND** the disabled preference SHALL persist across page and board reloads for the same browser origin

#### Scenario: Re-enable persistent taskbar positioning

- **GIVEN** the AI input bar remains bound to an image on a desktop viewport while taskbar follow is disabled
- **WHEN** the user turns on the taskbar follow switch
- **THEN** the input bar SHALL immediately move near the current image
- **AND** the existing close guidance and close button SHALL become available again
- **AND** the enabled preference SHALL persist across page and board reloads for the same browser origin

#### Scenario: Follow preference storage is unavailable or invalid

- **GIVEN** the stored follow preference is missing, invalid or unavailable
- **WHEN** the AI input bar initializes
- **THEN** taskbar follow SHALL default to enabled
- **AND** a storage failure while toggling SHALL NOT interrupt target binding or generation

#### Scenario: Toggle follow on a compact viewport

- **GIVEN** the responsive layout keeps the AI input bar fixed at the bottom
- **WHEN** the user changes the taskbar follow switch
- **THEN** the preference SHALL be persisted for supported desktop viewports
- **AND** the compact taskbar controls SHALL remain visible and functional

### Requirement: AI Input Bar SHALL Allow Detaching The Current Image Target

The system SHALL let the user stop following and replacing the current image while keeping the selected image as a reference.

#### Scenario: Close the current binding

- **GIVEN** the AI input bar is bound to a single image
- **WHEN** the user activates the temporary close action at the top-right edge of the input bar
- **THEN** the input bar SHALL return to its default bottom position
- **AND** the selected image SHALL remain visible as a reference thumbnail
- **AND** the prompt, model, parameters, manually added references and knowledge context SHALL remain unchanged

#### Scenario: Keep the same image selected after closing

- **GIVEN** the user closed the binding for image A
- **AND** image A remains selected
- **WHEN** viewport or pointer events refresh the selection
- **THEN** the input bar SHALL NOT automatically bind to image A again

#### Scenario: Selection changes after temporary closing

- **GIVEN** the user temporarily closed the binding for image A
- **WHEN** the user clears the selection, selects other content or selects an image again
- **THEN** the suppression SHALL be cleared
- **AND** the existing target-following behavior SHALL work normally for the newly selected image

#### Scenario: Always use one image as a reference

- **GIVEN** the AI input bar is bound to image A
- **WHEN** the user chooses to always use image A as a reference
- **THEN** image A SHALL store a lightweight reference-only marker
- **AND** the input bar SHALL return to its default bottom position
- **AND** image A SHALL remain visible as a reference thumbnail
- **WHEN** the board is reloaded and image A is selected again
- **THEN** the input bar SHALL NOT follow image A
- **AND** image A SHALL still be used as a reference
- **AND** other images SHALL keep their existing target-following behavior

#### Scenario: Hide the close guidance after five uses

- **GIVEN** the binding close button is visible
- **WHEN** the user has closed a real image binding fewer than five times in the current browser
- **THEN** the input bar SHALL prominently show `关闭跟随，当前图仍作参考图` beside the button
- **WHEN** the fifth close is recorded
- **THEN** the guidance SHALL remain hidden across page reloads and boards
- **AND** the close button SHALL remain available
