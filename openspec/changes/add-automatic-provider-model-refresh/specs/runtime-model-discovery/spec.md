## ADDED Requirements

### Requirement: Refresh provider models once after an application version change
The system SHALL asynchronously refresh eligible saved provider catalogs after startup when their last successful automatic refresh version differs from the running OpenTu application version. It SHALL use the existing authenticated discovery path and SHALL NOT add periodic polling.

#### Scenario: Upgrade with an existing catalog
- **WHEN** a new app version starts with an enabled, verified provider and saved credentials supported by model discovery
- **THEN** its models SHALL be fetched in the background without blocking cached rendering
- **AND** only successful catalog persistence SHALL record lastAutoRefreshVersion

#### Scenario: Same version restarts
- **WHEN** the app restarts with the same version and provider identity after a successful automatic refresh
- **THEN** it SHALL NOT automatically fetch that catalog again

#### Scenario: Existing settings without a version marker
- **WHEN** an older configuration has no lastAutoRefreshVersion
- **THEN** it SHALL remain valid and be eligible for one automatic refresh
- **AND** saved/restored catalog data SHALL preserve a valid optional version marker

#### Scenario: Unavailable or failed provider
- **WHEN** the provider is disabled, lacks credentials, is not verified, or does not support model discovery
- **THEN** automatic discovery SHALL be skipped until the configuration is ready
- **WHEN** discovery fails
- **THEN** its cached models SHALL remain available and the successful version SHALL NOT advance
- **AND** a later app startup MAY retry, without a recurring timer

### Requirement: Preserve model choices during version refresh
Automatic refresh SHALL add newly returned models to the existing selected catalog while preserving prior deselections, manual entries and bindings, current/default selections and running task routes. It SHALL reuse existing model classification and adapters.

#### Scenario: Newly available model
- **WHEN** the current key's model endpoint returns a new model
- **THEN** the corresponding selector SHALL display it with the correct provider identity
- **AND** a previously deselected model SHALL remain deselected

#### Scenario: Concurrent configuration edits
- **WHEN** the provider credentials change or the provider is disabled or deleted while fetching
- **THEN** the late response SHALL NOT overwrite the catalog
- **WHEN** the user changes model selections or manual bindings while fetching
- **THEN** the committed catalog SHALL preserve those edits
