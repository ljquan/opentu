# Audio Generation Canvas Concept

This prompt now tracks the single canonical audio workspace reference in Stitch:

- `11473c95bcfa46dcb82ee2267c2d84cc`

Design a future `opentu` desktop workspace state for audio generation inside the existing whiteboard product.

This is not a separate music app and not a DAW. It must remain a canvas-first AI workspace.

## Product Context

`opentu` is a whiteboard and AI creation workspace with:

- a large dotted canvas
- compact floating left toolbar
- top-right view and utility controls
- bottom-centered AI input bar
- optional right-side chat drawer for workflow and results

## Main Goal

Show how a new `音频` mode would work inside the current product shell.

The screen should communicate three things at once:

1. bottom bar mode switch extended from `图片 / 视频 / 文本` to include `音频`
2. chat drawer handling for audio generation workflow
3. generated audio returning to the canvas as a first-class object

This canonical version should not add a permanent global mini-player dock. Keep playback anchored in the canvas nodes and lightweight controls inside the right workflow drawer.

## Required Layout

### Background Shell

- preserve the current editor shell
- no website header
- no marketing layout
- no app-store music product styling

### Bottom AI Bar

Show the bottom-centered AI bar in expanded audio mode:

- unified white floating island
- compact preview chips if references are selected
- multiline textarea
- placeholder in Chinese:
  - `描述你想要生成的音乐、情绪、节奏或配器`

Bottom controls should include compact low-height triggers for:

- upload / reference
- media library
- generation type with `音频` active
- model
- style or genre
- duration
- count
- circular primary send button

Keep the same visual grammar as the current image/video bar.

### Chat Drawer

Open a right-side chat drawer showing audio workflow progress.

Inside the drawer:

- a workflow bubble or progress state for music generation
- concise steps such as prompt analysis, model generation, rendering, insert-to-canvas
- a final audio result card with:
  - cover thumbnail
  - title
  - duration
  - play button
  - insert to canvas
  - create variation

### Canvas Output

Place one or two generated audio nodes on the canvas.

An audio node should feel native to the whiteboard:

- small cover image or abstract thumbnail
- title
- waveform strip
- duration
- play affordance
- optional badges like `器乐` or `人声`

The node should look movable, annotatable, and comparable with other canvas objects.

## Visual Tone

- professional desktop productivity software
- calm, intelligent, multimodal creation tool
- no playful music streaming app styling
- restrained color usage
- orange accent may remain in the AI bar to stay compatible with the current design twin

## Avoid

- timeline-first DAW layouts
- full-screen media player UI
- fixed persistent mini-player docks
- neon music app visuals
- oversized cards
- detached modal-only flow
