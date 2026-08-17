## 1. Tuzi Managed-Key Contract

- [x] 1.1 Define bounded group-list, synchronize, and single-group rotation payloads
- [x] 1.2 Reuse existing user-group eligibility, Token table, and key generator with readable names, idempotent managed-token lookup, and deletion of replaced managed tokens
- [x] 1.3 Add DPoP-protected OpenTu routes without database or network-security changes
- [x] 1.4 Add ownership, group eligibility, concurrent synchronization, and rotation recovery tests

## 2. OpenTu Synchronization

- [x] 2.1 Extend the typed DPoP client and account context with managed-group operations
- [x] 2.2 Upsert stable managed provider profiles while preserving unrelated configuration
- [x] 2.3 Automatically synchronize after verified embedded account startup and repair local configuration after reload
- [x] 2.4 Store managed profiles in the existing credential-namespaced config store and serialize profile mutations
- [x] 2.5 Select the existing direct provider path for embedded Tuzi generation while preserving its request behavior
- [x] 2.6 Keep standalone mode and manual provider configuration unchanged

## 3. Account Overview

- [x] 3.1 Add a dynamic access-group section below the balance card
- [x] 3.2 Add one confirmed `全部重新生成` action with aggregate loading, success, and row-level failure states
- [x] 3.3 Add client, context, profile-sync, and component tests

## 4. Verification

- [x] 4.1 Run targeted Tuzi controller/router/model tests and `go vet` for affected packages
- [x] 4.2 Run targeted OpenTu tests, type checks, lint, formatting, and build checks
- [x] 4.3 Review final diffs and confirm no new database/store, request-format, payment, or network-security configuration changes
