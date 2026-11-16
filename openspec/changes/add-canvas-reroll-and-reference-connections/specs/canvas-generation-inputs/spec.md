## ADDED Requirements

### Requirement: Image connections can create persistent generation drafts
The main canvas SHALL allow an image connection dropped on empty space to offer image generation, video generation and ordinary connection behavior. Selecting generation SHALL create a persistent draft at the drop location with the source image as an explicit input.

#### Scenario: Create an image-generation draft
- **WHEN** the user drags from image A to empty canvas space and selects image generation
- **THEN** a generation draft SHALL appear at the drop position and include A
- **AND** no provider request SHALL be sent before explicit generation

#### Scenario: Cancel a connection gesture
- **WHEN** the user cancels the creation menu
- **THEN** no orphan draft or input edge SHALL remain

### Requirement: Ordered draft references govern input connections
The system SHALL use a draft's ordered reference list as the authoritative state for input connections. Removing a reference or its input edge SHALL update the same state, preserve source media elements and support undo and redo.

#### Scenario: Connect another image to the same draft
- **GIVEN** a generation draft already references A
- **WHEN** the user connects B to the draft
- **THEN** the draft SHALL contain A and B without creating another draft
- **AND** repeating the same connection SHALL NOT duplicate B

#### Scenario: Remove and undo an input connection
- **WHEN** the user removes the input edge for B and then undoes that action
- **THEN** B's reference and input edge SHALL be restored together in their prior order

### Requirement: Drafts and submitted task snapshots have independent lifetimes
The system SHALL freeze a generation's effective inputs when submitted, retain the editable draft after completion, and keep task placement and completion bound to the submitting board and task identity. Input edges SHALL remain distinct from historical result lineage.

#### Scenario: Edit references while generation is running
- **WHEN** the user edits a draft after submitting its generation
- **THEN** the in-flight request SHALL continue with its original snapshot
- **AND** subsequent generation SHALL use the edited draft

#### Scenario: Repeat generation after receiving a result
- **GIVEN** a draft referencing A and B produced C
- **WHEN** the user generates again without changing the draft
- **THEN** the new task SHALL still use A and B
- **AND** C SHALL NOT become an input automatically

#### Scenario: Switch boards while a task is running
- **WHEN** the user switches away from the submitting board before completion
- **THEN** the result SHALL follow existing board-specific insertion or recovery behavior
- **AND** SHALL NOT be inserted into the unrelated active board

### Requirement: Input capabilities and missing sources are explicit
The system SHALL validate media roles, model capabilities and source availability before submission. It SHALL NOT silently discard excess references or reinterpret ordinary video references as first/last frames.

#### Scenario: The chosen video model cannot accept the supplied images
- **WHEN** the draft's images exceed or conflict with the selected model's supported input roles
- **THEN** the draft SHALL identify the incompatible inputs and block submission until corrected

#### Scenario: A source image is deleted
- **WHEN** a source element used by a draft is deleted
- **THEN** its dangling input edge SHALL be removed and its draft reference marked missing
- **AND** the user SHALL replace or remove the missing reference before submitting

### Requirement: Generation drafts survive canvas lifecycle operations
The system SHALL persist generation drafts and their ordered references through save/load and backup/restore, and SHALL remap identities during copy/paste. Legacy images SHALL NOT be automatically converted into generation drafts.

#### Scenario: Reload a canvas with a generation draft
- **WHEN** the user saves and reloads a canvas
- **THEN** the draft's prompt, model parameters, ordered inputs and valid input edges SHALL be restored

#### Scenario: Copy a draft to another board
- **WHEN** a draft is copied to another board
- **THEN** copied source elements SHALL receive remapped reference identities
- **AND** uncopied inputs SHALL be restored from available stable media or explicitly marked missing
- **AND** no reference SHALL silently bind to an unrelated destination element

### Requirement: Image actions expose supported canvas capabilities
The image connection menu SHALL expose text, image, video, quick image editing, and ordinary connections using existing application capabilities. A pending connection SHALL remain transient until the user chooses a canvas action.

#### Scenario: Describe the source image
- **WHEN** the user chooses text from the image connection menu
- **THEN** the existing text input SHALL receive the source image as an editable reference
- **AND** no generation SHALL be submitted automatically

#### Scenario: Edit the source image
- **WHEN** the user chooses quick editing
- **THEN** the existing image editor SHALL open the source image
- **AND** no draft or ordinary line SHALL be inserted

#### Scenario: Preserve ordinary line behavior
- **WHEN** the user chooses an ordinary connection after dragging an image port
- **THEN** the preview SHALL become an undoable ordinary line without changing any generation references

### Requirement: Generation editing remains synchronized with canvas history
Generation cards SHALL show reference thumbnails and prompt summaries, use curved input connections with separate ports, and position their editor near the selected card. Canvas history updates SHALL take precedence over stale editor renders.

#### Scenario: Undo while the editor is loading
- **WHEN** undo restores references or parameters while editor state is still loading
- **THEN** automatic saving SHALL NOT overwrite the restored state or clear the redo stack

#### Scenario: Select another canvas element
- **WHEN** the user selects another element or blank canvas
- **THEN** the active generation editor SHALL close and retain its saved draft

#### Scenario: Move or zoom the canvas
- **WHEN** the user moves a source or generation card, or changes the viewport
- **THEN** input curves and editor positioning SHALL follow the affected geometry
- **AND** viewport-only changes SHALL NOT rebuild persistent input connections
