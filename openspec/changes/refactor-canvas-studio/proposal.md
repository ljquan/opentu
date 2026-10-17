# Change: Refine the FoxVue infinite canvas workspace

## Why

The current canvas engine is capable, but the first view presents too many
surfaces at once: the example scene, prompt card, result strip, inspector,
task area, and AI dock compete for attention. The canvas should be the primary
working surface, with creation controls appearing when they are needed.

GitHub research confirms that the project already uses a strong, MIT-licensed
foundation: Drawnix on top of Plait. Excalidraw is mature and MIT-licensed but
its hand-drawn visual language does not match FoxVue's studio direction. tldraw
has excellent interaction design but its repository uses a commercial license
model. Penpot is a full design platform with a much larger server and product
surface. Replacing the existing engine would create a large migration without
improving the parts users currently struggle with.

## What Changes

- Keep the existing Drawnix/Plait renderer, serialized board format, local
  persistence, generation task bridge, and media integrations.
- Make the infinite canvas the first visual priority with a calm, empty-ready
  state and a compact canvas toolbar.
- Show the inspector and task panels contextually, with explicit collapsed and
  focus modes that persist per device.
- Rework the default C1 scene projection so it can be used as a starter layout
  without making every new board look pre-populated.
- Keep AI generation available from one creation dock and preserve existing
  model, ratio, resolution, reference image, and task controls.
- Improve mobile canvas ergonomics, keyboard shortcuts, zoom feedback, and
  accessibility labels.

## Impact

- Affected specs: infinite canvas workspace, workspace navigation, local-first
  persistence, AI generation entry points.
- Affected code: `apps/web/src/workspace/presentation/`,
  `apps/web/src/workspace/infrastructure/`, and focused Drawnix workspace
  adapters.
- Compatibility: existing boards and cached media remain readable; no provider
  or account API changes are required.
- Non-goals: replacing the Plait renderer, adding multiplayer collaboration,
  or introducing a second canvas application.
