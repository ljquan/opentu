## ADDED Requirements

### Requirement: Trusted Tuzi Image Tasks SHALL Recover By Persisted Submission Request ID

The system SHALL automatically query a trusted Tuzi image task by the persisted Request ID of the current submission attempt as soon as the formal POST submission marker commits, without waiting for the original response to fail.

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

#### Scenario: Upstream result is ready while the original POST response remains pending

- **GIVEN** a trusted Tuzi synchronous image task has persisted the formal submission marker and current Request ID
- **WHEN** the read-only result query returns `succeeded` before the original POST response settles
- **THEN** the system SHALL complete and render the original task immediately
- **AND** the late original response SHALL NOT overwrite or duplicate the completed task
- **AND** the system SHALL NOT send another image-generation POST

#### Scenario: Failure occurs before formal submission

- **GIVEN** reference-image preprocessing, request construction, or validation fails before the formal POST starts
- **WHEN** the image task reports the error
- **THEN** the task SHALL fail with the real error
- **AND** Request-ID recovery polling SHALL NOT start

#### Scenario: Page reload resumes an interrupted task

- **GIVEN** a recoverable trusted Tuzi image task is persisted within the image-task time limit
- **WHEN** OpenTu initializes after a page reload or reopen
- **THEN** the system SHALL resume result polling from the persisted submission Request ID and invocation route
- **AND** if provider settings are not ready during the first restore scan, a later periodic scan SHALL start recovery after those settings become resolvable
- **AND** if the persisted derived binding ID no longer exists, the system MAY re-resolve a binding only within the same provider profile and model before repeating all trusted synchronous-image checks
- **AND** a legacy `PROCESSING`, `INTERRUPTED`, or `INTERRUPTED_DURING_SUBMISSION` task without the new metadata SHALL use its task ID as the historical submission Request ID when it otherwise meets the recovery conditions

#### Scenario: Persisted recovery wakes the deferred runtime

- **GIVEN** a structurally recoverable image task is persisted while the generation window and task panel are closed
- **AND** the task is a formally submitted `PROCESSING + POLLING` attempt or a timeout attempt still inside its persisted 24-hour recovery window
- **WHEN** OpenTu initializes after a page reload or reopen
- **THEN** a lightweight startup inspection SHALL wake the deferred task runtime automatically
- **AND** task storage restoration and recovery execution SHALL start without requiring the user to open another tool window
- **AND** the startup inspection SHALL NOT require provider settings or credentials to be initialized before waking the runtime
- **AND** when no recoverable task exists, the deferred runtime SHALL remain lazy

#### Scenario: Periodic scan reclaims a restored structural candidate

- **GIVEN** a persisted image task remains structurally eligible for recovery after reload
- **AND** the initialization scan or task events did not attach an active recovery poller
- **WHEN** a later periodic lifecycle scan finds that its trusted route and credentials are resolvable
- **THEN** the system SHALL start or reattach Request-ID recovery polling
- **AND** SHALL NOT require a new task event
- **AND** SHALL NOT submit another image-generation POST
- **AND** repeated scans SHALL NOT create duplicate pollers for the same submission attempt

### Requirement: Recovery Queries SHALL Preserve Public Deployment Security Boundaries

The system SHALL perform recovery only against trusted Tuzi Request-ID endpoints and SHALL preserve the authentication boundary of the original user's provider configuration.

#### Scenario: Public OpenTu origin resumes a task

- **GIVEN** OpenTu is accessed from a public web origin rather than localhost or a LAN address
- **AND** the user has a valid Tuzi provider credential
- **WHEN** a recoverable image task is polled
- **THEN** the query SHALL use the user's resolved authentication context
- **AND** SHALL query the configured provider endpoint before public fallback endpoints
- **AND** recovery SHALL NOT depend on a fixed OpenTu page Origin allowlist
- **AND** the GET query SHALL NOT carry an `X-Request-Id` header

#### Scenario: Browser default transport dispatches the recovery GET

