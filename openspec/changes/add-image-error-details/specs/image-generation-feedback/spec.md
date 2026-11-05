## ADDED Requirements
### Requirement: Image Failure Details Preserve Provider Diagnostics
The system SHALL retain available provider Request ID, error code, HTTP status, actual model and remote task ID with failed image tasks.

#### Scenario: Provider rejects a request
- **WHEN** a sync or async image request fails through HTTP or a failed business status
- **THEN** available diagnostic fields SHALL survive error wrapping and task persistence
- **AND** a Request ID explicitly embedded in the provider error message SHALL take precedence over structured fields and gateway response headers, including for historical tasks
- **AND** absent provider identifiers SHALL NOT be replaced with local IDs

### Requirement: Compact Image Failure Details
The system SHALL display model, formatted error, Request ID and an API task ID when available, with one button to copy all visible diagnostics in the existing details panel.

#### Scenario: User copies all diagnostics
- **WHEN** the user activates the single copy-all button in the first detail row
- **THEN** all visible diagnostic fields SHALL be copied in display order as labelled lines, with indented multiline continuations
- **AND** individual field copy buttons SHALL NOT appear inside the details panel
- **AND** missing provider identifiers SHALL retain their displayed placeholders, and absent optional task IDs SHALL be omitted
- **AND** successful copying SHALL briefly change the button icon without adding a feedback row or changing card height

#### Scenario: User opens failure details
- **WHEN** the detail panel opens
- **THEN** local task, workflow, shape and transition SHALL appear directly after the provider fields
- **AND** there SHALL be no secondary technical-details disclosure or height limit hiding rows

#### Scenario: Historical failure has an embedded ID
- **WHEN** only a legacy error message contains the Request ID
- **THEN** the system SHALL extract it for display and retain the original error

#### Scenario: Error message includes the displayed request ID
- **WHEN** the error description ends with explicit Request ID annotations, with or without parentheses
- **THEN** those provider/gateway ID suffixes SHALL be omitted from display, retaining error codes, description and stored original text
- **AND** the Request ID row SHALL still prefer the provider-message ID
- **AND** unlabelled IDs, task IDs and request-ID references within explanatory prose SHALL be preserved

#### Scenario: Expanded card remains selected
- **WHEN** details expand, collapse or the canvas zoom changes
- **THEN** selection and hit-test bounds SHALL follow the rendered card size without mutating requested image dimensions
- **AND** technical rows SHALL flow directly below provider details, without a separate disclosure control
