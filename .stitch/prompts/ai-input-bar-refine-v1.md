# AI Input Bar Refine V1

Refine the current `opentu` workspace screen into a code-faithful desktop AI input bar state based on the existing product UI.

This is a high-fidelity design twin task, not a redesign task.

Keep the current editor shell as background context only. The bottom-centered AI bar is the focus.

## Required Product Context

- This UI lives inside the current whiteboard editor, not a landing page and not a chat app
- Preserve the clean dotted canvas and existing compact left toolbar / top-right navigation context
- Do not add branding cards, top navigation, footer labels, or decorative hero elements

## Required AI Bar Geometry

- Fixed bottom-centered floating island
- Desktop width close to the real component:
  - full-width with side padding
  - max visual width around 720px
- Positioned about 24px above the bottom edge
- White utility surface
- Rounded corners:
  - outer shell about 24px
  - slightly tighter corners in the expanded state
- Light shadow only, subtle and operational
- Dense internal spacing, not airy

## Required Expanded State

Show the bar in its expanded editor state:

1. A preview row above the textarea
2. A multiline textarea area
3. A compact bottom control row

The input should feel open and active, not collapsed into a simple single-line search field.

## Required Inner Structure

Use image-generation mode, not Agent mode, so the compact controls stay visible.

Bottom row order must follow the real component:

1. Small upload icon button
2. Small media library icon button
3. Compact generation-type dropdown with orange icon accent and label `图片`
4. Compact model dropdown in minimal style with monospace model code
5. Compact parameters dropdown trigger with summary text
6. Compact count dropdown trigger with `1个`
7. Flexible empty spacer
8. Circular orange send button on the far right

## Preview Row

Above the textarea, include selected content previews that feel like the real component:

- one or two small thumbnail chips
- compact, around 36px scale
- subtle utility styling, not gallery cards
- may include a tiny remove affordance

## Textarea Styling

- Multiline textarea, visually embedded in the same white island
- No visible inner bordered input box
- Placeholder in Chinese, matching image mode intent:
  - `描述你想要创建的图片`
- Text area should visually occupy most of the width above the control row
- Keep the textarea quiet and utility-focused

## Small Component Styling

The inline widgets are important and must not be omitted or simplified away:

- all compact controls should read as low-height text triggers, not full form fields
- orange is only the accent, not the main fill color of the whole bar
- labels should be compact and mostly gray text with orange icon accents
- controls should have the slightly dense, professional, power-user feel from the current code
- do not replace these widgets with pills, tabs, or large segmented controls

## Avoid

- making the bar look like a generic AI chat composer
- turning the layout into a centered search box
- using dark theme
- using gradients or glossy hero styling
- removing the preview row
- hiding the inline control widgets
- large empty padding inside the bar
- oversized chips or oversized send button
