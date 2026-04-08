# Audio Generation Canvas Refine: Top-Center Playback Overlay

Refine the current canonical `opentu` audio workspace screen:

- Base screen: `11473c95bcfa46dcb82ee2267c2d84cc`

Keep the full page structure and shell. This is an edit, not a redesign.

## Overall Intent

The screen should show what happens after the user clicks play on an audio item.

We want a playback UI inspired by a music-player progress bar, but adapted for a whiteboard canvas product.

## DESIGN SYSTEM (REQUIRED)

- Platform: Web, desktop-first
- Palette: Neutral canvas surfaces, restrained blue system accent, warm orange accent only where the current AI bar already uses it
- Styles: Rounded 8px to 14px controls, soft utility shadows, calm productivity atmosphere

## PAGE STRUCTURE

1. **Workspace Shell:** Keep the dotted whiteboard canvas, compact floating left toolbar, top-right zoom/save controls, right workflow drawer, and bottom-centered AI input island.
2. **Audio Nodes:** Keep one or two audio nodes on the canvas. One node should be the currently playing source and should show a clearer active state.
3. **Top-Center Playback Overlay:** Add a temporary playback overlay centered near the top of the canvas.
4. **Workflow Drawer:** Keep the right drawer as the execution rail and result-action area, not as the main player.

## Top-Center Playback Overlay

Add a floating playback capsule at the top center of the canvas.

Requirements:

- centered horizontally near the top edge of the canvas
- not full width
- visually lighter than a modal or drawer
- white or translucent utility surface
- rounded pill or capsule shape
- contains:
  - small artwork thumbnail
  - track title
  - play / pause button
  - slim progress bar
  - elapsed / total duration
  - close or collapse icon

The visual idea can borrow from a bottom music-player progress bar, but this must be adapted into a compact workspace HUD.

## Canvas Product Constraints

This is still a whiteboard product, not a media app.

So the overlay must:

- not overlap the left toolbar
- not collide with the top-right view controls
- not compete with the bottom AI bar
- not cover the center working area too heavily
- feel temporary and utility-like
- stay secondary to the active canvas audio node

## Active Playback State

Strengthen the currently playing audio node with:

- clearer playing state
- waveform progress or highlighted waveform
- active emphasis that still feels like a movable canvas object

## Avoid

- bottom fixed full-width music player
- persistent global dock
- DAW timeline UI
- consumer music streaming app styling
- turning the right drawer into the main player
- adding a top navigation bar or dashboard feel
