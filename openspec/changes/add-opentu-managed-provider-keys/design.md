## Context

OpenTu already stores manual provider credentials in `providerProfiles` and can invoke providers directly using each profile's existing authentication strategy. Its tasks and application databases are isolated by verified `credential_id`, but the complete `drawnix_settings` document is still global localStorage and cannot safely hold managed keys for multiple embedded accounts. Tuzi already stores user API tokens with a group and can determine which groups a user may use.

The previously approved account-workspace design deliberately excluded raw API keys. This compatibility-stage change supersedes that boundary only for Tuzi-managed provider profiles. It does not replace the later server-side Relay option.

## Goals / Non-Goals

- Goals:
  - create or recover one OpenTu-managed API key for every server-returned usable group
  - configure and persist matching OpenTu provider profiles without manual user input
  - rotate all currently usable groups from one account-overview command
  - preserve the original direct provider request behavior while retaining DPoP for account and key management
- Non-Goals:
  - hiding managed API keys from the browser or developer tools
  - changing provider request URLs, payload shapes, authorization-header format, task polling, or model routing
  - adding a credential database, changing network security configuration, or removing standalone manual profiles

## Decisions

### Server-owned group set

- Tuzi derives the usable group set from its existing user/group rules and returns stable group identifiers plus display names.
- OpenTu never invents group membership from pricing data.
- Disabled or no-longer-usable groups are not automatically deleted from Tuzi token history; their managed OpenTu profiles are disabled locally instead of being reassigned to another group.

### Existing token storage

- Each managed token uses a deterministic server-owned name marker scoped to its user and group.
- Synchronization reuses an active matching token, creates only a missing token, and remains idempotent across reloads and concurrent initialization.
- Managed token names include a readable OpenTu marker and group display name plus a short request fingerprint used for idempotent replay.
- Rotation replaces only the selected group's managed token at the server contract. Previous managed tokens for that group are deleted with the existing Token soft-delete behavior only after the replacement token is durable, so they disappear from the normal token console while remaining recoverable through existing database operations.
- Responses return the full generated token because the existing OpenTu provider transport still requires it. Logs and error payloads must not echo the token.

### Existing OpenTu settings

- Managed profiles use stable IDs derived from server group IDs and carry a managed marker that distinguishes them from user-created profiles.
- Synchronization upserts only managed profiles and preserves unrelated profiles, catalogs, presets, and user settings.
- Managed profile snapshots are stored in the existing credential-namespaced `aitu-app/config` object store. This adds one record key, not a database or object store.
- The settings manager serializes managed-profile mutations, merges the active account snapshot into runtime `providerProfiles`, and continues to derive the existing image/video runtime records.
- Global standalone/manual settings remain in their existing storage and are never overwritten by managed-group synchronization.
- Standalone mode never calls managed-key endpoints and retains manual API-key behavior.

### Provider transport

- Verified embedded account and managed-key operations continue through the existing DPoP client.
- Tuzi-compatible model generation uses the existing prepared direct-provider request with the selected managed profile key instead of the newer DPoP Relay preference.
- This changes only transport selection; the provider URL, payload, `Authorization: Bearer` behavior, retry rules, request IDs, task polling, and result handling remain on their existing direct code path.
- No CORS, CSP, reverse-proxy, trusted-proxy, or other network-security configuration is changed by this delivery.

### User interface

- The overview renders an unframed access-group section directly below the balance card.
- It displays one row for each returned group and its status, plus one `全部重新生成` command. It never displays or copies the raw key.
- The command confirms once, prevents duplicate clicks while pending, calls the existing per-group rotation contract for every returned group, updates each matching local profile, continues after an individual failure, and reports the aggregate result plus row-level failures.

## Risks / Trade-offs

- Raw keys remain observable in browser storage and request headers. This is an accepted first-stage compatibility limitation; a later Relay migration is required to remove it.
- Selecting direct provider transport supersedes the pending DPoP provider-relay preference for embedded generation; DPoP still protects account and managed-key operations.
- Concurrent page loads could create duplicate tokens. The server must serialize creation or otherwise enforce idempotency by user and managed group marker.
- A replacement could be persisted server-side but fail to reach local storage. The next synchronization recovers the active managed token and repairs the profile.
- Group display names may change. Stable group IDs, not labels, identify profiles and rotation targets.

## Rollback

Disable the managed-key UI and automatic synchronization endpoints. Existing managed profiles remain ordinary compatible provider profiles, existing generation calls continue unchanged, and tokens can be managed through the original Tuzi console.
