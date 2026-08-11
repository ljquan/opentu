## ADDED Requirements

### Requirement: AI Input Bar SHALL Provide Persistent Canvas Association Mode

The system SHALL provide a persistent canvas-association toggle beside the asset-library control.

#### Scenario: Enable canvas association

- **GIVEN** canvas association is disabled
- **WHEN** the user enables `开启联想`
- **THEN** the AI input bar SHALL enable canvas picking for newly typed `@` characters
- **AND** the enabled preference SHALL persist for the same browser origin

#### Scenario: Keep at-sign as text while disabled

- **GIVEN** canvas association is disabled
- **WHEN** the user types `@`
- **THEN** the editor SHALL keep it as ordinary prompt text
- **AND** canvas selection behavior SHALL remain unchanged

#### Scenario: Association preference storage is unavailable

- **GIVEN** the stored preference is missing, invalid or unavailable
- **WHEN** the AI input bar initializes or toggles the preference
- **THEN** association SHALL default to disabled when no valid value exists
- **AND** a storage failure SHALL NOT interrupt prompt editing or generation

### Requirement: AI Input Bar SHALL Insert Inline Canvas References

The system SHALL insert removable, ordered `@object` references at their original cursor positions in the prompt.

#### Scenario: Pick a canvas element after a newly typed at-sign

- **GIVEN** canvas association is enabled
- **AND** the user directly typed `@` at any cursor position, including after existing non-whitespace text or before an existing suffix
- **AND** the caret remains immediately after that newly typed `@`
- **WHEN** the user clicks a referencable element on the current board
- **THEN** the trigger character SHALL be replaced by an inline type-and-sequence reference such as `@图片1`, `@图片2`, `@视频1` or `@文本1`, and the caret SHALL move after it
- **AND** the visible label SHALL remain part of the ordered prompt semantics
- **AND** numbering SHALL be independent per type and existing labels SHALL NOT be renumbered after deletion
- **AND** the chip SHALL retain the current board ID, element ID, type and a bounded display label
- **AND** clicking an image SHALL NOT activate image replacement binding for that pick

#### Scenario: Keep non-typed at-sign as prompt text

- **GIVEN** canvas association is enabled
- **WHEN** the prompt receives a pasted, historical or programmatically filled at-sign, or the user continues typing after a pending trigger
- **THEN** canvas picking SHALL NOT start for that at-sign
- **AND** the at-sign and surrounding text SHALL remain ordinary prompt text

#### Scenario: Pick nested and non-image content

- **GIVEN** canvas association picking is active
- **WHEN** the user clicks an image, video, audio, text, graphic, card, frame or supported nested element
- **THEN** the system SHALL retain that element's stable ID and type
- **AND** it SHALL resolve the element through its supported media, text or rasterized reference path at submission time

#### Scenario: Cancel canvas picking

- **GIVEN** canvas association picking is active
- **WHEN** the user presses Escape, deletes the trigger, disables association or switches boards
- **THEN** picking SHALL stop without adding a reference
- **AND** existing prompt content SHALL remain unchanged except for the user-deleted trigger

#### Scenario: Edit a prompt with inline references

- **GIVEN** the prompt contains one or more inline references
- **WHEN** the user types with an IME, moves the caret, copies text, pastes plain text, deletes a reference or restores a taskbar draft
- **THEN** native text editing behavior SHALL remain unchanged
- **AND** deleting or restoring prompt text SHALL NOT expose internal element IDs
- **AND** references SHALL remain isolated to their owning taskbar draft

#### Scenario: Edit around an inline reference

- **GIVEN** an inline reference occupies a bounded prompt range
- **WHEN** text is inserted or removed entirely before or after that range
- **THEN** the reference range SHALL move without changing its source identity
- **AND** editing across the reference SHALL remove its object identity rather than bind edited text to the old source

#### Scenario: Paste mention-looking plain text

- **WHEN** the user pastes plain text such as `@图片1`
- **THEN** it SHALL remain ordinary text
- **AND** it SHALL NOT gain canvas identity without a canvas pick

### Requirement: Generation SHALL Consume Typed Canvas References

The system SHALL resolve and validate a bounded snapshot of previewed canvas references before sending a generation request.

#### Scenario: Submit supported references

- **GIVEN** the prompt contains valid references on the current board
- **WHEN** the selected generation route supports their resolved modalities
- **THEN** image and rasterized references SHALL reuse the existing reference-image pipeline
- **AND** video, audio and text references SHALL be carried in typed selection context
- **AND** the workflow and retry context SHALL retain lightweight source IDs needed for result association

#### Scenario: Referenced element was deleted

- **GIVEN** a reference chip points to an element that no longer exists
- **WHEN** the user submits the prompt
- **THEN** the system SHALL keep the input intact
- **AND** it SHALL identify the invalid reference and stop submission

#### Scenario: Selected model cannot consume a reference

- **GIVEN** one or more resolved reference types are unsupported by the selected model route
- **WHEN** the user submits the prompt
- **THEN** the system SHALL identify the incompatible references and stop submission
- **AND** it SHALL NOT silently discard them or send a partial request

