# Design: v2.2 request channel

## Protocol and identity
`ch` is client-reported analytics, not authenticated provenance. Exact page origins map to 1 (`https://opentu.ai`) and 2 (`https://pr.opentu.ai`, HTTP(S) loopback). Validated desktop builds report 3 via the shared build proof before origin mapping. There is no desktop test channel; missing/invalid proofs remain 0. Unknown web origins map to 0. Ordinary and managed keys follow the same request rule. Credential issuance/reuse is unchanged.

## Final request boundary
The shared helper accepts only HTTP(S), no URL credentials, and an exact trusted/currently configured Tuzi API origin. It removes all decoded `ch` keys and appends one current value, preserving other query bytes and the fragment. Fetch wrappers clone a Request only when its URL changes and preserve body, headers and abort behavior.

Shared transport and independent executors apply the helper after normal URL/query preparation. Workflow local proxy decorates the inner target before wrapping and unwraps an already wrapped target to avoid nesting. Model plugin params are serialized once before attribution; raw headers/body and FormData are unchanged. Asset downloads use the undecorated proxy path, preserving signatures. External API origins are unchanged.

## Tuzi persistence and aggregation
After successful auth Tuzi strips ch before routing/upstream construction, keeping the other query/body unchanged. Logs and facts persist INTEGER NOT NULL DEFAULT 0. Async billing snapshot always serializes ch, including zero; subsequent polling/repricing/refund cannot replace it. Refund metadata retains consume-log ID and original submission time so legacy tasks remain excluded even when their original log is absent.

The first new backend persists one shared activation timestamp/log boundary. Only eligible logs use client-channel fact dimension version 5; rebuilding old facts never creates historical ch=0 traffic. Request count is deduplicated by gateway request ID and user, refunds/adjustments add no requests, success rate excludes pending, and active users use distinct identities. Closed natural days aggregate consistently for day/week/month. Persistent pending facts cause submission days older than the normal rolling window to be recalculated after late completion.

## Migration and rollout
Existing large tables require an explicit audited schema command, never startup DDL. Add integer ch/counters/index and remove the abandoned three-string fields. SQLite uses transactional native column removal; MySQL/PostgreSQL are resumable after partial DDL, without a cross-database transaction. Malformed draft columns and unsafe dependent constraints require maintenance review. Stop old writers before creating the activation boundary; deploy Tuzi before OpenTu. Back up both databases. No historical backfill.

## Limits
ch is forgeable. Disabled consumption/error logging yields incomplete analytics. Browser/live provider and real MySQL/PostgreSQL migration acceptance remain required before production rollout.

## OpenTu product scope (2026-10-21)
Tuzi defaults to all OpenTu channels (1/2/3) and offers one enabled desktop option. All summary, channel, model and trend queries exclude unregistered/unattributed traffic. Explicit ch=0 remains a compatibility query. Desktop packaging lives in the separate tuziapi/opentu repository; this web PR supplies the shared renderer contract and does not publish a desktop artifact.
