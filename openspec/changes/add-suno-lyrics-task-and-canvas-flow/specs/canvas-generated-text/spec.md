## ADDED Requirements

### Requirement: Insert Generated Lyrics Onto The Canvas As Text Content

The system SHALL insert generated lyrics results onto the canvas as text-oriented content instead of audio components.

#### Scenario: Manual canvas insertion formats lyrics as user-readable text

- **GIVEN** a completed lyrics task includes generated `text` and optional `title` or `tags`
- **WHEN** the user manually inserts that result onto the canvas
- **THEN** the system SHALL generate a text or markdown representation that includes the lyrics body
- **AND** SHALL include the title and tags when available
- **AND** SHALL use the existing text insertion capability rather than the audio node insertion capability

#### Scenario: Auto insert uses the same lyrics text rendering path

- **GIVEN** a lyrics task is configured for automatic insertion
- **WHEN** the task completes successfully
- **THEN** the automatic insertion flow SHALL route the result through the same text-oriented insertion path
- **AND** SHALL not create an audio node or audio playback component for the lyrics result

#### Scenario: Plain text fallback remains available when markdown card parsing is not applicable

- **GIVEN** a generated lyrics payload cannot be meaningfully parsed into markdown cards
- **WHEN** the system inserts the result onto the canvas
- **THEN** the canvas SHALL still insert the lyrics as readable plain text
- **AND** SHALL not fail the insertion only because card parsing is unavailable
