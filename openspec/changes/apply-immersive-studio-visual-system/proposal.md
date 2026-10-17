# Change: Apply the FoxVue immersive studio visual system

## Why

FoxVue's user-facing pages currently mix several unrelated visual systems. The
selected direction is the approved C "Immersive Studio" concept, with the C1
"Focused Creation" canvas as the workspace reference.

## What Changes

- Apply a shared charcoal, coral, violet, and teal visual system to the public
  product pages.
- Align navigation, typography, controls, media presentation, focus states,
  and responsive behavior across the main user journey.
- Restyle the existing workspace shell around the C1 layout while preserving
  board persistence, generation commands, tasks, and Drawnix behavior.
- Keep real product data and existing routes; this change does not introduce
  mock generation or replace application logic.

## Impact

- Affected specs: product visual system, workspace presentation
- Affected code: web page styles, account surface, workspace shell styles
- Compatibility: no API, storage, URL, or data model changes
