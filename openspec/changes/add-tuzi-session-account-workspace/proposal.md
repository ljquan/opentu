# Change: Add Tuzi Session account workspace and managed providers

## Why

OpenTu can run independently with user-managed provider credentials, but the Tuzi-embedded deployment needs a Session-backed account workspace and automatic per-group Provider setup. The integration must reuse current Tuzi APIs, Token storage, Relay, billing and logs without adding parallel database tables.

## What Changes

- Add a trusted, build-configured Tuzi embedded mode.
- Add a credentialed Session API client for current-user, available-model, and usage-log endpoints.
- Add a Tuzi account view to the existing settings dialog.
- Update Tuzi API user authentication so a valid server Session does not require a client-supplied user ID header.
- Replace credentialed wildcard CORS behavior with an explicit Origin allowlist.
- Return a stable `SESSION_EXPIRED` error for missing or invalid Sessions.
- Preserve standalone Provider/API Key behavior.
- Automatically ensure one managed Token per user-authorized Tuzi group and synchronize it to the existing OpenTu Provider settings.
- Keep the Tuzi API base URL fixed by trusted runtime configuration.
- Allow refresh and managed-token rotation without exposing Token management controls in the normal OpenTu UI.

## Non-Goals

- Do not add a new Token or Provider database model.
- Do not change existing standalone model invocation behavior.
- Do not add async task history, polling, or recovery beyond preserving existing Provider routes during rotation.
- Do not add cloud canvas data, assets, or payment.
- Do not add database tables or schema migrations.

## Impact

- Affected specs: `tuzi-session-account`
- Affected OpenTu code:
  - embedded runtime configuration and managed Provider synchronization
  - Session API client
  - settings dialog account and logs view
- Affected Tuzi API code:
  - user authentication middleware
  - CORS configuration
  - Session cookie configuration, managed Provider endpoints and tests
