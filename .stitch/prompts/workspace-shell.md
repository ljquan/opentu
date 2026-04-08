# Workspace Shell

Design a desktop-first workspace shell for `opentu`, a browser-based whiteboard and AI workspace.

This is the master shell that future drawers, dialogs, search overlays, and new features should grow from. It should feel like serious desktop productivity software, not a generic SaaS dashboard.

## Product Intent

- Large central whiteboard canvas is the primary surface
- The shell supports project management, AI generation, media workflows, and utility overlays
- The UI should feel calm, operational, and reliable under heavy use
- The shell should leave visual breathing room for the canvas without feeling empty

## Required Layout

1. A large open canvas in the center as the dominant area
2. A fixed vertical toolbar on the left edge
3. A floating AI input bar at the bottom center of the canvas
4. A compact view navigation cluster near the lower right or right edge, suitable for zoom and minimap controls
5. A small version update hint near the top right
6. Space reserved for optional left drawers, right drawers, command palette overlays, and utility dialogs

## Left Toolbar Character

- Vertical desktop toolbar
- Compact, tool-heavy, and utility-oriented
- Includes app controls, undo and redo, creation tools, and entry points for drawers and task panels
- Should feel like a professional whiteboard editor, not a mobile floating menu

## AI Input Bar Character

- Floating horizontal composition bar
- Bottom-centered
- Visually important but not overpowering
- Designed for prompt entry, model selection, asset attachment, and send actions
- Should look integrated with the workspace shell rather than pasted on top

## Visual Direction

- Desktop productivity software
- Neutral, bright workspace surfaces
- Clear hierarchy
- Soft shadows
- Rounded corners in moderation
- Restrained accent colors
- Whiteboard-tool compatibility
- Avoid lifestyle, wellness, or marketing-page aesthetics

## Avoid

- dashboard cards replacing the canvas
- mobile layout patterns
- full-page marketing hero composition
- oversized decorative gradients
- dark-theme bias
- isolated floating cards with no relationship to the whiteboard shell

## Output Goal

Generate the base workspace shell only.

Do not focus on one dialog or one drawer.
Show the host environment those surfaces will live in.
