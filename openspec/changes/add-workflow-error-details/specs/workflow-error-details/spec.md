## ADDED Requirements
### Requirement: Structured workflow failures
Video, text and agent failure cards SHALL show Request ID, error, model and an optional provider task ID, with no extra diagnostic fields.

#### Scenario: Failed API request
- **WHEN** the provider returns error metadata
- **THEN** the failed step SHALL retain and display it through serialization
- **AND** for text and Agent analysis errors, the provider-message Request ID SHALL take priority over gateway IDs
- **AND** displayed error text SHALL omit its duplicate Request ID while retaining the stored original

#### Scenario: Agent has multiple steps
- **WHEN** a step fails
- **THEN** only the matching failed step's metadata SHALL be displayed
- **AND** absent provider IDs SHALL never be replaced with local task IDs

#### Scenario: Copy and layout
- **WHEN** a user activates the single copy-all button in the first detail row
- **THEN** all displayed error fields SHALL be copied as labelled lines in display order, with indented multiline continuations and icon-only success feedback
- **AND** individual field copy buttons SHALL NOT appear
- **AND** missing values SHALL retain displayed placeholders, while an absent optional task ID SHALL be omitted
- **AND** long values SHALL wrap without clipping or extending outside the selected card


#### Scenario: Ordinary Agent MCP execution fails
- **WHEN** Agent analysis returns a failure, throws, or reports a failed child tool through MCP
- **THEN** diagnostic metadata SHALL survive task storage, step callbacks and workflow message serialization
- **AND** both initial execution and retry entry points SHALL pass metadata to the matching failed step
- **AND** a response-header-only Request ID and the actual model SHALL be retained

#### Scenario: Existing credential classification consumes structured errors
- **WHEN** an API error code moves from the legacy error body into structured diagnostics
- **THEN** existing credential classification SHALL still recognize the same missing or invalid credential signals
- **AND** generic HTTP 401/403 and unrelated diagnostic identifiers SHALL NOT independently trigger a credential classification

#### Scenario: Video failure identifies the original API-site submission
- **WHEN** a video submission exposes `X-Oneapi-Request-Id` or returns its API-site submission ID in the response body
- **THEN** that ID SHALL be stored with the remote video task and survive task persistence and workflow serialization
- **AND** the video failure card SHALL use this original submission ID, not an upstream ID embedded in error text or the ID of a subsequent polling request
- **AND** polling may supply the original ID only through an explicit task-scoped `submission_request_id`, `original_request_id` or `api_request_id` field
- **AND** absent or browser-inaccessible submission IDs, including legacy records containing only upstream IDs, SHALL display as unavailable
- **AND** retrying with a new remote task SHALL clear the previous submission ID; resuming the same remote task SHALL retain it

The observed API-site polling response does not expose `X-Oneapi-Request-Id` to cross-origin JavaScript and the observed polling body contains no original submission ID. A server-side exposed header or explicit original-ID body field is required to display that ID. This frontend bug fix does not change provider CORS, proxy configuration, generation state transitions, polling retries, card layout or unrelated media diagnostics.
