## ADDED Requirements

### Requirement: Independent authentication
The system SHALL provide password registration, sign-in, sign-out and password changes using a maintained authentication library and PostgreSQL sessions.

#### Scenario: Logout invalidates a session
- **WHEN** the signed-in user signs out
- **THEN** subsequent use of that session cookie is rejected

### Requirement: Privilege isolation
The system SHALL assign ordinary privileges during registration and SHALL reject client attempts to set privileged fields.

#### Scenario: Registration cannot grant administration
- **WHEN** a registration request supplies an administrator role
- **THEN** the created account retains ordinary privileges

### Requirement: Account staging boundary
The system SHALL avoid loading legacy shared browser workspaces in the account-only staging interface until account storage isolation is complete.

#### Scenario: Switching staging accounts
- **WHEN** another account signs in to account staging
- **THEN** the interface loads only that account's server session and does not load legacy workspace data
