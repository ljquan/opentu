## ADDED Requirements

### Requirement: AI Input Bar SHALL Support Generated Targets Across Media Types

The system SHALL reuse the existing AI input bar for a single generated image, video, audio or text target that has recoverable generation prompt metadata.

#### Scenario: Select a generated media or text target

- **GIVEN** a single image, video, audio or text element stores a non-empty generation prompt
- **WHEN** the user selects that element
- **THEN** the AI input bar SHALL bind to the selected element
- **AND** SHALL switch to the matching generation type
- **AND** SHALL show the stored prompt as a reusable ghost suggestion when the target draft is empty

#### Scenario: Restore a prompt through an explicit task binding

- **GIVEN** a generated video, audio or text element stores a generation task ID but no prompt
- **AND** the referenced task stores a non-empty generation prompt
- **WHEN** the user selects that element
- **THEN** the AI input bar SHALL recover the prompt through that exact task ID
- **AND** SHALL NOT scan unrelated task history, element text or media URLs for a match

#### Scenario: Keep ordinary content out of generated-target mode

- **GIVEN** a text, video or audio element has no generation prompt metadata
- **AND** its generation task ID does not resolve to a task with a prompt
- **WHEN** the user selects that element
- **THEN** the system SHALL keep the existing ordinary selection behavior
- **AND** SHALL NOT infer a generation prompt from the text body or media URL

#### Scenario: Submit edited prompt in follow mode

- **GIVEN** the AI input bar is bound to a generated image, video, audio or text target
- **AND** the user edits the prompt in the AI input bar
- **WHEN** the user submits the edit
- **THEN** the system SHALL create a new generation task of the same type using the edited prompt
- **AND** a successful single result SHALL replace the selected target in place
- **AND** the target position, dimensions, selection context and generation metadata SHALL be preserved or updated as applicable

#### Scenario: Clear generated target selection

- **GIVEN** the AI input bar is bound to a generated target
- **WHEN** the user clears the target selection
- **THEN** the AI input bar SHALL return to its default bottom position

### Requirement: Image Video And Text Targets SHALL Support Reference Or Context Mode

The system SHALL allow a generated image, video or text target to stop replacing the selected element while preserving supported target content as generation context.

#### Scenario: Control taskbar follow for an image video or text target

- **GIVEN** a generated image, video or text target is bound to the AI input bar
- **WHEN** the target controls are shown
- **THEN** the taskbar SHALL offer the follow switch, close action and close-mode menu
- **AND** all labels SHALL describe the selected target type as an image, video or text context

#### Scenario: Disable taskbar follow and keep the target as context

- **GIVEN** a generated image, video or text target is bound in follow mode
- **WHEN** the user disables taskbar follow positioning
- **THEN** the taskbar SHALL return to its default bottom position
- **AND** the target and its draft SHALL remain active as reference or context
- **AND** the next generation SHALL NOT replace the original target
- **AND** a previously submitted follow-controlled task that has not inserted its result SHALL insert a new result instead of replacing the original target
- **WHEN** the user enables positioning again
- **THEN** the taskbar SHALL return near the selected target
- **AND** follow mode SHALL again allow a successful single result to replace the target in place

#### Scenario: Use an image or video target as reference

- **GIVEN** a generated image or video target is bound in follow mode
- **WHEN** the user chooses the temporary or persistent reference-only action
- **THEN** the target SHALL remain available as matching image or video generation context
- **AND** the next generation SHALL NOT replace the original target
- **AND** a persistent choice SHALL be restored when the target is selected again

#### Scenario: Use a text target as context

- **GIVEN** a generated text target is bound in follow mode
- **WHEN** the user chooses the temporary or persistent context-only action
- **THEN** the generated text body SHALL remain available as text generation context
- **AND** the next generation SHALL NOT replace the original text element
- **AND** a persistent choice SHALL be restored when the target is selected again

#### Scenario: Audio remains follow-only

- **GIVEN** a generated audio target is bound to the AI input bar
- **WHEN** the target prompt controls are shown
- **THEN** the prompt SHALL remain reusable and the target SHALL remain in follow mode for same-type generation
- **AND** the taskbar SHALL NOT expose a reference-only action or imply support for audio reference input

### Requirement: AI Input Bar SHALL Show Reusable Target Prompt Suggestions

The system SHALL keep a recovered target prompt as a transient ghost suggestion instead of placing it into the editable input value.

#### Scenario: Reuse the target prompt with keyboard input

- **GIVEN** the bound target has a non-empty recovered prompt
- **AND** the editable input is empty
- **WHEN** the user presses Space or Enter
- **THEN** the system SHALL copy the suggestion into the editable input
- **AND** SHALL NOT submit the generation request during that key press
- **AND** SHALL show a hint that Space or Enter reuses the prompt

#### Scenario: Dismiss the target prompt suggestion

- **GIVEN** a transient target prompt suggestion is visible
- **WHEN** the user types another character or activates another taskbar button
- **THEN** the system SHALL remove the suggestion
- **AND** SHALL keep the editable input empty until the user provides content

#### Scenario: Ignore an asynchronous prompt refresh after dismissal

- **GIVEN** the user dismissed a target prompt suggestion
- **WHEN** an asynchronous refresh completes for the same target
- **THEN** the dismissed suggestion SHALL NOT reappear

### Requirement: Generated Canvas Results SHALL Preserve Reusable Prompt Metadata

The system SHALL store only the lightweight prompt and task identity metadata needed to restore generated target editing across supported media types.

#### Scenario: Insert a generated result

- **WHEN** an image, video, audio or text generation result is inserted into the canvas
- **THEN** the inserted element SHALL retain its generation prompt and task ID when available
- **AND** SHALL NOT retain media binaries or full task history as target metadata

#### Scenario: Switch between generated target types

- **GIVEN** generated targets A and B have independent prompts and different supported types
- **WHEN** the user selects A and then B
- **THEN** the taskbar SHALL show only B's prompt suggestion, draft and generation type
- **AND** a late asynchronous result for A SHALL NOT overwrite B's target state
