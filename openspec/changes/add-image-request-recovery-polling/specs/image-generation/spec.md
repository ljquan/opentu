## ADDED Requirements

### Requirement: Trusted Tuzi Image Submissions SHALL Carry A Stable Request ID

The system SHALL persist the current image submission Request ID before the formal POST and SHALL attach it as `X-Request-Id` only to a trusted Tuzi submission target reached either through a fixed same-origin proxy or a Request-ID-CORS-compatible endpoint.

#### Scenario: First formal submission

- **WHEN** a new image task is ready to send its formal POST
- **THEN** the system SHALL persist the task ID as `submissionRequestId`
- **AND** SHALL persist `imageSubmissionAttempted=true` and the invocation route before sending
- **AND** the request SHALL contain exactly one `X-Request-Id` with that value

#### Scenario: Configured trusted node lacks Request-ID CORS support

- **GIVEN** the configured Tuzi node is trusted but does not allow `X-Request-Id` in browser preflight
- **WHEN** the formal image POST is prepared
- **THEN** a supported local, LAN, or public deployment SHALL route it through the fixed same-origin proxy for that configured node
- **AND** SHALL preserve the configured node, Token, billing, and permission domain
- **AND** SHALL submit the image POST only once
- **AND** network or HTTP failure SHALL NOT trigger another image POST on a different node

#### Scenario: Deployment lacks the fixed same-origin proxy

- **GIVEN** the configured Tuzi node lacks Request-ID CORS support
- **AND** the current deployment does not provide the fixed proxy
- **WHEN** the formal image POST is prepared
- **THEN** the system SHALL deterministically route it to a trusted compatible node
- **AND** SHALL submit the image POST only once

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

#### Scenario: Non-idempotent submission loses its connection

- **GIVEN** a Tuzi POST does not have an effective idempotency or recovery Request ID
- **WHEN** its fetch result is unknown because the connection fails
- **THEN** the system SHALL NOT repeat that POST on another node
- **AND** only idempotent GET or HEAD requests SHALL retain network-error fallback
- **AND** only an image endpoint without an effective Request ID MAY use the existing endpoint fallback after receiving an explicit HTTP 404 response

### Requirement: Submitted Image Tasks SHALL Resume Read-Only Result Polling

The system SHALL resume a formally submitted synchronous image task after page refresh or an ambiguous online submission failure by polling the upstream result endpoint with its persisted submission Request ID.

#### Scenario: Online submission response is lost

- **GIVEN** a trusted synchronous Tuzi image task persisted its submission Request ID, submitted-attempt marker, and invocation route before POST
- **WHEN** the formal POST ends with a fetch-level network error, or its successful response body is interrupted before the client can read a complete result
- **THEN** the same task SHALL persist `PROCESSING + POLLING` before releasing the active execution lock
- **AND** read-only recovery queries SHALL start only after the active execution lock is released
- **AND** the system SHALL query the result using the same Request ID
- **AND** SHALL NOT mark the task failed or send another image POST

#### Scenario: Controlled response body does not settle

- **GIVEN** a provider request declares that its non-streaming response will use the bounded transport reader
- **WHEN** either a success or error response returns headers but its body never closes
- **THEN** the original request timeout or user cancellation SHALL settle the body read and cancel the reader
- **AND** only an interrupted successful trusted synchronous Tuzi image submission MAY transition to Request ID recovery
- **AND** error responses and other protocols SHALL preserve their timeout, cancellation, size-limit, or stream error semantics
- **AND** requests using native response readers SHALL release unused transport timeout state immediately after headers return

#### Scenario: Custom asynchronous binding is excluded

- **GIVEN** a custom HTTP image binding uses `/images/generations` or `/images/edits` as its submit path
- **AND** the binding declares a custom `pollPathTemplate`, or its effective method after applying the configured/body-derived default is not `POST`
- **WHEN** its submission connection fails
- **THEN** the task SHALL preserve the custom asynchronous or failure behavior
- **AND** SHALL NOT enter the fixed synchronous Tuzi result polling endpoint

#### Scenario: Non-synchronous image protocol fails at the network layer

- **GIVEN** an image task uses `/videos`, Google `generateContent`, or another protocol outside synchronous `images/generations|edits`
- **WHEN** its submission ends with a network error
- **THEN** the system SHALL preserve that protocol's existing failure or asynchronous recovery behavior
- **AND** SHALL NOT transition the task into synchronous Request ID result polling

#### Scenario: Definite failure or user cancellation

- **WHEN** the formal POST returns an HTTP or business failure, returns a complete structurally closed but malformed response, or the user cancels the request
- **THEN** the system SHALL preserve the existing failure or cancellation behavior
- **AND** SHALL NOT enter Request ID recovery polling

#### Scenario: Reload restores an explicit submitted task

- **GIVEN** a persisted image task is processing and contains an explicit submission Request ID, submitted-attempt marker, and trusted invocation route
- **WHEN** OpenTu initializes after page refresh
- **THEN** the task SHALL transition to `PROCESSING + POLLING`
- **AND** the deferred task runtime SHALL wake without requiring the user to open a generation panel
- **AND** the system SHALL issue only read-only result GET requests

#### Scenario: Reload waits for decrypted provider settings

- **GIVEN** a submitted image task and encrypted provider credentials are restored during startup
- **WHEN** the task storage recovery scan begins
- **THEN** recovery eligibility SHALL be evaluated only after provider settings initialization completes
- **AND** encrypted credential text SHALL NOT be used as an upstream Token
- **AND** unrelated task runtimes SHALL NOT wait for image recovery decryption

#### Scenario: Provider settings initialization does not settle before the original deadline

