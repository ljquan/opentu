## ADDED Requirements

### Requirement: Support Suno Lyrics As A Provider-Backed Audio Action

The system SHALL support Suno lyrics generation as an action within the existing audio routing model.

#### Scenario: Submit a lyrics generation request through the Suno lyrics endpoint

- **GIVEN** the active audio binding supports Suno lyrics generation
- **WHEN** the user selects the lyrics action and submits a prompt
- **THEN** the system SHALL send the request to `/suno/submit/lyrics`
- **AND** SHALL include `prompt`
- **AND** MAY include `notify_hook` when configured by the caller

#### Scenario: Poll a lyrics task through the shared Suno fetch endpoint

- **GIVEN** a Suno lyrics submit request returns a task identifier
- **WHEN** the system tracks that task asynchronously
- **THEN** it SHALL query `/suno/fetch/{task_id}`
- **AND** SHALL normalize provider status into the internal task state

#### Scenario: Extract title tags and text from a completed lyrics task

- **GIVEN** a Suno fetch response for a lyrics task reports success
- **WHEN** the nested result payload contains `text`, `title`, and `tags`
- **THEN** the system SHALL store the generated lyrics text
- **AND** SHALL preserve the returned title and tags when available
- **AND** SHALL keep the provider task identifier for follow-up actions

### Requirement: Distinguish Suno Submit Action From Final Result Kind

The system SHALL distinguish the selected Suno action from the normalized result kind used by task storage and UI rendering.

#### Scenario: Lyrics action completes without an audio URL

- **GIVEN** the selected Suno action is `lyrics`
- **WHEN** the provider returns a completed task with text output but no playable audio URL
- **THEN** the task SHALL still be considered successfully completed
- **AND** the normalized result SHALL be marked as a lyrics result rather than an audio asset
- **AND** the system SHALL not fail only because `audio_url` is absent

#### Scenario: Music action continues to produce audio assets

- **GIVEN** the selected Suno action is `music`
- **WHEN** the provider returns generated clips with playable audio URLs
- **THEN** the normalized result SHALL remain an audio result
- **AND** the existing audio insertion and playback paths SHALL remain available

### Requirement: Scope User-Facing Parameters By Suno Action

The system SHALL expose only the parameters relevant to the currently selected Suno action.

#### Scenario: Music-only parameters are hidden in lyrics mode

- **GIVEN** the user has selected the lyrics action in the audio flow
- **WHEN** the request form is rendered
- **THEN** the UI SHALL not present music-only submit controls such as `mv`, `title`, `tags`, `continue_clip_id`, or `continue_at`
- **AND** the primary lyrics flow SHALL not require the user to fill any of those music-specific fields

#### Scenario: Music mode preserves existing Suno parameter controls

- **GIVEN** the user has selected the music action in the audio flow
- **WHEN** the request form is rendered
- **THEN** the UI SHALL continue to expose the existing Suno music parameters supported by the binding
