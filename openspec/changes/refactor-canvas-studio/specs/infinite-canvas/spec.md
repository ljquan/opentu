## ADDED Requirements

### Requirement: Canvas-first workspace

The workspace SHALL present the infinite canvas as the primary surface and
shall allow supporting panels to be collapsed without losing their actions.

#### Scenario: Open an existing board

- **WHEN** a user opens a board URL
- **THEN** the board renders with its existing elements and the canvas remains
  the dominant surface
- **AND** the user's saved panel and focus preferences are restored locally

### Requirement: Recoverable creation dock

The workspace SHALL expose image, video, audio, canvas, model, ratio,
resolution, reference, and generation task controls from an explicit creation
dock without changing the existing generation contract.

#### Scenario: Start an image generation

- **WHEN** a user enters a prompt and submits the creation dock
- **THEN** the request uses the selected model and output settings
- **AND** the task remains visible and recoverable through the task surface

### Requirement: Optional starter scene

The workspace SHALL keep starter examples separate from the empty board path.

#### Scenario: Create a blank board

- **WHEN** a user chooses a blank canvas
- **THEN** the board opens without demo nodes or generated-result placeholders
- **AND** the user can add the starter scene from an explicit action

### Requirement: Existing board compatibility

The workspace SHALL read existing serialized boards without destructive
rewrites during the visual shell migration.

#### Scenario: Reopen a legacy board

- **WHEN** a board created before the migration is opened
- **THEN** all supported elements and cached media remain available
- **AND** the board can be saved using the existing persistence path
