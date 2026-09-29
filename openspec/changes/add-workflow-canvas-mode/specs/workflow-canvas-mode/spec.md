## ADDED Requirements

### Requirement: Independent workflow canvas document

The system MUST provide a workflow canvas document that is isolated from the normal whiteboard document and MUST preserve both documents when switching modes or reloading the application.

#### Scenario: Switch away and return

- **WHEN** the user switches from either mode to the other and later returns
- **THEN** the original mode restores its elements and viewport
- **AND** elements from the other mode are not present

### Requirement: Frame-based workflow nodes

The system MUST represent every workflow node as an initially empty Drawnix Frame that accepts the normal text, drawing, image and video editing operations.

#### Scenario: Add node

- **WHEN** the user invokes Add Node in workflow mode
- **THEN** exactly one empty Frame is created and selected
- **AND** no preset prompt, media or feature card is inserted

### Requirement: Directed port connections

The system MUST provide automatically growing ports that each accept at most one incoming connection. These ports MUST also be usable as connection sources, including connections between two input ports. A node retains its right-side output port and MUST have at most one outgoing connection across all its ports. Connection direction is from the initiating port to the destination port, and the source node's selected output supplies the downstream input.

#### Scenario: Connect two input ports

- **WHEN** the user drags from one node's input port to another node's input port, or activates the two ports in sequence
- **THEN** the first node becomes the source and the second node becomes the target
- **AND** the edge retains the exact starting port after moving nodes, switching modes, or reloading
- **AND** a port already receiving an input can still start an outgoing connection subject to the existing cycle and cardinality rules

#### Scenario: Restore legacy connections

- **WHEN** a saved edge has no source port identifier
- **THEN** it continues to originate at the original right-side output port

#### Scenario: Connect the last empty input

- **WHEN** an output is connected to the last empty input of a node
- **THEN** that input becomes occupied
- **AND** a new empty input is appended

#### Scenario: Manage input ports

- **WHEN** the user activates the add-input control on a workflow node
- **THEN** one new input port is appended with a stable identifier and editable default name
- **WHEN** the user activates a remove-input control for an unconnected port
- **THEN** only that port is removed and all other port identifiers remain unchanged
- **AND** the node always retains at least one input port
- **WHEN** the port is connected or is the last remaining port
- **THEN** its remove control is disabled and existing edges remain unchanged

#### Scenario: Reconnect an output

- **WHEN** a node with an outgoing edge starts another valid connection from any of its ports
- **THEN** the previous outgoing edge is replaced by the new edge

#### Scenario: Delete a workflow connection

- **WHEN** the user selects an existing workflow connection and activates the delete action or presses `Delete`/`Backspace`
- **THEN** only the selected workflow edge is removed
- **AND** both endpoint nodes, their contents, ports and unrelated edges remain unchanged
- **AND** the deletion is persisted with the workflow document and can be undone through the existing board history

#### Scenario: Reject an invalid graph

- **WHEN** a connection would target the same node or create a directed cycle
- **THEN** the system rejects it without changing existing valid edges

### Requirement: Selectable live output

The system MUST allow a node's current output element or region to change while retaining its outgoing edge and updating the downstream input reference.

#### Scenario: Change connected output

- **WHEN** the user chooses a different element or region as the source node output
- **THEN** the downstream input resolves to the new output through the existing edge

### Requirement: Workflow-aware AI generation

The system MUST reuse the existing bottom AI input bar and route prompt, image and video results to the workflow document and target Frame where generation was started.

#### Scenario: Task finishes after mode switch

- **WHEN** a workflow generation task completes while normal mode is active
- **THEN** its result is not inserted into the normal whiteboard
- **AND** it is restored in the originating workflow Frame

### Requirement: Safe node deletion

The system MUST remove all workflow edges associated with a deleted node without modifying unrelated nodes or normal whiteboard content.

#### Scenario: Delete connected node

- **WHEN** the user deletes a connected workflow node
- **THEN** all incident workflow edges are removed
- **AND** unrelated canvas elements remain unchanged

### Requirement: Resizable workflow nodes

The system MUST allow a workflow Frame to be resized with the existing Drawnix resize handles, persist the new bounds in the workflow document, and recompute every affected port and edge endpoint.

#### Scenario: Resize a connected node

- **WHEN** the user drags a selected workflow Frame resize handle
- **THEN** the Frame bounds change without deleting its contents or connections
- **AND** input ports are redistributed along the new left edge
- **AND** connected edge endpoints are anchored to the current port positions
- **AND** the new bounds and edge geometry remain after reload and mode switching
