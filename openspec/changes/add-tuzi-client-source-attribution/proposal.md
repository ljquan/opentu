# OpenTu per-request client channel analytics

## Why
Tuzi needs analytics for each request's OpenTu runtime, including ordinary imported keys. Credential issuance metadata cannot represent that runtime when keys are reused.

## What Changes
- Add a single query `ch`: production web 1, test/localhost web 2, otherwise 0; desktop IDs remain reserved.
- Attribute only exact trusted/configured Tuzi API origins at the final request boundary, including shared transport, independent media/text, plugins and local proxies.
- Preserve credentials, headers, model bodies, other query bytes, abort behavior and signed asset downloads.
- Tuzi captures/removes ch after authentication and freezes it in async billing snapshots; analytics exclude pre-activation history permanently.
- Remove the abandoned three-string credential design without dual writes or fallback.

## Impact
OpenTu API transports and workflow API requests; Tuzi middleware, logs, billing snapshots, controlled database migration, daily facts and business analysis UI/API. No change to credential reuse, permissions or pricing.

## Approval
The user explicitly approved implementing the latest v2.2 request-parameter design after synchronizing remote dev. The user subsequently authorized deployment and real-provider testing on the specified LAN test platform, then submission of both PRs. Production deployment and merging remain outside the authorized scope.
