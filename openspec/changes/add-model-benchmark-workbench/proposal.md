# Change: Add Model Benchmark Workbench

## Why
- Users have no lightweight way to compare suppliers/models across modalities before spending significant cost; the toolbox and settings page both lack quick, controlled benchmarking.
- We already have runtime model discovery, provider routing, and task adapters, so adding a dedicated benchmark workbench keeps evaluation data separate from production task history while still reusing the invocation plumbing.

## What Changes
- Introduce a “Model Benchmark Workbench” tool in the toolbox that can execute benchmark sessions per modality, reuse provider/model routing, capture timing/cost metrics, and surface quick previews.
- Add a settings-page shortcut on provider/model entries that opens the workbench pre-filled with the selected context so the user can test without copying IDs manually.
- Store benchmark sessions/results in a dedicated datastore, exposing per-entry metadata needed for ranking (status, timings, cost, preview, manual rating) without cluttering the main task queue.

## Impact
- Affected specs: `toolbox`, `settings-dialog`
- Affected code: `packages/drawnix/src/tools`, `packages/drawnix/src/components/settings-dialog`, `packages/drawnix/src/services/tool-window-service`, `packages/drawnix/src/services/benchmark`
