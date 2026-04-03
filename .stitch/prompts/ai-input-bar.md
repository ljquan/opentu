# AI Input Bar

Refine the current `opentu` workspace shell into a high-fidelity bottom-centered AI input bar state based on the existing project code.

This is not a generic search box. It is a floating composition bar inside the editor.

## Match The Existing Product Structure

Keep the clean editor shell in the background.

The AI bar should be the visual focus, but it must still feel embedded in the whiteboard workspace.

## Required AI Bar Structure

Show the bar in an expanded desktop state with:

1. Bottom-centered floating container with rounded corners
2. Left action icons:
   - upload image
   - media library
3. Inline compact controls:
   - generation type dropdown
   - model dropdown
   - parameters dropdown
   - count dropdown
4. Right-side circular orange send button
5. Expanded input area above the bottom control row
6. Multi-line textarea style prompt input
7. Selected content preview chips or thumbnails above the textarea

## Visual And Interaction Character

- White utility surface
- Orange accent as the primary interaction color
- Compact, professional, and slightly dense
- Floating above the canvas
- Feels like a serious creation console, not chat bubble UI
- Keep the shape and spacing close to the real component styling

## Avoid

- turning it into a simple centered search field
- making it look like a messenger chat composer
- dark theme
- large decorative gradients
- removing the small inline control widgets
