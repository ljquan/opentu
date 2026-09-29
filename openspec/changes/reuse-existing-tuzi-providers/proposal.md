# Reuse existing Tuzi provider credentials

## Why
Account association currently creates managed credentials even when local providers already use tokens owned by the signed-in Tuzi account.

## What Changes
Verify current-site provider key fingerprints through an authenticated, read-only API. Preserve each verified provider, including its ID, name, key, model catalog and restrictions. Reuse usable providers before creating missing groups; do not rotate ordinary tokens through managed-token controls. Reject stale account results and show individual failures.

## Impact
OpenTu provider routing, account setup/synchronization and UI; Tuzi API read-only verification endpoint and parent bridge. No database migrations or changes to existing token limits.

## Approval
User confirmed the proposed verification-first reuse design on 2026-09-28 before implementation.