#### Scenario: Submit while references change

- **GIVEN** a valid submission has started
- **WHEN** the user edits references, switches boards or starts another request before completion
- **THEN** each workflow SHALL keep an independent immutable source-ID snapshot
- **AND** later input changes SHALL NOT alter relationships for an accepted workflow
- **AND** completion of the accepted workflow SHALL NOT clear newer prompt or reference edits

### Requirement: Published Tasks SHALL Establish And Preserve Canvas Association Links

The system SHALL immediately connect referenced source elements to a newly published canvas task and preserve those same relationships when the final result replaces the task endpoint.

#### Scenario: Referenced task is published

- **GIVEN** a valid workflow has one or more canvas references
- **WHEN** publishing creates a `generation-anchor` or `workzone` task node on the same board
- **THEN** the system SHALL immediately create one relationship line from each existing unique source to the first new task node
- **AND** each relationship line SHALL use the managed high-contrast black style
- **AND** the task node SHALL be allowed only as an association target, not as a prompt-reference source
- **AND** a publish failure before task-node creation SHALL NOT create relationship lines

#### Scenario: Task acknowledgement arrives after a board switch

- **GIVEN** a referenced task target was published on the source board
- **AND** the user switches boards before the accepted task acknowledgement returns
- **WHEN** the acknowledgement is observed on another board
- **THEN** the system SHALL NOT create a relationship line on the active wrong board
- **AND** it SHALL retain only a bounded lightweight deferred-link intent
- **AND** it SHALL create the missing line idempotently when the source board is active again and the task target still exists

#### Scenario: Final result is inserted

- **GIVEN** a published task node is connected to one or more canvas references
- **WHEN** a final result with a stable element ID is inserted on the same board
- **THEN** the system SHALL migrate each existing relationship line from the task node to that result
- **AND** it SHALL preserve the relationship identity and lightweight board, workflow, source and result IDs
- **AND** concurrent workflows using the same source SHALL retarget only lines carrying their own workflow ID
- **AND** it SHALL NOT create a second relationship line for the same source and workflow

#### Scenario: Completion is delivered more than once

- **GIVEN** a source-to-task or source-to-result relationship line already exists
- **WHEN** recovery, polling or completion notification is processed again
- **THEN** the system SHALL reuse the relationship identity
- **AND** it SHALL NOT create a duplicate line

#### Scenario: Retargeting temporarily fails

- **GIVEN** a final result was inserted with a stable element ID
- **WHEN** retargeting its relationship lines fails transiently
- **THEN** the system SHALL retain bounded result and source context for retry
- **AND** it SHALL NOT merge or insert the final result again during that retry

#### Scenario: Published task fails or is deleted

- **GIVEN** a source-to-task relationship line exists
- **WHEN** the published task fails or is cancelled before a stable result is inserted
- **THEN** the task node SHALL retain its failure or cancellation state for retry and traceability
- **AND** the existing relationship line SHALL remain bound to that task node
- **WHEN** that task node is later deleted
- **THEN** the relationship line SHALL be removed with the missing task endpoint
- **AND** the referenced source element SHALL remain unchanged

#### Scenario: Move an associated endpoint

- **GIVEN** a relationship line connects two existing canvas elements
- **WHEN** either endpoint moves or resizes
- **THEN** the line SHALL update to the nearest suitable edge points without changing either business element

#### Scenario: Delete an associated endpoint

- **GIVEN** a relationship line connects two canvas elements
- **WHEN** either source or result is deleted
- **THEN** the relationship line SHALL be removed
- **AND** the other business element SHALL remain unchanged

#### Scenario: Workflow completes on another board

- **GIVEN** the user switched boards after submitting a referenced workflow
- **WHEN** the result completion is observed outside the submission board
- **THEN** the system SHALL NOT insert the result or create a relationship line on the wrong board
- **AND** an accepted task SHALL retain only the lightweight context needed for recoverable insertion
- **AND** the result SHALL be inserted and linked at most once when the source board becomes active again

### Requirement: Canvas Association SHALL Bound Persistent And Runtime Data

The system SHALL keep canvas association metadata lightweight and resource use bounded.

#### Scenario: Persist association state

- **WHEN** prompt references or relationship lines are stored
- **THEN** they SHALL store only bounded labels, IDs, types and version metadata
- **AND** they SHALL NOT store media binaries, base64 payloads or complete task history

#### Scenario: Reach the reference limit

- **GIVEN** the prompt already contains 20 unique canvas references
- **WHEN** the user tries to add another unique reference
- **THEN** the system SHALL refuse the additional reference with recoverable feedback
- **AND** existing prompt content and references SHALL remain unchanged

#### Scenario: Reach the deferred-link limit

- **GIVEN** task acknowledgements arrive while their source boards are inactive
- **WHEN** more than 256 unique deferred-link intents would be retained
- **THEN** the system SHALL keep at most 256 intents and evict the oldest
- **AND** each intent SHALL contain only lightweight IDs and SHALL NOT contain media payloads
