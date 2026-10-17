## ADDED Requirements
### Requirement: Dedicated works page
The application SHALL provide a dedicated `/works` page that presents saved canvases and generated results from the existing workspace runtime, with filtering and search controls.

#### Scenario: Open works from the primary navigation
- **WHEN** a user selects "我的作品"
- **THEN** the application navigates to `/works` without scrolling the home page or performing a full document reload

#### Scenario: Filter works
- **WHEN** a user selects a work category or enters a search query
- **THEN** the works list shows only matching canvas or generation entries

### Requirement: Dedicated workflows page
The application SHALL provide a dedicated `/workflows` page that presents curated workflows and locally saved workflow drafts as a separate product surface.

#### Scenario: Open workflows from the primary navigation
- **WHEN** a user selects "工作流"
- **THEN** the application navigates to `/workflows` without scrolling the home page or performing a full document reload

#### Scenario: Create a workflow draft
- **WHEN** a user submits a valid workflow name and description
- **THEN** the workflow appears in the user's draft list and remains available after a page reload on the same device
