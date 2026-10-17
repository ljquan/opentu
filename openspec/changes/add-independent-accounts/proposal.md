# Independent accounts

Approved by the owner on 2026-09-06 after the Tuzi cookie integration was found unable to authenticate an unrelated domain.

## Why
The deployment needs its own registration, login and revocable sessions.

## What Changes
- Better Auth with PostgreSQL for email/password credentials and sessions.
- Same-origin account interface and existing API identity integration.
- Explicit registration switch, server-managed permissions, secure cookies and throttling.
- Account-only staging interface until workspace storage isolation is completed.

## Impact
- API authentication, database schema, browser login UI and deployment.
- No inferred Tuzi identity linking; mail verification/recovery requires a configured mail service.