- **GIVEN** a persisted recovery candidate retains its original `startedAt`, or falls back to `createdAt` only when `startedAt` is absent
- **WHEN** provider settings initialization remains pending until the existing 15-minute task deadline
- **THEN** the wait SHALL NOT reset or extend that original deadline
- **AND** the current attempt SHALL conditionally fail with `RECOVERY_TIMEOUT`
- **AND** late settings initialization SHALL NOT revive a terminal task or a same-ID replacement

#### Scenario: Provider settings initialization rejects

- **GIVEN** a persisted recovery candidate is waiting for provider settings initialization
- **WHEN** settings initialization rejects before the original task deadline
- **THEN** the current attempt SHALL conditionally fail with `RECOVERY_ROUTE_UNAVAILABLE`
- **AND** SHALL NOT remain indefinitely processing

#### Scenario: Persist the actual formal submission route

- **GIVEN** image request inputs select a different binding from the model's default binding
- **WHEN** the formal POST is about to be sent
- **THEN** the submitted-attempt marker and actual selected binding SHALL be persisted atomically
- **AND** recovery SHALL be excluded when the final prepared target cannot carry the Request ID

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
- **AND** a returned `request_id`, when present, SHALL match the active submission Request ID
- **AND** the original card and batch preview SHALL receive the completed image
- **AND** cache failure SHALL NOT discard an otherwise valid remote image URL

#### Scenario: Recovered result caching remains bounded

- **GIVEN** multiple submitted image tasks become recoverable at the same time
- **WHEN** result queries succeed and remote images are cached
- **THEN** query, download, and terminal writeback work SHALL remain within the configured recovery concurrency bound
- **AND** cancellation, deletion, retry, or unmount SHALL abort an in-flight recovery cache download

#### Scenario: Recovery route becomes unavailable

- **GIVEN** a persisted recovery candidate whose provider or actual binding can no longer be resolved
- **WHEN** the recovery executor attempts to start it
- **THEN** the task SHALL receive an explicit conditional configuration failure
- **AND** SHALL NOT remain in `POLLING` until the generic task timeout

#### Scenario: Upstream reports failure or recovery expires

- **WHEN** the result endpoint returns an explicit failure
- **THEN** the system SHALL write the upstream error to the same task
- **WHEN** the existing image-task deadline expires without a terminal result
- **THEN** the system SHALL mark the task failed instead of leaving it indefinitely processing
- **AND** an already observed success or failure terminal result SHALL take precedence over the deadline

#### Scenario: Cancellation, deletion, retry, or late terminal result

- **WHEN** the task is cancelled, deleted, retried, or already completed by another valid writer
- **THEN** the old recovery loop SHALL stop
- **AND** timers, response references and AbortControllers SHALL be released
- **AND** a late result for an old Request ID SHALL NOT overwrite the current task state
- **AND** deletion SHALL retain its tombstone until same-task serialized writes are drained
- **AND** clearing all tasks SHALL keep writes paused after storage removal succeeds

#### Scenario: Explicit same-ID replacement supersedes an active execution

- **GIVEN** an old task execution is still awaiting a provider, cache, or polling result
- **WHEN** retry, backup import, GitHub synchronization, or explicit delete-and-restore installs a newer task object with the same local ID
- **THEN** the replacement SHALL receive a new in-memory execution identity
- **AND** the old execution SHALL NOT write progress, remote IDs, cached results, errors, or terminal state to the replacement
- **AND** the old execution's cleanup SHALL NOT release the replacement's execution or polling slot
- **AND** an active image recovery entry for the old object SHALL stop before the replacement is installed
- **AND** invalidated video polling SHALL stop issuing further upstream requests

#### Scenario: Queued execution is cancelled or replaced

- **GIVEN** all execution slots are occupied and a pending task is stored in the hook wait queue with its lifecycle identity
- **WHEN** the task is cancelled or a newer object with the same local ID replaces it before a slot opens
- **THEN** a cancelled queued task SHALL NOT issue a provider request
- **AND** the replacement SHALL renew the lifecycle identity and replace the queued snapshot
- **AND** dequeue SHALL re-read the current task and execute only when its identity and runnable status still match

### Requirement: Custom HTTP Image Multipart Inputs SHALL Be Read Safely

The system SHALL bound and validate every image source materialized into a Custom HTTP multipart request before sending the provider submission.

#### Scenario: Remote image input is fetched

- **WHEN** a Custom HTTP multipart field references a cross-origin image URL
- **THEN** the URL SHALL use HTTP(S), omit embedded credentials, and exclude localhost, private, and link-local literal targets
- **AND** the download SHALL omit browser credentials and referrer data
- **AND** redirects SHALL be rejected
- **AND** the response SHALL declare an `image/*` MIME type

#### Scenario: Same-origin image input is used

- **GIVEN** the page is running on a local, LAN, or public origin
- **WHEN** a multipart field references a relative or absolute same-origin image or blob URL
- **THEN** the system SHALL allow the source without treating the page's own origin as a cross-origin private target
- **AND** SHALL still omit credentials and enforce MIME and byte limits

#### Scenario: Multipart input exceeds a resource limit

- **WHEN** a declared or actually streamed file exceeds 20 MiB, or the form exceeds 16 files, 64 MiB file data, or 1 MiB text data
- **THEN** the system SHALL reject the request before the provider POST
- **AND** SHALL cancel the active response stream when one exists
- **AND** each file SHALL be checked against the remaining aggregate budget before full decoding or streaming
- **AND** remote file buffering SHALL start at no more than 64 KiB and grow only as needed

#### Scenario: Task is cancelled while a multipart image is downloading

- **WHEN** the task AbortSignal fires before the file read completes
- **THEN** the active reader SHALL be cancelled
- **AND** the provider submission SHALL NOT be sent
