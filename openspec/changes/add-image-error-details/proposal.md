# Change: Add actionable image failure details

## Why
Image failure cards mix the provider request ID into error text and omit provider error codes, models and remote task IDs. Internal rendering fields occupy the limited detail space.

## What Changes
- Preserve provider request ID, error code, HTTP status, actual model and optional remote task ID through image errors and task persistence.
- Show model, formatted error, Request ID and optional API task ID. Use one copy-all button for all visible detail fields with icon-only success feedback.
- Show local task, workflow, shape and transition directly with the provider details; all rows remain visible without a secondary disclosure.
- Prefer an explicit provider-message Request ID over gateway IDs, including historical records; never invent provider IDs.
- Keep canvas selection and hit bounds aligned with the card’s rendered dimensions.

## Impact
Image adapters, image execution/storage, shared error utilities and the canvas image failure card. No image API requests are issued for verification; use mocked responses.

## Authorization
The user approved the field/layout proposal and the collapsed technical-details refinement in this chat on 2026-11-04.

## Develop integration
The user authorized integrating these improvements into develop on 2026-11-04. Base: f6a3e0cf (1.2.5), verified against the GitHub commits API. Reuse the existing copy-button styling and include local task/workflow IDs in the combined detail report via the shared copy component. Preserve the bounded provider response reader, submission-attempt guards, image recovery and actual image dimensions. Develop already provides the model-discovery proxy, so the old main-only proxy patch is not carried forward.
