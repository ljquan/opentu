## ADDED Requirements

### Requirement: Single Canvas Creation Surface

The system SHALL use the main OpenTu canvas as the creation surface and SHALL remove the dedicated workflow-mode application and its exclusive runtime dependencies while retaining the shared task and workflow engines used by the main canvas.

#### Scenario: Existing workflow link
- **WHEN** a user opens `/workflow` or a path beneath `/workflow/`
- **THEN** the system SHALL show the main canvas and make legacy data recovery accessible
- **AND** SHALL NOT mount the removed workflow application

#### Scenario: Ordinary workflow execution
- **WHEN** an existing main-canvas task, Agent, or batch feature uses a shared workflow service
- **THEN** that service SHALL remain available without importing the removed application

### Requirement: Consolidated Image Tools

The system SHALL provide configurable image shortcuts, manual splitting, local proportional resizing, and angle-prompt preparation through the existing main-canvas UI, storage and task mechanisms.

#### Scenario: Local image operation
- **WHEN** the user confirms a local split or resize
- **THEN** the system SHALL preserve the source image and insert the resulting elements through existing canvas operations
- **AND** SHALL NOT issue a paid generation request

#### Scenario: Angle edit preparation
- **WHEN** the user confirms angle settings
- **THEN** the system SHALL prefill the existing generation input with the source image and angle instructions
- **AND** SHALL wait for an explicit send action before submitting generation

#### Scenario: Existing target drafts
- **WHEN** the user switches between bound image targets
- **THEN** the existing target-specific draft behavior SHALL remain available
- **AND** SHALL NOT be replaced by an independent workflow-mode store

### Requirement: Non-destructive Legacy Data Recovery

The system SHALL provide an on-demand legacy-data compatibility module independent of the removed application, with recoverable business-data export and explicit import into new main-canvas records.

#### Scenario: Export legacy data
- **WHEN** a user exports legacy projects and assets
- **THEN** available stored media and required business metadata SHALL be included
- **AND** missing or unsupported content SHALL be reported
- **AND** ordinary exports SHALL exclude API keys and authentication credentials
- **AND** the legacy source database SHALL remain unchanged

#### Scenario: Unsupported nodes or malformed data
- **WHEN** legacy data includes unknown nodes or cannot be safely converted
- **THEN** the system SHALL preserve recoverable source information and report conversion limits
- **AND** SHALL NOT overwrite existing projects or silently execute unsupported nodes

#### Scenario: Pending legacy generation
- **WHEN** the user opens the main canvas or exports or imports legacy data containing pending tasks
- **THEN** the system SHALL NOT resubmit generation requests
- **AND** SHALL retain supported query-based recovery or report that the result requires confirmation
