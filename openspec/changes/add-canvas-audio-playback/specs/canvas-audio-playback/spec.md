## ADDED Requirements

### Requirement: Play Canvas Audio Assets In Place

The system SHALL allow audio assets inserted onto the canvas to be played and paused directly within the workspace.

#### Scenario: Play an inserted audio node on the canvas

- **GIVEN** an audio task has completed and its result has been inserted onto the canvas
- **WHEN** the user activates the audio node
- **THEN** the system SHALL begin playback for that node inside the workspace
- **AND** SHALL not require opening the audio URL in a separate browser tab

#### Scenario: Pause the currently playing audio node

- **GIVEN** a canvas audio node is currently playing
- **WHEN** the user activates the same node again
- **THEN** the system SHALL pause playback
- **AND** SHALL update the node's active playback state accordingly

### Requirement: Render Audio As A First-Class Canvas Component

The system SHALL render newly inserted audio assets as dedicated audio components instead of static SVG image cards.

#### Scenario: Insert a generated audio result as a component node

- **GIVEN** an audio generation result includes a playable URL and metadata
- **WHEN** the result is inserted onto the canvas
- **THEN** the canvas SHALL create an audio-specific element
- **AND** the element SHALL render structured UI such as title, cover, waveform, or play state feedback

#### Scenario: Show playback feedback inside the audio node

- **GIVEN** a canvas audio node is active or currently playing
- **WHEN** the node re-renders
- **THEN** the node SHALL visually reflect the current playback state
- **AND** SHALL not appear as a plain static image thumbnail

#### Scenario: Drive waveform rhythm from the active audio signal when available

- **GIVEN** a canvas audio node is currently playing
- **WHEN** browser audio analysis is available for the active media source
- **THEN** the node waveform and rhythm feedback SHALL respond to the live audio signal instead of only using static decorative animation
- **AND** inactive nodes SHALL not require the same high-frequency visual updates

#### Scenario: Gracefully fall back when audio analysis is unavailable

- **GIVEN** a canvas audio node is currently playing
- **WHEN** browser capabilities or media origin rules prevent live audio analysis
- **THEN** playback SHALL continue
- **AND** the node SHALL fall back to a non-reactive waveform presentation without crashing the workspace

#### Scenario: Keep audio node composition stable while resizing

- **GIVEN** a canvas audio node is selected
- **WHEN** the user resizes the node
- **THEN** the node SHALL preserve its intended component proportions
- **AND** SHALL avoid arbitrary stretching that distorts the cover, waveform, and timing layout

#### Scenario: Hide technical provider details from the main node surface

- **GIVEN** a canvas audio node retains provider metadata for follow-up actions
- **WHEN** the node is rendered in the workspace
- **THEN** the visible node UI SHALL prioritize title, playback state, and user-facing semantic information
- **AND** SHALL not expose technical model or provider identifiers as a primary badge

### Requirement: Provide A Global Canvas Audio Player Overlay

The system SHALL expose a lightweight global playback overlay while canvas audio is active.

#### Scenario: Show the top player while audio is playing

- **GIVEN** a canvas audio asset is currently playing
- **WHEN** playback is active
- **THEN** the workspace SHALL display a compact playback overlay near the top center of the canvas
- **AND** SHALL show at least the current title, play state, and progress

#### Scenario: Control playback queue and volume from the overlay

- **GIVEN** the global playback overlay is visible for a canvas audio asset
- **WHEN** the user uses the overlay controls
- **THEN** the overlay SHALL support previous and next track navigation within the current canvas audio queue
- **AND** SHALL support adjusting playback volume without leaving the workspace

#### Scenario: Close the overlay and stop playback

- **GIVEN** the global playback overlay is visible
- **WHEN** the user closes the overlay
- **THEN** the system SHALL stop the active playback
- **AND** SHALL clear the current active audio state

### Requirement: Preserve Audio Provider Metadata For Follow-Up Actions

The system SHALL preserve provider-level audio identifiers from generation results through task storage and canvas insertion.

#### Scenario: Keep clip identifiers on inserted audio nodes

- **GIVEN** an audio generation result includes provider task and clip identifiers
- **WHEN** that result is inserted onto the canvas
- **THEN** the inserted audio element SHALL retain the corresponding provider task identifier and clip identifier metadata

#### Scenario: Reuse stored provider metadata after task restoration

- **GIVEN** an audio task has been persisted and later restored from storage or sync
- **WHEN** the restored result is inserted or inspected
- **THEN** the restored task result SHALL still expose the provider task identifier and clip identifiers needed for follow-up actions
