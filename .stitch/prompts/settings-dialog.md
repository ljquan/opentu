# Settings Dialog

Refine the current `opentu` workspace shell into a realistic settings state that matches the existing project structure.

This is not a generic form modal. It is a desktop settings workspace inside the whiteboard product.

## Keep The Workspace Context

- Preserve the editor shell feeling in the background
- The settings surface can dominate the center, but it should still feel like it belongs inside the product
- Do not turn this into a marketing page or browser preferences screen

## Required Structure

Create a large desktop settings dialog or settings workspace with these sections:

1. Left primary navigation with:
   - `供应商`
   - `模型预设`
   - `画布显示`
2. Main settings area with a two-pane workspace feel:
   - a list or catalog area on the left/middle
   - a detail form area on the right
3. In the `供应商` state, show:
   - a provider list with multiple providers
   - one active provider
   - enable/disable affordance
   - model counts or summary meta
   - a detail form with fields like name, base URL, API key, auth type, and model sections

## Visual Direction

- White desktop settings workspace
- Orange accent for active states and primary actions
- Clean, dense, professional configuration UI
- Rounded panels, restrained borders, and subtle hierarchy
- Feels like a tool for power users, not a consumer settings page

## Avoid

- small centered modal with cramped fields
- generic single-column form page
- dashboard cards replacing settings content
- dark theme
