## ADDED Requirements

### Requirement: Trusted Tuzi Image Submissions SHALL Carry A Stable Request ID

The system SHALL persist the current image submission Request ID before the formal POST and SHALL attach it as `X-Request-Id` only to a trusted Request-ID-CORS-compatible Tuzi submission target.

#### Scenario: First formal submission

- **WHEN** a new image task is ready to send its formal POST
- **THEN** the system SHALL persist the task ID as `submissionRequestId`
- **AND** SHALL persist `imageSubmissionAttempted=true` and the invocation route before sending
- **AND** the request SHALL contain exactly one `X-Request-Id` with that value

#### Scenario: Configured trusted node lacks Request-ID CORS support

- **GIVEN** the configured Tuzi node is trusted but does not allow `X-Request-Id` in browser preflight
- **WHEN** the formal image POST is prepared
- **THEN** the system SHALL deterministically route it to a trusted compatible node
- **AND** SHALL submit the image POST only once
- **AND** network or HTTP failure SHALL NOT trigger another image POST on a different node

#### Scenario: Compatible trusted node is configured

- **GIVEN** the configured Tuzi node is Request-ID-CORS-compatible
- **WHEN** the formal image POST is prepared
- **THEN** the system SHALL keep that node
- **AND** SHALL attach the current submission Request ID

#### Scenario: GET or untrusted target

- **WHEN** a request is GET or its final URL is not a trusted Tuzi target
- **THEN** the system SHALL NOT inject the task Request ID
- **AND** trusted recovery GET requests SHALL remove stale Request ID header variants
- **AND** third-party targets SHALL NOT receive Tuzi credentials through recovery fallback

#### Scenario: Retry creates a new submission identity

- **WHEN** the user retries an image task
- **THEN** the local task ID SHALL remain unchanged
- **AND** the new attempt SHALL persist a new `submissionRequestId`
- **AND** the old attempt SHALL NOT overwrite the retry

### Requirement: Refreshed Image Tasks SHALL Resume Read-Only Result Polling

The system SHALL resume a formally submitted synchronous image task after page refresh by polling the upstream result endpoint with its persisted submission Request ID.

#### Scenario: Reload restores an explicit submitted task

- **GIVEN** a persisted image task is processing and contains an explicit submission Request ID, submitted-attempt marker, and trusted invocation route
- **WHEN** OpenTu initializes after page refresh
- **THEN** the task SHALL transition to `PROCESSING + POLLING`
- **AND** the deferred task runtime SHALL wake without requiring the user to open a generation panel
- **AND** the system SHALL issue only read-only result GET requests

#### Scenario: Legacy or unsubmitted task

- **GIVEN** a processing image task lacks an explicit submission Request ID or has `imageSubmissionAttempted !== true`
- **WHEN** OpenTu initializes
- **THEN** the system SHALL NOT guess the task ID as a historical submission ID
- **AND** SHALL preserve the existing interrupted-task failure behavior
- **AND** SHALL NOT query or resubmit the image request

#### Scenario: Upstream reports processing

- **WHEN** a trusted result endpoint returns `processing_or_not_found`
- **THEN** the system SHALL keep the task processing
- **AND** SHALL wait for the next bounded polling interval
- **AND** SHALL NOT submit another image POST

#### Scenario: Upstream reports success

- **WHEN** the result endpoint returns one or more valid image URLs for the current submission Request ID
- **THEN** the system SHALL complete the same local task through the existing cache and task-completion flow
- **AND** the original card and batch preview SHALL receive the completed image
- **AND** cache failure SHALL NOT discard an otherwise valid remote image URL

#### Scenario: Upstream reports failure or recovery expires

- **WHEN** the result endpoint returns an explicit failure
- **THEN** the system SHALL write the upstream error to the same task
- **WHEN** the existing image-task deadline expires without a terminal result
- **THEN** the system SHALL mark the task failed instead of leaving it indefinitely processing

#### Scenario: Cancellation, deletion, retry, or late terminal result

- **WHEN** the task is cancelled, deleted, retried, or already completed by another valid writer
- **THEN** the old recovery loop SHALL stop
- **AND** timers, response references and AbortControllers SHALL be released
- **AND** a late result for an old Request ID SHALL NOT overwrite the current task state
