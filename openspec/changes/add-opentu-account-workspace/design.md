## Context

OpenTu is a standalone open-source frontend and is also deployed in a Tuzi iframe. Embedded mode has a verified DPoP credential; standalone mode may use local provider API keys. Tuzi already owns account, call-record, top-up, and payment data.

## Goals / Non-Goals

- Goals:
  - make the embedded canvas a usable product surface for account and billing awareness
  - reuse Tuzi data and payment flows without adding another backend or database
  - preserve standalone OpenTu behavior
- Non-Goals:
  - exposing or managing raw Tuzi API keys in the iframe
  - reimplementing payment creation, settlement, webhooks, refunds, or subscriptions
  - duplicating the local OpenTu task queue as a second remote generation database

## Decisions

### Runtime mode

- The explicit `opentu_bind=1` startup contract determines embedded mode.
- Embedded account UI mounts only after binding and namespace selection succeed.
- Standalone mode keeps the existing provider settings and does not show a fake Tuzi account.

### Data boundary

- Account, call records, top-up history, and devices use explicit DPoP-protected OpenTu endpoints.
- Call-record amounts are calculated by Tuzi from its quota display settings and exchange rate; OpenTu only formats the returned amount and currency symbol.
- The OpenTu client owns refresh, nonce retry, response normalization, and typed errors.
- The account workspace never receives a Tuzi API key, browser Session cookie, or payment credential.

### Recharge

- The account workspace loads enabled unified gateways and presents amount and gateway selection inside OpenTu.
- DPoP-protected OpenTu endpoints adapt to Tuzi's existing unified quote, order-creation, and ownership-scoped active-query handlers.
- OpenTu supplies only the selected gateway, requested credit amount, and an idempotency key; Tuzi recalculates the payable amount and enforces all gateway limits.
- QR-code payment data is rendered inside the account drawer. Redirect-style gateways open only the payment provider URL, never the Tuzi console.
- Payment callbacks, reconciliation, settlement, refunds, and balance mutation remain entirely in Tuzi.

### UI placement

- A compact account control sits in the fixed top section of the existing left canvas toolbar and shows account state plus avatar/initials.
- It opens one unframed account drawer with overview, call-record, and devices views.
- Call records expose only time, model, output, detail, and amount in the account workspace.
- Loading, empty, retry, revoked-session, and insufficient-balance states are part of the component contract.

## Risks / Trade-offs

- DPoP list routes add backend surface area. Mitigation: explicit read-only routes, bounded pagination, and existing user ownership filters.
- Redirect-style gateways may still leave the iframe for the provider checkout. OpenTu never treats a redirect or client state as proof of payment and confirms completion through Tuzi.
- Payment creation from DPoP increases the consequence of a stolen device credential. Mitigation: reuse existing idempotency, rate limits, pending-order caps, amount validation, gateway snapshots, and ownership-scoped queries.
- Call-record lists can grow large. Mitigation: use bounded pagination and load the list only when its view is opened.

## Rollback

Disable the embedded account UI and new read routes. Existing binding, provider calls, standalone settings, payments, and stored content remain valid.
