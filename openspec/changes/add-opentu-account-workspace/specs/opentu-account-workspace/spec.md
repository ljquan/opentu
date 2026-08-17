## ADDED Requirements

### Requirement: Show A Verified Embedded Account Workspace

OpenTu SHALL show account controls only for a successfully verified embedded Tuzi credential and SHALL source account data through the DPoP-aware client.

#### Scenario: Embedded account loads

- **GIVEN** OpenTu completed binding and selected the verified credential namespace
- **WHEN** the canvas application mounts
- **THEN** it SHALL show the verified account identity and balance in a compact canvas control
- **AND** opening the control SHALL expose overview, call-record, and devices views

#### Scenario: Standalone OpenTu loads

- **WHEN** OpenTu starts without the explicit binding contract
- **THEN** it SHALL keep the existing local provider and API-key workflow
- **AND** SHALL NOT present an authenticated Tuzi account

### Requirement: Present User-Owned Account Data

Tuzi SHALL expose explicit DPoP-protected, ownership-scoped account workspace reads with bounded pagination.

#### Scenario: User views account data

- **WHEN** a valid device requests account, call-record, top-up, or device data
- **THEN** Tuzi SHALL return only data visible to the credential's user
- **AND** OpenTu SHALL render loading, empty, success, and retry states without exposing secrets

#### Scenario: Credential is expired or revoked

- **WHEN** Tuzi rejects the account workspace request as unauthorized
- **THEN** OpenTu SHALL show an expired or disconnected state
- **AND** SHALL NOT reuse another account's cached data

### Requirement: Recharge Inside The Embedded Account Workspace

OpenTu SHALL present recharge selection and payment status inside the embedded account workspace while Tuzi remains authoritative for payment orders and balance settlement.

#### Scenario: User selects recharge

- **WHEN** the user activates recharge in the embedded account workspace
- **THEN** OpenTu SHALL load enabled unified gateways and present amount and gateway selection without navigating to the Tuzi console
- **AND** Tuzi SHALL validate the selected gateway and recalculate the payable amount

#### Scenario: User creates a payment order

- **WHEN** the user confirms a valid amount and gateway
- **THEN** OpenTu SHALL create the order with a retry-stable idempotency key
- **AND** Tuzi SHALL apply the existing rate limit, pending-order limit, gateway snapshot, and payment creation behavior
- **AND** OpenTu SHALL render returned QR data in its own interface or open only the returned payment-provider URL

#### Scenario: Payment status changes

- **WHEN** OpenTu queries a created order
- **THEN** Tuzi SHALL confirm that the order belongs to the authenticated user
- **AND** OpenTu SHALL refresh the account balance only after Tuzi reports the order as successful

### Requirement: Manage Bound OpenTu Devices

The embedded account workspace SHALL list the user's OpenTu devices and allow revocation through the existing DPoP device contract.

#### Scenario: User revokes another device

- **WHEN** the user confirms revocation of an owned active device
- **THEN** Tuzi SHALL revoke its token family
- **AND** OpenTu SHALL refresh the device list and show the resulting status

#### Scenario: User selects the current device

- **WHEN** the current credential's device is displayed
- **THEN** OpenTu SHALL identify it as the current device
- **AND** SHALL require an explicit confirmation before revocation

### Requirement: Surface Billing-Relevant Call Records

The account workspace SHALL present concise Tuzi call records without creating a duplicate generation store or loading the model pricing catalog.

#### Scenario: Call records are available

- **WHEN** Tuzi returns recent image or video call records
- **THEN** OpenTu SHALL show only time, model, output, detail, and billed amount for each record
- **AND** the billed amount SHALL use the amount and currency calculated by Tuzi
- **AND** local generation detail and canvas insertion SHALL remain owned by the existing task queue

#### Scenario: Balance is insufficient

- **WHEN** a provider request reports insufficient balance
- **THEN** OpenTu SHALL show a recharge action associated with the account control
- **AND** SHALL preserve the failed local task for retry after recharge
