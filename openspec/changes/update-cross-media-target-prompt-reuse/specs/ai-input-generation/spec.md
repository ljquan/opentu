## ADDED Requirements

### Requirement: AI Input Bar SHALL Offer Generated Target Prompts Across Media Types

The system SHALL offer a reusable ghost prompt when a single generated image, video, audio or text element has lightweight generation prompt metadata.

#### Scenario: Select a generated media or text target

- **GIVEN** a single image, video, audio or text element stores a non-empty generation prompt
- **WHEN** the user selects that element
- **THEN** the AI input bar SHALL bind to the selected element
- **AND** SHALL switch to the matching generation type
- **AND** SHALL show the stored prompt as a ghost suggestion when the target draft is empty

#### Scenario: Reuse a cross-media target prompt

- **GIVEN** a generated target prompt is visible as a ghost suggestion
- **AND** the editable prompt is empty
- **WHEN** the user presses Space or Enter without a modifier
- **THEN** the system SHALL copy the suggestion into the editable prompt
- **AND** SHALL NOT submit a generation request during that key press

#### Scenario: Dismiss a cross-media target prompt

- **GIVEN** a generated target prompt is visible as a ghost suggestion
- **WHEN** the user types another character or activates another taskbar control
- **THEN** the system SHALL dismiss the suggestion
- **AND** an asynchronous refresh for the same task SHALL NOT restore the dismissed suggestion

#### Scenario: Select ordinary non-image content

- **GIVEN** a text, video or audio element has no generation prompt metadata or generation task binding
- **WHEN** the user selects that element
- **THEN** the system SHALL NOT infer a prompt from the text body or media URL
- **AND** SHALL keep the existing ordinary selection behavior

#### Scenario: Restore a prompt through an explicit task binding

- **GIVEN** a generated video, audio or text element stores a generation task ID but no prompt
- **AND** the referenced task stores a non-empty generation prompt
- **WHEN** the user selects that element
- **THEN** the AI input bar SHALL recover the prompt through that exact task ID
- **AND** SHALL show it as the target's ghost suggestion

#### Scenario: Ignore a stale task binding without a prompt

- **GIVEN** a video, audio or text element has no generation prompt metadata
- **AND** its generation task ID does not resolve to a task with a prompt
- **WHEN** the user selects that element
- **THEN** the system SHALL keep the existing ordinary selection behavior
- **AND** SHALL NOT scan unrelated task history for a match

#### Scenario: Switch between generated target types

- **GIVEN** generated targets A and B have independent prompts and different supported types
- **WHEN** the user selects A and then B
- **THEN** the taskbar SHALL show only B's prompt suggestion and generation type
- **AND** a late asynchronous result for A SHALL NOT overwrite B's target state

#### Scenario: Control taskbar follow for a generated video or text target

- **GIVEN** a generated video or text element is bound to the AI input bar
- **WHEN** the target controls are shown
- **THEN** the taskbar SHALL offer the same follow switch, close action and close-mode menu as a generated image target
- **AND** all labels SHALL describe the selected target type rather than an image when the target is video or text

#### Scenario: Disable and restore video or text taskbar positioning

- **GIVEN** a generated video or text element is bound in follow mode
- **WHEN** the user disables taskbar follow
- **THEN** the taskbar SHALL return to its default bottom position
- **AND** the target, its draft and its replacement binding SHALL remain active
- **WHEN** the user enables taskbar follow again
- **THEN** the taskbar SHALL return near the selected target

#### Scenario: Use a generated video target as a reference for this selection

- **GIVEN** a generated video element is bound in follow mode
- **WHEN** the user chooses to stop following it for this selection
- **THEN** the taskbar SHALL return to its default bottom position
- **AND** the generated video SHALL remain available as video generation context
- **AND** the next generation SHALL NOT replace the original video element

#### Scenario: Always use a generated video target as a reference

- **GIVEN** a generated video element is bound in follow mode
- **WHEN** the user chooses to always stop following that video
- **THEN** the element SHALL retain a lightweight reference-only preference
- **AND** selecting it again SHALL keep it as a video reference without restoring replacement mode

#### Scenario: Use a generated text target as context for this selection

- **GIVEN** a generated text element is bound in follow mode
- **WHEN** the user chooses to stop following it for this selection
- **THEN** the taskbar SHALL return to its default bottom position
- **AND** the generated text body SHALL remain available as text generation context
- **AND** the next generation SHALL NOT replace the original text element

#### Scenario: Always use a generated text target as context

- **GIVEN** a generated text element is bound in follow mode
- **WHEN** the user chooses to always stop following that text
- **THEN** the element SHALL retain a lightweight context-only preference
- **AND** selecting it again SHALL keep its body as context without restoring replacement mode

### Requirement: Generated Canvas Results SHALL Preserve Reusable Prompt Metadata

The system SHALL store only lightweight prompt and task identity metadata needed to restore cross-media target prompt suggestions.

#### Scenario: Insert a generated result

- **WHEN** an image, video, audio or text generation result is inserted into the canvas
- **THEN** the inserted element SHALL retain its generation prompt and task ID when available
- **AND** SHALL NOT retain media binaries or full task history as target metadata
