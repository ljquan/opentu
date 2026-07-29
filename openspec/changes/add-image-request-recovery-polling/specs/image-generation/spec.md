## ADDED Requirements

### Requirement: Trusted Tuzi Image Tasks SHALL Recover By Persisted Submission Request ID

The system SHALL automatically query a trusted Tuzi image task by the persisted Request ID of the current submission attempt when the original response is ambiguously lost after the formal POST has started.

#### Scenario: First submission uses the task ID

- **WHEN** a new trusted Tuzi image task performs its first formal submission
- **THEN** its `submissionRequestId` SHALL equal the local task ID
- **AND** every image-task entry point SHALL persist that Request ID and the submitted-attempt marker before sending the POST
- **AND** persistence SHALL NOT be considered successful until the IndexedDB transaction commits

#### Scenario: Formal submission preserves the configured provider endpoint

- **GIVEN** a trusted Tuzi image task resolves a user-configured provider Base URL
- **WHEN** the formal submission carries a persisted Request ID
- **THEN** the POST SHALL use that configured Base URL
- **AND** a network error or `404` SHALL NOT cause the POST to be repeated against another Tuzi node
- **AND** cross-node fallback SHALL be limited to subsequent read-only recovery queries

#### Scenario: Retry uses a new submission Request ID

- **GIVEN** an image task is retried
- **WHEN** the new formal submission is prepared
- **THEN** the local task ID SHALL remain unchanged
- **AND** the system SHALL generate and persist a new `submissionRequestId`
- **AND** the old submission and recovery polling SHALL NOT overwrite the retry

#### Scenario: Submission connection is interrupted

- **GIVEN** a trusted Tuzi synchronous image task has sent its formal POST with the current persisted `submissionRequestId`
- **WHEN** the browser ambiguously loses the submission response because of a refresh, network error, timeout, or connection termination
- **THEN** the task SHALL remain in a processing polling state
- **AND** the system SHALL query `/v1/images/generations/result` with `request_id` equal to the same submission Request ID
- **AND** the system SHALL NOT immediately mark the task as interrupted failure

#### Scenario: Failure occurs before formal submission

- **GIVEN** reference-image preprocessing, request construction, or validation fails before the formal POST starts
- **WHEN** the image task reports the error
- **THEN** the task SHALL fail with the real error
- **AND** Request-ID recovery polling SHALL NOT start

#### Scenario: Page reload resumes an interrupted task

- **GIVEN** a recoverable trusted Tuzi image task is persisted within the image-task time limit
- **WHEN** OpenTu initializes after a page reload or reopen
- **THEN** the system SHALL resume result polling from the persisted submission Request ID and invocation route
- **AND** a legacy `PROCESSING`, `INTERRUPTED`, or `INTERRUPTED_DURING_SUBMISSION` task without the new metadata SHALL use its task ID as the historical submission Request ID when it otherwise meets the recovery conditions

### Requirement: Recovery Queries SHALL Preserve Public Deployment Security Boundaries

The system SHALL perform recovery only against trusted Tuzi Request-ID endpoints and SHALL preserve the authentication boundary of the original user's provider configuration.

#### Scenario: Public OpenTu origin resumes a task

- **GIVEN** OpenTu is accessed from a public web origin rather than localhost or a LAN address
- **AND** the user has a valid Tuzi provider credential
- **WHEN** a recoverable image task is polled
- **THEN** the query SHALL use the user's resolved authentication context
- **AND** recovery SHALL NOT depend on a fixed OpenTu page Origin allowlist
- **AND** the GET query SHALL NOT carry an `X-Request-Id` header

#### Scenario: Untrusted provider is not queried

- **GIVEN** an image task resolves to a third-party or untrusted provider endpoint
- **WHEN** its submission response is interrupted
- **THEN** the system SHALL NOT probe the Tuzi recovery endpoint
- **AND** SHALL NOT send the submission Request ID or provider credential to a different origin

### Requirement: Recovery Polling SHALL Be Bounded Without Dropping Tasks

The system SHALL limit concurrent recovery queries while retaining every eligible task in a waiting queue until it reaches a terminal state, is cancelled, or expires.

#### Scenario: Large batch is restored

- **GIVEN** more recoverable image tasks exist than the concurrent query limit
- **WHEN** recovery starts
- **THEN** excess tasks SHALL wait in a bounded scheduler queue
- **AND** every eligible task SHALL eventually receive a polling turn
- **AND** no task SHALL be discarded solely because the concurrency limit is full

#### Scenario: Recovery reaches its total time limit

- **GIVEN** all trusted nodes continue returning `processing_or_not_found` or transient failures
- **WHEN** the existing image-task total time limit is reached
- **THEN** polling SHALL stop
- **AND** the task SHALL fail with a clear message that no upstream result was found and the user may retry

#### Scenario: User stops the task

- **WHEN** the user cancels, deletes, or retries a recovering task
- **THEN** its old timers, queued work, and in-flight query SHALL be stopped or invalidated
- **AND** a retry SHALL use a new submission Request ID while preserving the task ID
- **AND** a late recovery response SHALL NOT overwrite the newer task state

#### Scenario: Old attempt reaches storage after an immediate retry

- **GIVEN** an image task has been retried with a new submission Request ID
- **WHEN** the old submission later attempts to persist a remote ID, failure, or completion
- **THEN** the storage transaction SHALL compare the persisted current submission Request ID before writing
- **AND** the old attempt SHALL NOT overwrite the retry or an existing terminal result

### Requirement: Recovery SHALL Reuse Existing Completion And Failure Flows

The system SHALL map the upstream query result into the existing image task completion and failure contracts.

#### Scenario: Upstream returns a successful image

- **WHEN** the recovery query returns `succeeded` with a valid image URL
- **THEN** the system SHALL complete the original task with that result
- **AND** SHALL reuse existing cache, batch preview, and canvas insertion behavior
- **AND** a cache failure SHALL retain the usable remote URL instead of reverting the task to failure

#### Scenario: Upstream returns a business failure

- **WHEN** the recovery query returns `failed`
- **THEN** polling SHALL stop
- **AND** the original task SHALL fail with the upstream error message and code when available
- **AND** the UI SHALL NOT replace that error with a generic page-interruption message
