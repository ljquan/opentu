# Change: Generate in place from canvas drafts

## Why
A completed generation currently leaves its input draft beside a separate progress card and result. The user approved option B on 2026-11-16: draft → progress → result at the same location.

## What Changes
- Consume the draft into the existing image anchor or video WorkZone when submission is ready.
- Save the original draft with the progress element and result; failed/cancelled generation can restore an editable draft.
- Transfer reference connections to the task and then the output; expand additional image slots without overlap.
- Keep generation requests outside canvas undo/redo. Undo restores canvas objects, never sends another request.

## Impact
- Canvas submission, progress cards, clipboard, history, result insertion, embedded media backups.
- Optional canvas-only versioned metadata; no backend schema migration.
- Supersedes the persistent-draft-after-submission behavior in add-canvas-reroll-and-reference-connections.
