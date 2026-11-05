# Change: Structured failure details for video, text and agent cards

## Why
Workflow cards currently flatten errors into a string and cannot reliably expose provider request IDs, model names or remote task IDs.

## What Changes
- Display Request ID, error (with available HTTP/provider codes), model and optional remote task ID in the existing failure region.
- Reuse image diagnostic extraction and copy behavior; omit duplicate request-ID suffixes from displayed errors only.
- Preserve metadata through provider errors, task storage and workflow steps; bind diagnostics to the failed step.
- Measure expanded cards so selection/hit bounds enclose all content at any zoom.

## Authorization
The user approved this proposal on 2026-11-04 and specifically requires stable styling and layout. No generation requests will be sent for verification.
