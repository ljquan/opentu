# Media Library Modal

Refine the current `opentu` workspace shell into a realistic media-library state based on the existing project code.

This is not a simple image picker. It is a large desktop media management window inside the editor.

## Keep Product Context

- Preserve the editor shell in the background
- This surface should feel like a powerful internal asset manager
- Do not turn it into a generic cloud gallery website

## Required Structure

Create a large desktop media-library window with:

1. Window title: `素材库`
2. Main layout split into:
   - a large media grid area on the left
   - a right-side inspector/details panel
3. In the main area, show:
   - search
   - type filtering for all / images / videos
   - source filtering like local upload / AI generated
   - upload action
   - a visible grid of image and video assets
   - one selected asset state
4. In the inspector panel, show:
   - large preview
   - editable asset name area
   - metadata like type, source, created time, file size
   - prompt section for AI-generated asset
   - actions like use, download, delete

## Visual Direction

- Large desktop utility window
- White background
- Dense but readable control layout
- Professional media-manager feeling
- Subtle orange accents where appropriate
- Rounded panels and restrained shadows

## Avoid

- tiny modal
- masonry inspiration board aesthetic
- consumer photo app look
- replacing the inspector with a generic card