- **GIVEN** recovery uses the browser runtime's default native `fetch`
- **WHEN** the scheduler starts a trusted result query
- **THEN** the GET SHALL be invoked with a valid global runtime receiver
- **AND** the query SHALL NOT be discarded as a transient `Illegal invocation` error before reaching the network
- **AND** an explicitly injected custom fetcher SHALL retain its existing receiver and call semantics

#### Scenario: One query node has not observed the result yet

- **GIVEN** one trusted query node returns `processing_or_not_found`
- **WHEN** another trusted node already has a terminal result for the same submission Request ID
- **THEN** the current polling round SHALL continue checking the remaining nodes
- **AND** a fallback node authentication failure SHALL NOT override a valid processing response from the configured provider endpoint

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

#### Scenario: Live recovery reaches the normal processing limit

- **GIVEN** all trusted nodes continue returning `processing_or_not_found` or transient failures
- **WHEN** the existing image-task total time limit is reached
- **THEN** the live poller SHALL NOT persist a terminal failure before timeout handoff
- **AND** the system SHALL atomically persist the extended-recovery marker
- **AND** polling SHALL continue within the bounded extended window

#### Scenario: A recently timed-out task may complete after the normal window

- **GIVEN** a trusted Tuzi image task formally submitted its current Request ID
- **AND** it has exceeded the normal processing window or failed locally with `TIMEOUT` or `RECOVERY_TIMEOUT` within the last 24 hours
- **WHEN** the current page reaches the normal timeout or OpenTu initializes an older timed-out task
- **THEN** the system SHALL atomically persist or reuse a fixed extended-recovery start marker
- **AND** the marker change SHALL be synchronized to the in-memory task and SHALL refresh the active poller's deadline
- **AND** the current page SHALL enter extended polling without first persisting a `TIMEOUT` terminal state
- **AND** SHALL continue bounded read-only polling across the configured provider endpoint and trusted fallback endpoints for at most 24 hours from that marker
- **AND** if provider settings are temporarily unavailable after the marker is persisted, the task SHALL remain `PROCESSING + POLLING` and periodic scans SHALL retry recovery without resetting the marker
- **AND** a page reload SHALL resume only the remaining recovery window rather than resetting it
- **AND** SHALL complete the original task whenever the upstream result appears within that window
- **AND** SHALL NOT send another image-generation POST

#### Scenario: Extended recovery reaches its deadline

- **GIVEN** a timed-out image task has an extended-recovery start marker
- **WHEN** 24 hours have elapsed from that persisted marker without a terminal upstream result
- **THEN** polling SHALL stop
- **AND** the task SHALL remain failed with `RECOVERY_TIMEOUT`
- **AND** another page reload SHALL NOT restart or extend the expired recovery window

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
- **AND** a transient terminal-state persistence failure SHALL retry the same recovered result instead of silently leaving the task processing

#### Scenario: Current provider settings become temporarily unavailable after a terminal result

- **GIVEN** a recovery query has already received a terminal success or business failure for the current submission Request ID and start identity
- **WHEN** the provider Token, route, settings, or recovery deadline is temporarily unavailable during terminal writeback
- **THEN** the system SHALL still validate the terminal result against the current task identity and persist the corresponding completion or failure
- **AND** SHALL NOT re-resolve provider configuration as a condition for accepting the already received terminal result

#### Scenario: Terminal writeback never settles

- **GIVEN** recovery has received a terminal result for the current submission attempt
- **WHEN** the terminal persistence callback remains pending beyond its bounded watchdog
- **THEN** the system SHALL NOT create duplicate concurrent terminal writebacks or result queries for that attempt
- **AND** SHALL retain at most a lightweight attempt placeholder until the bounded recovery deadline
- **AND** SHALL release the recovery entry and timers when that deadline expires, or earlier when the task is cancelled, deleted, or retried

#### Scenario: Upstream returns a business failure

- **WHEN** the recovery query returns `failed`
- **THEN** polling SHALL stop
- **AND** the original task SHALL fail with the upstream error message and code when available
- **AND** the UI SHALL NOT replace that error with a generic page-interruption message
