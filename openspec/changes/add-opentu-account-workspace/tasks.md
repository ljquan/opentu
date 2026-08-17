## 1. Contract And Tuzi Endpoints

- [x] 1.1 Define typed account summary, call-record, top-up, and device payloads
- [x] 1.2 Add explicit DPoP-protected read routes with ownership and pagination bounds
- [x] 1.3 Reuse existing device revocation and payment pages without changing payment behavior
- [x] 1.4 Add controller, router, authorization, and response-shape tests
- [x] 1.5 Add DPoP adapters for unified top-up quote, creation, and ownership-scoped query
- [x] 1.6 Verify idempotency, amount validation, gateway redaction, and payment regressions

## 2. OpenTu Data Layer

- [x] 2.1 Extend the DPoP client with account-workspace reads and device revoke
- [x] 2.2 Add embedded runtime state, loading/error classification, refresh, and retry
- [x] 2.3 Add a versioned trusted host command for the recharge destination
- [x] 2.4 Keep standalone provider/API-key behavior unchanged
- [x] 2.5 Add typed DPoP quote, create-order, and order-query client methods

## 3. Account Workspace UI

- [x] 3.1 Add a compact canvas account control with account and balance state
- [x] 3.2 Add overview, call-record, and devices views with the five approved record fields
- [x] 3.3 Add recharge, retry, refresh, revoke, empty, expired-session, and insufficient-balance interactions
- [x] 3.4 Add responsive styling and component tests without changing the canvas layout
- [x] 3.5 Replace the Tuzi-console recharge handoff with an in-drawer amount, gateway, checkout, and status flow

## 4. Verification

- [x] 4.1 Run Tuzi OpenTu controller/router and payment regression tests
- [x] 4.2 Run OpenTu client/component tests, type checks, lint, and build
- [x] 4.3 Verify standalone OpenTu and unauthenticated embedded behavior
- [ ] 4.4 Verify the authenticated iframe account workspace and recharge handoff
- [x] 4.5 Review final diffs and QA/DOC requirements
- [x] 4.6 Verify the OpenTu-native recharge flow without submitting a real payment
