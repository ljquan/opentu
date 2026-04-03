# opentu Stitch Design Context

## Product Context

`opentu` is a browser-based whiteboard and AI workspace. The product combines:

- a large interactive canvas
- project and board management
- AI generation panels
- media and knowledge workflows
- recovery and safety flows around unstable sessions

The visual direction should feel reliable, intelligent, and calm under complexity. Avoid generic AI product styling and avoid decorative noise that competes with the canvas. The product should read as desktop productivity software, not a lifestyle app and not a wellness product.

## Workflow Rule

Stitch is used for scoped UI surfaces only:

- dialogs
- drawers
- settings panels
- media browsers
- empty states
- onboarding and recovery flows

Do not treat Stitch output as production code. Generated screens are visual references for local React implementation.

## Design Twin Strategy

Stitch should be treated as a design twin for the product shell, not as a loose collection of unrelated screens.

- Start by mirroring the desktop workspace shell and the key surrounding surfaces
- Add new feature concepts by editing an existing mirrored surface whenever possible
- Prefer stateful variants of existing shells over isolated one-off mockups
- Keep core canvas behavior code-led, but mirror the surrounding UI that gives new features their visual and structural context
- Use `.stitch/screens.json` as the canonical mapping between repo surfaces and Stitch screens

## Visual Principles

### Overall Tone

- clean and focused
- professional, not playful
- supportive under failure states
- high information clarity
- operational and utility-oriented

### Layout

- strong visual hierarchy
- clear section grouping
- comfortable spacing
- desktop-first surfaces with responsive fallback

### Color

- neutral base surfaces
- restrained accent color for primary actions
- warning and recovery states should feel safe and controlled, not alarming
- avoid heavy saturation outside status highlights

### Typography

- modern sans-serif
- concise headings
- readable body copy
- compact but not cramped dense settings layouts

### Components

- rounded corners in the `8px` to `14px` range
- soft shadows, not floating-card excess
- strong action emphasis for the primary button
- secondary actions should be visible but quieter
- dialogs should feel like system surfaces inside a desktop app, not isolated mobile cards

## Product-Specific Constraints

- Core editor interactions remain code-led and should not be redesigned in Stitch first
- Panels should look compatible with a whiteboard-first application shell
- Error and recovery surfaces should explain state clearly and guide the next action
- Screens should be implementable as React components without relying on generated HTML
- Recovery dialogs must preserve desktop utility density and should not be reframed as lifestyle or wellness experiences

## Initial Twin Scope

- `workspace-shell`
- `project-drawer`
- `toolbox-drawer`
- `ai-input-bar`
- `chat-drawer`
- `media-library-modal`
- `settings-dialog`
- `command-palette`
- `canvas-search`
- `backup-restore-dialog`
- `crash-recovery-dialog`
- `version-update-prompt`
