# AI Input Bar Refine V2

Refine the preferred `workspace-shell` into a high-fidelity `opentu` homepage state where the bottom-centered AI input bar is expanded and code-faithful.

This must remain a full desktop editor screenshot. Do not crop into a component board or isolate the control in the top-left corner.

## Shell Constraints

- Keep the full whiteboard editor shell visible
- Preserve the clean dotted canvas background
- Preserve the compact left floating toolbar
- Preserve the top-right view/navigation cluster
- No branding cards, no marketing layout, no component-sheet framing

## Core Requirement

The AI input bar must remain a single integrated floating island near the bottom center of the page.

Do not split it into detached boxes or loose controls.

Everything below must live inside one unified white rounded container:

1. preview row
2. textarea region
3. bottom control row

## Exact Bar Character

- fixed bottom-centered position
- around 24px above the bottom edge
- visual max width around 720px
- white surface with very subtle shadow
- rounded outer shell around 24px
- dense, compact, professional spacing
- utility-first whiteboard tool feel

## Exact Expanded State

Use image-generation mode and show these visible elements:

- one or two compact preview chips above the textarea
- multiline textarea with Chinese placeholder `描述你想要创建的图片`
- compact bottom row with this order:
  - upload icon button
  - media library icon button
  - generation type trigger with orange accent and label `图片`
  - compact model trigger with monospace code feel
  - compact parameters trigger
  - compact count trigger with `1个`
  - flexible spacer
  - circular orange send button

## Small Widgets

- all inline controls should look like low-height text triggers
- not full form fields
- not segmented tabs
- not large chips
- mostly gray text with orange accent icons

## Avoid

- isolated component-sheet composition
- detached controls outside the main container
- chat bubble appearance
- search-box appearance
- oversized padding
- dark mode
- glossy gradients
