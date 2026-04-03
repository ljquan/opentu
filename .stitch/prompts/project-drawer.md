# Project Drawer

Refine the current `opentu` workspace shell into a realistic project-management state with the left project drawer open.

Follow the existing project code structure rather than inventing a new sidebar pattern.

## Keep The Workspace Shell

- Preserve the current editor shell layout
- Keep the large open whiteboard canvas visible on the right
- Keep the bottom-centered AI input bar
- Keep the top-right zoom and minimap controls

## Open The Left Project Drawer

The drawer should feel like a real productivity drawer anchored to the left side of the editor.

## Required Drawer Structure

1. Top tab switcher with three tabs:
   - `画板`
   - `Frames`
   - `Layers`
2. In the `画板` tab, show:
   - a search field
   - two compact action buttons for creating a board and folder
3. Main content is a hierarchical tree:
   - folders
   - nested folders
   - boards
   - one active board state
4. Include row affordances that imply:
   - expand and collapse
   - current selection
   - hover actions or more menu
5. Keep the visual tone compact, professional, and utility-first

## Match The Existing Product

- This is not a generic file explorer app
- It belongs inside a whiteboard editor
- The drawer should look denser and more operational than a marketing sidebar
- The right-side canvas should still dominate the composition overall

## Avoid

- full-height website navigation styling
- oversized folder cards
- consumer cloud-drive aesthetics
- replacing the whiteboard canvas with a list-heavy dashboard
