## ADDED Requirements

### Requirement: Separate Suno V2 Protocol
The system SHALL submit supported `suno/{action}` models through `/suno/v2/{action}` and poll `/suno/v2/fetch/{task_id}` without legacy or Chat Completions fallback.

#### Scenario: Submit and recover a v2 task
- **WHEN** a supported v2 action is submitted and interrupted after receiving its task ID
- **THEN** recovery SHALL query the saved task with its original provider and SHALL NOT resubmit the action.

### Requirement: Action-Specific Music Workflow
The music tool SHALL expose the 24 supported v2 actions in the verified Tuzi catalog, explicitly excluding suno/create-voice, suno/add-instrumental and suno/add-vocals with their own parameters and valid prerequisite resources, while preserving supported legacy generation.

#### Scenario: Use a generated song in follow-up actions
- **WHEN** the user selects a successful v2 song for continuation, replacement, or mixing
- **THEN** the tool SHALL use its public music ID and original provider profile, rejecting legacy and other-profile resources.

#### Scenario: Excluded or unavailable action
- **WHEN** an unknown action, an unimplemented legacy alias, or an action absent from the selected provider is selected
- **THEN** the tool SHALL show it as unavailable and SHALL NOT submit it.

#### Scenario: Distinguish integrated actions from unsupported entries
- **WHEN** native and unsupported Suno entries coexist in the model selector
- **THEN** native actions SHALL display their full model IDs, unsupported entries SHALL be hidden by default with an explicit inspection toggle, and pointer/keyboard selection SHALL reject unsupported entries without silently replacing saved selections.

#### Scenario: Explicitly excluded v2 models
- **WHEN** a saved configuration, pricing hint, workflow or MCP request references suno/create-voice, suno/add-instrumental or suno/add-vocals
- **THEN** the system SHALL hide normal parameter and action entry points and reject new submission without transport, while preserving historical results and independent native contracts.

#### Scenario: Enter v2 without generating lyrics
- **WHEN** the user opens the music creation page with a configured supported v2 model
- **THEN** the tool SHALL provide direct access to v2 production and create a local record without submitting a prerequisite lyrics task.

### Requirement: Native Suno Parameters In Main Input
The main AI input bar SHALL expose action-specific v2 parameters and pass a validated native body and same-profile public resources through its workflow and audio task, preserving legacy supported models.

#### Scenario: Submit resources and typed values
- **WHEN** the user selects a v2 action and supplies boolean, numeric, array, or prerequisite resource parameters
- **THEN** the input SHALL convert values before submission, preserve false and zero, omit fields hidden by custom mode, and reject missing or other-profile resources.

#### Scenario: Unimplemented legacy alias
- **WHEN** an unimplemented legacy alias without a documented Tuzi operation is selected
- **THEN** the input SHALL display unavailable status, hide legacy music parameters, and reject workflow submission rather than infer a v2 mapping.

### Requirement: Preserve V2 Result Variants
The system SHALL retain all music, lyrics, exported files, and public resource IDs independently of playable audio URLs.

#### Scenario: Lyrics or resource task completes without audio
- **WHEN** a v2 task succeeds with a valid lyrics or structured resource result
- **THEN** the task SHALL complete and persist that result without caching or inserting an empty audio URL.

#### Scenario: Provider failure or empty successful result
- **WHEN** a v2 task reports failure or success with no expected result
- **THEN** the system SHALL report a terminal error rather than retry submission or wait indefinitely.

#### Scenario: Structured output without playable audio
- **WHEN** aligned-lyrics, gen-midi, or upsample-tags completes
- **THEN** the system SHALL persist and display the timeline/waveform, MIDI instruments/files, or expanded style text respectively, without treating a MIDI link as playable audio.

#### Scenario: Multiple reference URLs and trained models
- **WHEN** create-model or inspo is selected
- **THEN** the form SHALL accept separate audio URLs, enforce the action-specific array count, and preserve returned model resources for same-profile follow-up actions.


### Requirement: Native Suno Operations
The system SHALL expose the 26 documented Tuzi native operations and legacy upload/concat with typed action parameters, independent native routing, synchronous results, asynchronous queries and saved-action recovery.

#### Scenario: MP4 follows native contract
- **WHEN** a user chooses suno_act_mp4 and supplies public taskId, audioId and callBackUrl
- **THEN** the task SHALL use POST /suno/api/v1/mp4/generate and query its MP4 record-info endpoint, retain branding fields and display the returned video as video.

#### Scenario: Callback, mode and source validation
- **WHEN** required callback/source fields are missing, mode fields conflict, or a known resource belongs to another profile
- **THEN** submission SHALL be rejected without inventing callbacks, mixing v2 IDs or disclosing upstream private identifiers.

#### Scenario: Synchronous and structured outputs
- **WHEN** Persona, timeline, file upload, voice availability or credits succeeds
- **THEN** the result SHALL be retained without requiring a fabricated task ID or playable audio, including false availability and zero credits.

#### Scenario: Voice validation is ready
- **WHEN** validate-info returns wait_validating with a validation phrase
- **THEN** the current task SHALL complete and display the phrase so the user can record and submit verifyUrl in a subsequent action.

#### Scenario: Restore native action and upload data
- **WHEN** a native task is restored after interruption
- **THEN** it SHALL query its saved action using the public task ID without resubmission, while global parameter preferences SHALL exclude file contents.

#### Scenario: Unsupported gateway behavior
- **WHEN** the selected Tuzi channel rejects an operation or cannot map a follow-up public task ID
- **THEN** the system SHALL report the error without fallback to legacy, v2 or Chat Completions, and documentation SHALL identify the unverified gateway boundary.
