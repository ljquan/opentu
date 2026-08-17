# Change: Add an embedded OpenTu account workspace

## Why

The Tuzi-hosted OpenTu flow now has device-bound identity and credential-scoped storage, but the rendered product still looks like standalone OpenTu. Drawing and video users must leave the canvas and understand the API console to inspect balance, call records, recharge, or connected devices.

## What Changes

- Add an embedded-mode account control and account workspace inside OpenTu.
- Show the verified Tuzi account, balance, concise call records, and connected OpenTu devices through DPoP-protected endpoints.
- Limit each call record to time, model, output, detail, and server-calculated amount.
- Let users revoke other OpenTu devices and complete the recharge selection and payment-status flow inside OpenTu while keeping the existing Tuzi order, gateway, callback, and settlement implementation unchanged.
- Keep standalone OpenTu visually and behaviorally compatible with its existing local provider/API-key settings.
- Show actionable expired-session, revoked-device, insufficient-balance, empty, loading, and retry states.

## Impact

- Affected specs: `opentu-account-workspace` (new), `opentu-device-auth`, `provider-routing`
- Affected OpenTu code: account client/service, canvas account control, account drawer, embedded host bridge
- Affected Tuzi code: explicit DPoP account-workspace routes and thin adapters over the existing unified top-up controllers
- No new database, payment settlement, webhook, refund, or order schema
