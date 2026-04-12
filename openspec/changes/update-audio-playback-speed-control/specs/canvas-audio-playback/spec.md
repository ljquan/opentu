## MODIFIED Requirements

### Requirement: Shared playback modes for audio players
The system SHALL provide shared playback controls for the global floating audio player and the music player tool.

#### Scenario: Switch playback speed from the floating player
- **GIVEN** an audio or reading queue is active
- **WHEN** the user changes playback speed from the floating player dropdown
- **THEN** the system SHALL update the shared playback speed state
- **AND** the music player tool SHALL reflect the same selected speed

#### Scenario: Switch playback speed from the music player tool
- **GIVEN** an audio or reading queue is active
- **WHEN** the user changes playback speed from the music player tool dropdown
- **THEN** the system SHALL update the shared playback speed state
- **AND** the floating player SHALL reflect the same selected speed

#### Scenario: Sync reading speed with TTS settings
- **GIVEN** the active queue is a reading queue
- **WHEN** the user changes playback speed from either player entry
- **THEN** the system SHALL update the current reading playback speed
- **AND** SHALL sync the same value to `tts.rate`

#### Scenario: Reflect external TTS speed changes during reading
- **GIVEN** a reading queue is active
- **WHEN** `tts.rate` changes from the settings panel
- **THEN** the shared reading playback speed SHALL update
- **AND** both player entries SHALL reflect the latest reading speed
