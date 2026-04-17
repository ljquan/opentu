## ADDED Requirements

### Requirement: Support Unified Suno Music Edit Actions In The Music Analyzer

The system SHALL expose Suno music generation, continuation, and infill as action variants within one unified music creation flow.

#### Scenario: User switches from generate to continue in one unified form

- **GIVEN** the user is editing music in the music analyzer generation page
- **WHEN** the user changes the action from `generate` to `continue`
- **THEN** the UI SHALL keep the user in the same unified form
- **AND** SHALL reveal only the continuation parameters relevant to the selected action

#### Scenario: User switches from continue to infill in one unified form

- **GIVEN** the user is editing music in the music analyzer generation page
- **WHEN** the user changes the action from `continue` to `infill`
- **THEN** the UI SHALL remain in the same unified form
- **AND** SHALL reveal `infill_start_s` and `infill_end_s`
- **AND** SHALL preserve any compatible shared fields such as `prompt`, `title`, `tags`, and `mv`

### Requirement: Use clip_id As The Source Of Truth For Continuation Targets

The system SHALL use the Suno polling result field `clip_id` as the source-of-truth identifier for continuation and infill requests.

#### Scenario: Polling response discovers continuation clip ids before audio is ready

- **GIVEN** `/suno/fetch/{task_id}` returns generated items that already include `clip_id`
- **WHEN** playable audio URLs are not yet fully available
- **THEN** the system SHALL still remember those `clip_id` values
- **AND** SHALL reuse them in later normalized results for continuation actions

#### Scenario: User launches continuation from a generated clip card

- **GIVEN** the music analyzer displays generated clips
- **WHEN** the user chooses to continue or infill a clip
- **THEN** the system SHALL use that clip's remembered `clip_id`
- **AND** SHALL not substitute the list row `id` in place of `clip_id`

### Requirement: Scope Suno Music Parameters By Edit Action

The system SHALL validate and submit Suno music parameters according to the selected unified edit action.

#### Scenario: Basic generation omits continuation parameters

- **GIVEN** the selected action is `generate`
- **WHEN** the user submits the request
- **THEN** the system SHALL send `prompt`, `mv`, `title`, and `tags` when provided
- **AND** SHALL omit `continue_clip_id`, `continue_at`, `infill_start_s`, and `infill_end_s`

#### Scenario: Continuation requires clip id and continue time

- **GIVEN** the selected action is `continue`
- **WHEN** the user submits the request
- **THEN** the system SHALL require `continue_clip_id`
- **AND** SHALL require `continue_at`
- **AND** SHALL submit both fields to `/suno/submit/music`

#### Scenario: Infill requires continuation anchor and infill window

- **GIVEN** the selected action is `infill`
- **WHEN** the user submits the request
- **THEN** the system SHALL require `continue_clip_id`
- **AND** SHALL require `continue_at`
- **AND** SHALL require `infill_start_s`
- **AND** SHALL require `infill_end_s`
- **AND** SHALL ensure `infill_start_s` is less than `infill_end_s`

