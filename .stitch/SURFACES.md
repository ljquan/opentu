# opentu Stitch Surface Inventory

This file defines the first design-twin scope for `opentu`.

The goal is not to redraw every interaction in Stitch. The goal is to mirror the desktop product shell and the surrounding UI surfaces that give future feature design enough context to stay visually and structurally consistent.

## Mirror Rules

- Mirror shells and surfaces before inventing new feature screens
- Prefer editing an existing mirrored surface over generating isolated mockups
- Keep canvas mechanics code-led, but mirror the surrounding workspace, drawers, dialogs, and utility overlays
- Treat Stitch outputs as design references for React implementation, not production HTML

## Tier 1: Product Shell

These surfaces establish the visual grammar for almost everything that follows.

| Surface | Priority | Entry | Why it matters | Stitch mode |
| --- | --- | --- | --- | --- |
| `workspace-shell` | `P0` | `apps/web/src/app/app.tsx`, `packages/drawnix/src/drawnix.tsx` | Defines the main desktop composition: canvas area, overlay layering, global toolbar zones, drawers, and floating utilities | `generate` |
| `ai-input-bar` | `P0` | `packages/drawnix/src/components/ai-input-bar` | Grounds future AI features in the real bottom input surface instead of generic assistant cards | `generate` |
| `view-navigation` | `P1` | `packages/drawnix/src/components/view-navigation` | Sets the visual language for compact navigational overlays and canvas-adjacent controls | `generate` |

## Tier 2: Drawers And Panels

These are the highest-value surfaces for future feature work because new capabilities will usually land inside one of them.

| Surface | Priority | Entry | Why it matters | Stitch mode |
| --- | --- | --- | --- | --- |
| `project-drawer` | `P0` | `packages/drawnix/src/components/project-drawer` | Establishes the board and project management surface that many new creation and organization flows will extend | `generate` |
| `toolbox-drawer` | `P0` | `packages/drawnix/src/components/toolbox-drawer` | Captures the expandable utility surface for tools, knowledge flows, and future side-panel additions | `generate` |
| `chat-drawer` | `P1` | `packages/drawnix/src/components/chat-drawer` | Provides the conversational side-panel baseline for AI-assisted workflows | `generate` |
| `media-library-modal` | `P0` | `packages/drawnix/src/components/media-library` | Gives future media, assets, and generated content a real management surface instead of standalone gallery pages | `generate` |
| `settings-dialog` | `P0` | `packages/drawnix/src/components/settings-dialog` | Anchors the system configuration language for future settings and preference surfaces | `generate` |
| `sync-settings` | `P1` | `packages/drawnix/src/components/sync-settings` | Important for cloud sync and account-linked states that may influence future collaboration features | `generate` |

## Tier 3: Utility Overlays

These are smaller but strategically important because they define how dense utility UI should feel in the product shell.

| Surface | Priority | Entry | Why it matters | Stitch mode |
| --- | --- | --- | --- | --- |
| `command-palette` | `P0` | `packages/drawnix/src/components/command-palette` | Sets the tone for searchable command surfaces and power-user flows | `generate` |
| `canvas-search` | `P1` | `packages/drawnix/src/components/canvas-search` | Defines compact search behavior in the context of the whiteboard workspace | `generate` |
| `performance-panel` | `P2` | `packages/drawnix/src/components/performance-panel` | Helps define dense operational diagnostics without drifting into generic analytics UI | `generate` |

## Tier 4: Dialogs And State Surfaces

These provide the product's system-level language for interruptions, safety, recovery, and maintenance flows.

| Surface | Priority | Entry | Why it matters | Stitch mode |
| --- | --- | --- | --- | --- |
| `crash-recovery-dialog` | `P0` | `apps/web/src/app/CrashRecoveryDialog.tsx` | Already the first pilot. Defines recovery, warning, and recommended-action patterns | `edit` |
| `backup-restore-dialog` | `P1` | `packages/drawnix/src/components/backup-restore` | Important for trust-sensitive data recovery and workspace continuity flows | `generate` |
| `version-update-prompt` | `P1` | `packages/drawnix/src/components/version-update` | Defines how upgrade notices and product messaging should appear without feeling promotional | `generate` |
| `clean-confirm` | `P2` | `packages/drawnix/src/components/clean-confirm` | Establishes destructive confirmation language and button hierarchy for risky actions | `generate` |

## Recommended Build Order

1. `workspace-shell`
2. `project-drawer`
3. `toolbox-drawer`
4. `media-library-modal`
5. `settings-dialog`
6. `ai-input-bar`
7. `command-palette`
8. `chat-drawer`
9. `crash-recovery-dialog`
10. `backup-restore-dialog`
11. `version-update-prompt`
12. `canvas-search`

## How New Feature Design Should Work

When a new feature is requested:

1. Identify which mirrored surface it belongs to
2. Start from that surface's Stitch screen instead of a blank prompt
3. Describe only the delta:
   - what changes in hierarchy
   - what new controls appear
   - what new state is introduced
   - what existing surface patterns must be preserved
4. Pull the updated design back into local React code

If a feature does not fit any mirrored surface, that is a signal that we may be missing a shell or panel in the design twin.
