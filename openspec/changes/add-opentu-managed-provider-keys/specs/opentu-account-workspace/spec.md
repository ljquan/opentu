## ADDED Requirements

### Requirement: Manage One OpenTu Key Per Usable Group

Tuzi SHALL expose the authenticated user's usable groups through the DPoP-protected OpenTu account contract and SHALL maintain one recoverable OpenTu-managed API key for each returned group using the existing token store.

#### Scenario: Embedded account initializes

- **GIVEN** a verified embedded OpenTu credential
- **WHEN** OpenTu synchronizes managed access groups
- **THEN** Tuzi SHALL return every currently usable group with a stable identifier and display name
- **AND** SHALL reuse an active matching managed token or create only a missing token
- **AND** repeated or concurrent synchronization SHALL NOT create duplicate active managed tokens for the same user and group

#### Scenario: User regenerates all group keys

- **WHEN** the user confirms `全部重新生成`
- **THEN** OpenTu SHALL request rotation for every currently returned usable group
- **AND** Tuzi SHALL create and durably store each selected group's replacement before deleting that group's previous managed tokens with its standard token-deletion behavior
- **AND** each replacement SHALL have a readable managed-token name containing its group display name
- **AND** repeated delivery of the same group-rotation request SHALL return the same replacement without creating another token
- **AND** SHALL leave non-OpenTu-managed tokens unchanged

### Requirement: Present Dynamic Access Groups In The Account Overview

The embedded account overview SHALL show one access-group row per server-returned usable group directly below the balance card.

#### Scenario: Groups load successfully

- **WHEN** the account overview receives managed groups
- **THEN** it SHALL render every returned group with its status and one `全部重新生成` command
- **AND** SHALL NOT display or offer to copy the raw API key

#### Scenario: One group rotation fails

- **WHEN** one group fails during `全部重新生成`
- **THEN** the overview SHALL report the error on that group row
- **AND** SHALL continue attempting the remaining groups
- **AND** SHALL report aggregate success and failure counts

## MODIFIED Requirements

### Requirement: Present User-Owned Account Data

Tuzi SHALL expose explicit DPoP-protected, ownership-scoped account workspace reads and managed-group operations with bounded inputs.

#### Scenario: User views account data

- **WHEN** a valid device requests account, call-record, top-up, device, or managed-group data
- **THEN** Tuzi SHALL return only data visible to the credential's user
- **AND** OpenTu SHALL render loading, empty, success, and retry states without displaying raw secrets

#### Scenario: Credential is expired or revoked

- **WHEN** Tuzi rejects the account workspace request as unauthorized
- **THEN** OpenTu SHALL show an expired or disconnected state
- **AND** SHALL NOT reuse another account's cached data or managed profiles
