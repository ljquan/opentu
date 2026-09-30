## ADDED Requirements
### Requirement: Verify and reuse existing Tuzi providers
The embedded app SHALL verify current-site provider credentials against the authenticated Tuzi account before reuse, preserving provider identity, names, model configuration and token restrictions.

#### Scenario: Several existing providers belong to the current account
- **WHEN** account association succeeds and existing credentials verify as usable
- **THEN** all usable profiles SHALL remain separate, including profiles sharing a group
- **AND** no new token SHALL be created for groups already covered

#### Scenario: Partially invalid or foreign credentials
- **WHEN** some credentials are missing, foreign, disabled, exhausted or expired
- **THEN** valid providers SHALL remain usable and invalid entries SHALL show individual reasons
- **AND** ordinary credentials SHALL never be repaired, deleted or rotated by managed-token operations

#### Scenario: Account changes during verification
- **WHEN** the account or candidate configuration changes before a reply arrives
- **THEN** the stale verification SHALL NOT authorize requests or overwrite the new account state
