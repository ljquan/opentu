# OpenTu Integration

The upstream application stays in `web/`, with its own React runtime and dependencies.
OpenTu renders `host/WorkflowModeHost.tsx` from its existing workflow menu entry.
The normal board stays mounted; the workflow iframe stays mounted after its first open.
Returning to the board hides the iframe rather than navigating or clearing either app.
The host URL is /workflow while open. Direct navigation and refresh reopen the
workflow; browser history toggles its visibility without unmounting it. Returning
restores the previous board URL. Inner workflow routes remain inside the iframe.

## Development

Install the independent frontend dependencies once:

```powershell
pnpm --dir packages/drawnix/src/workflow-mode/web install --ignore-workspace --ignore-scripts
```

Run `pnpm start` from OpenTu. Its prebuild writes the workflow application to
`apps/web/public/workflow-app/`. After editing upstream frontend code, run
`pnpm build:workflow` and reload the host page.

The embedded build uses hash routing so static hosting does not need nested SPA
fallback rules. The normal OpenTu production build copies the generated assets.
Do not build OpenTu directly with Nx without first running `pnpm build:workflow`.

## Data Boundary

Infinite Canvas keeps its own browser persistence. Embedded initialization adds
OpenTu native channels from enabled providers, all their discovered models, selected
models and default routes. Legacy default routes also expose the built-in OpenTu
catalog for their corresponding capabilities. Catalog visibility is not a guarantee
that the configured endpoint or account supports every model.
Existing custom channels, scripts and valid selections are preserved. Missing defaults
are filled, and unchanged upstream defaults use the OpenTu choices. Reopening is idempotent.
Native channels contain profile IDs, not API keys. The host validates the exact iframe,
origin and current model catalog, then invokes OpenTu adapters with current credentials.
Results return only to workflow storage; no normal-board generation tasks are created.
Legacy imported channels and their locally stored keys are left untouched.
Custom scripts retain precedence. Unbound adapters fail explicitly, never fall back to
another provider. Native channels require the OpenTu host, not standalone mode.
Video/audio reference inputs are not yet bridged. Text returns once, not streaming.
Video generation follows the existing synchronous plugin-result path; pending tasks
do not resume after a page reload. Completed assets retain normal local persistence.
Cancellation stops client waiting and forwards an AbortSignal; some existing adapters
do not cancel provider polling, and cancellation does not guarantee billing cancellation.
Only the first audio clip is stored by the existing single-audio workflow interface.
Old workflow nodes, tasks and assets are not migrated. Standalone mode does not import.
The old implementation is archived outside this repository.

## Upstream

Source: https://github.com/basketikun/infinite-canvas
Snapshot: e856c87 (v0.19.0). Keep LICENSE and upstream attribution.
