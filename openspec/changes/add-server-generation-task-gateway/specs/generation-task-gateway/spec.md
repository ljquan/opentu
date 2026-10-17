## ADDED Requirements

### Requirement: Free launch admission policy

The first public launch SHALL accept only explicitly free text/image models,
SHALL default task creation to disabled, and SHALL bound input/output and
global, provider, and user admission through shared database coordination.

#### Scenario: Administrator requests a nonfree canary

- **WHEN** an administrator requests an external or unconfigured billing model
- **THEN** the launch policy SHALL reject it even with a canary header

#### Scenario: Concurrent clients reach capacity

- **WHEN** different function instances attempt to create tasks at a limit
- **THEN** capacity checking and insertion SHALL be serialized in one database transaction
- **AND** an existing idempotency key SHALL not consume another admission

#### Scenario: Scheduled reconciliation

- **WHEN** an authenticated scheduled maintenance run finds expired submissions
- **THEN** it SHALL mark a bounded batch as outcome unknown without resubmission
- **AND** invalid or absent cron authentication SHALL fail before database access

### Requirement: Authenticated generation task contract

The system SHALL expose a same-origin authenticated task contract for text,
image, video, and audio generation without accepting provider credentials or
arbitrary upstream routing data from the client.

#### Scenario: User submits a published model

- **GIVEN** an authenticated user selects an enabled, healthy, published model
- **WHEN** the user submits a valid operation request
- **THEN** the system SHALL create or return an owned generation task
- **AND** SHALL resolve the provider and binding on the server

#### Scenario: Client attempts to override provider routing

- **WHEN** a task request includes an API key, base URL, upstream path, or
  arbitrary authorization header
- **THEN** the system SHALL reject the request
- **AND** SHALL NOT forward any client-selected routing value upstream

#### Scenario: Model is not invokable

- **GIVEN** a model is unpublished, disabled, unhealthy, or missing from the
  server catalog
- **WHEN** a user attempts to create a task for that model
- **THEN** the system SHALL reject task creation before any upstream request or
  billing reservation occurs

### Requirement: Idempotent task creation

The system SHALL require a user-scoped idempotency key for generation task
creation and SHALL prevent duplicate upstream submissions and charges.

#### Scenario: Same request is submitted twice

- **GIVEN** an authenticated user has already created a task with an
  idempotency key
- **WHEN** the same user repeats the same request with the same key
- **THEN** the system SHALL return the original task
- **AND** SHALL NOT create another upstream job or billing reservation

#### Scenario: Idempotency key is reused with different input

- **WHEN** a user reuses an existing idempotency key with a different normalized
  request
- **THEN** the system SHALL reject the conflicting request

### Requirement: Durable normalized task lifecycle

The system SHALL persist normalized task state independently from the browser
and provider-specific status values.

#### Scenario: User reloads during generation

- **GIVEN** a task is queued, submitting, or running
- **WHEN** the user reloads the application and requests the owned task
- **THEN** the system SHALL return its latest durable status and safe progress
  metadata
- **AND** the client SHALL be able to resume status tracking without replaying
  the generation request

#### Scenario: Concurrent refresh requests occur

- **WHEN** multiple clients or background refreshers request an upstream status
  refresh for the same task
- **THEN** at most one refresh SHALL hold the execution lease
- **AND** all other requests SHALL return persisted state without duplicating
  upstream work

### Requirement: Bounded synchronous and asynchronous execution

The system SHALL normalize both synchronous provider responses and
asynchronous submit/poll protocols without keeping a serverless function open
for the full duration of a long-running media task.

#### Scenario: Synchronous request completes within the deadline

- **WHEN** a text or image provider completes within the configured deadline
- **THEN** the task SHALL transition to succeeded in the same bounded execution
- **AND** SHALL return a normalized result

#### Scenario: Provider returns an asynchronous task identifier

- **WHEN** a provider accepts a video, audio, or asynchronous image request
- **THEN** the gateway SHALL persist the upstream task identifier
- **AND** SHALL return a running platform task without blocking until completion

#### Scenario: Stale running task is refreshed

- **GIVEN** a running task is due for polling
- **WHEN** an owned status request or authorized background refresh acquires its
  lease
- **THEN** the gateway SHALL perform at most one bounded upstream poll
- **AND** SHALL persist the normalized result or next polling time

### Requirement: Controlled reference uploads

The system SHALL resolve generation reference files through owned, expiring
upload records rather than arbitrary client URLs or unbounded inline payloads.

#### Scenario: User attaches a valid reference file

- **GIVEN** the user completed an owned upload with an allowed type and size
- **WHEN** the upload ID is attached to a compatible generation operation
- **THEN** the gateway SHALL resolve the file for the selected adapter
- **AND** SHALL NOT expose storage credentials to the provider or client

#### Scenario: Invalid reference is submitted

- **WHEN** an upload is expired, owned by another user, too large, has an
  unsupported content type, or references an arbitrary URL
- **THEN** the system SHALL reject the task before upstream submission

### Requirement: Billing reservation and settlement

The system SHALL reserve estimated user balance before a chargeable upstream
submission and SHALL settle or release that reservation idempotently from the
final task outcome.

#### Scenario: Billing is unavailable

- **GIVEN** a published model is chargeable
- **WHEN** no approved server-side billing adapter is configured
- **THEN** the system SHALL reject task creation with a safe billing-unavailable
  error
- **AND** SHALL NOT submit the upstream request

#### Scenario: User has insufficient balance

- **WHEN** the billing adapter cannot reserve the task's estimated amount
- **THEN** the task SHALL NOT be submitted upstream
- **AND** the client SHALL receive a normalized insufficient-balance error

#### Scenario: Task reaches a terminal state

- **WHEN** a chargeable task succeeds, fails, times out, or is cancelled
- **THEN** the gateway SHALL settle reported billable usage or release the
  unused reservation exactly once
- **AND** repeated terminal processing SHALL NOT duplicate the billing event

### Requirement: Secure provider transport and error normalization

The system SHALL keep provider secrets server-side and SHALL bound and sanitize
all provider communication.

#### Scenario: Provider request is executed

- **WHEN** a task resolves to a server-managed provider
- **THEN** the gateway SHALL decrypt the provider credential only for the
  outbound request
- **AND** SHALL apply trusted-origin validation, redirect denial, timeouts, and
  request and response size limits

#### Scenario: Provider returns a sensitive failure

- **WHEN** an upstream error contains credentials, cookies, signed URLs,
  internal provider metadata, or a raw response body
- **THEN** the gateway SHALL store and return only a sanitized error code and
  user-safe message
- **AND** SHALL NOT expose the sensitive content in logs or task responses

### Requirement: Owned task cancellation

The system SHALL allow a user to cancel only their own active generation tasks
and SHALL normalize providers that do or do not support upstream cancellation.

#### Scenario: Provider supports cancellation

- **WHEN** a user cancels their running task and the provider supports cancel
- **THEN** the gateway SHALL request upstream cancellation once
- **AND** SHALL persist the resulting normalized terminal state

#### Scenario: Provider cannot cancel an accepted task

- **WHEN** a user requests cancellation after an upstream provider has accepted
  a non-cancellable task
- **THEN** the gateway SHALL record the cancellation request
- **AND** SHALL stop client-side result insertion
- **AND** SHALL continue only the minimum status work required for billing and
  cleanup

#### Scenario: User accesses another user's task

- **WHEN** a user reads or cancels a task owned by another user
- **THEN** the system SHALL return a non-enumerating not-found response
