## ADDED Requirements

### Requirement: Per-request OpenTu channel
The client SHALL report one query `ch` for exact trusted or currently configured Tuzi API origins, using 1 for production web, 2 for test/loopback web, 3 for validated desktop releases, and 0 otherwise. There SHALL be no desktop testing channel. Credential issuance, reuse and pricing SHALL remain unchanged.

#### Scenario: Ordinary key from production web
- **WHEN** a page at `https://opentu.ai` calls a trusted Tuzi model API with an ordinary imported key
- **THEN** the final URL has a single ch=1 and the original key, headers and model body are retained.

#### Scenario: Desktop release
- **WHEN** the desktop build flag is true and its validated build proof is exactly opentu-desktop-client-channel:3
- **THEN** eligible Tuzi requests report one ch=3 regardless of the window origin; invalid, missing or former testing proofs report 0.

#### Scenario: Local proxy and duplicate channel
- **WHEN** a loopback page sends a Request through the workflow local proxy with multiple encoded or plain ch keys
- **THEN** the inner trusted target has exactly one ch=2, is proxied once, and its payload and abort behavior are preserved.

#### Scenario: Plugin and signed asset boundaries
- **WHEN** a plugin serializes query params or a signed asset is downloaded
- **THEN** trusted model API params are serialized before ch replacement, while asset URLs and third-party endpoints retain their original query semantics and bytes.

### Requirement: Frozen attribution and historical exclusion
Tuzi SHALL capture and strip ch after authentication before model routing, persist explicit zero in async submission snapshots, and exclude pre-activation history permanently. Refunds and repricing SHALL retain the original channel and SHALL NOT add request counts.

#### Scenario: Late legacy refund
- **WHEN** a task submitted before activation refunds after activation or facts are rebuilt
- **THEN** its original log boundary or submission timestamp excludes it from all new channel statistics.

#### Scenario: Completion outside the rolling window
- **WHEN** an attributed pending task completes beyond the normal rolling rebuild window
- **THEN** persistent pending facts cause its submission day to be recalculated without increasing the request count.
