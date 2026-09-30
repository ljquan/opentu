## ADDED Requirements
### Requirement: Import account tokens explicitly
The system SHALL list existing tokens owned by the associated account with their names, groups and availability, without revealing keys before selection. Import SHALL preserve existing token constraints and local provider identities.

#### Scenario: Multiple default tokens
- **WHEN** several eligible default tokens are listed
- **THEN** only the first not-yet-added default token is preselected, and same-group tokens remain distinct

#### Scenario: Account changes or unavailable tokens
- **WHEN** the account changes during a request or a selected token becomes unavailable
- **THEN** stale credentials SHALL NOT be installed and unavailable tokens SHALL NOT be imported

### Requirement: Explicit named token creation
The system SHALL initially select only default, expose other groups on demand, and preview one named token per selected group. Creation SHALL be atomic and restricted to authorized groups.

#### Scenario: Several groups selected
- **WHEN** the user submits a nonempty name and multiple authorized groups
- **THEN** one token per group is created with the group suffix and added to OpenTu

#### Scenario: No default group
- **WHEN** default is unavailable
- **THEN** no group is preselected and creation requires explicit selection
