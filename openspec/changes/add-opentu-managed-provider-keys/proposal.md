# Change: Add managed OpenTu provider keys

## Why

Tuzi-embedded OpenTu still requires users to understand, create, copy, and configure one API key per pricing group. The first delivery should remove that setup work without replacing the existing provider request path or adding a new credential database.

## What Changes

- Add DPoP-protected endpoints that list the current user's OpenTu-managed group keys, create keys for missing usable groups, and rotate a selected group key with standard deletion of its replaced token.
- Reuse Tuzi's existing user-token table, group rules, and token-key generator; do not add a database or migration.
- Synchronize managed group keys into OpenTu's existing `providerProfiles` settings and current credential namespace.
- Show one access-group row per server-returned group under the balance card, with one `全部重新生成` command that rotates every returned group and reports partial failures.
- Use the existing direct provider transport for embedded Tuzi image, video, audio, and model calls so the managed group key is applied through the original request URL, payload, and authorization-header behavior.
- Keep model routing, task behavior, and standalone manual API-key behavior unchanged; DPoP remains the account and managed-key control plane.
- Accept as an explicit compatibility-stage trade-off that raw managed keys are delivered to the embedded browser and remain visible to browser developer tools.

## Impact

- Affected specs: `opentu-account-workspace`, `provider-routing`
- Affected OpenTu code: account client/context, managed-profile synchronization, account overview UI, existing settings storage
- Affected Tuzi code: DPoP OpenTu routes and adapters over the existing token/group model
- No new database or object store, model request format, CORS/CSP/proxy, or payment change
