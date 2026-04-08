# Audio Generation On Canvas

Canonical tracked audio design twin:

- Stitch screen: `11473c95bcfa46dcb82ee2267c2d84cc`
- Local HTML: `.stitch/downloads/audio-generation-canvas/audio-generation-canvas-v5.html`
- Local screenshot: `.stitch/downloads/audio-generation-canvas/audio-generation-canvas-v5.png`

## Goal

Design a future `opentu` interaction for audio-capable generation inside the existing whiteboard workflow.

The product is still a canvas-first workspace. Audio should behave like a first-class canvas asset, not like a detached music app.

## Current Product Constraints

- The bottom-centered AI input bar already supports `图片 / 视频 / 文本`
- Chat and workflow progress live in the chat drawer and workflow bubbles
- Generated media is tracked in task queues and history
- The canvas is the primary context for creation, arrangement, comparison, annotation, and reuse

## Proposed Feature Direction

Add an `音频` generation mode to the bottom AI bar with a music-first default posture.

This is not a full DAW. It is a canvas-native audio creation and arrangement layer.

## Bottom Bar Interaction

### Mode Switch

Extend the existing generation type control from:

- 图片
- 视频
- 文本

to:

- 图片
- 视频
- 音频
- 文本

Use the same compact low-height trigger style as the current AI bar.

### Audio Mode Parameters

When `音频` is active, keep the overall bar shape unchanged, but swap the inner utility controls:

- model trigger
- style / genre trigger
- duration trigger
- count trigger
- optional lyric / vocal toggle

The textarea placeholder should change to something like:

- `描述你想要生成的音乐、情绪、节奏或配器`

### Selected Content Inputs

Audio mode should allow mixed references from the canvas:

- selected images as cover or mood reference
- selected text as lyric or scene brief
- selected videos as mood / pacing reference
- selected audio clips in future iterations as continuation or remix seed

The preview strip should keep using the existing compact thumbnail / text chip system.

## Chat Drawer Handling

The chat drawer should not become a separate audio studio. It should remain the execution and reasoning rail.

### In Chat

For audio workflows, the workflow bubble should show:

- user prompt summary
- model + style + duration summary
- generation progress
- final result card with play affordance

### Audio Result Card In Chat

The final audio card should include:

- cover thumbnail
- track title
- duration
- play / pause
- insert to canvas
- retry variation
- create similar

If the output is a vocal track, also show:

- lyric toggle
- vocal / instrumental badge

## Canvas-Native Result Handling

Generated audio should return to the canvas as an object, not just a downloadable file.

### Audio Node

Introduce a canvas audio block with:

- cover art thumbnail or generated abstract visual
- title
- waveform preview strip
- duration
- play button
- status badge

### Canvas Behaviors

The audio node should support:

- drag and position on canvas
- connect to related notes / images / storyboards
- duplicate for variation comparison
- attach comments or prompt notes
- open inspector for details

### Audio Collections

Multiple generated tracks can be arranged as:

- moodboard playlist
- soundtrack candidates
- scene-level audio groups

This fits the whiteboard workflow better than a linear list.

## Playback Overlay

Do not introduce a permanent bottom music bar or a heavy player panel.

Instead, when the user clicks play on an audio node or audio result card, show a temporary playback overlay anchored at the top center of the canvas.

### Why Top Center

- it avoids competing with the bottom AI bar
- it avoids the right-side workflow rail and utility drawer area
- it can stay globally visible while the user pans or compares objects on the canvas
- it behaves like a lightweight workspace HUD rather than a separate media product

### Overlay Form

The playback overlay should feel inspired by a compact music-player progress bar, but adapted to a whiteboard workflow:

- centered horizontally near the top edge of the canvas
- slim rounded capsule or pill-shaped dock
- translucent or white utility surface with soft shadow
- clearly above the canvas content, but visually lighter than modal UI
- visible only while playback is active

### Overlay Content

The top-center playback overlay should include:

- cover thumbnail or tiny artwork
- track title
- play / pause control
- progress scrubber
- elapsed / total duration
- close or collapse control

The scrubber should be easy to grab with a mouse:

- taller than a hairline progress bar
- clear thumb or handle target
- still compact enough to feel like a desktop utility HUD

Optional secondary details:

- playback source badge such as `画布音频`
- quick jump-back action to focus the currently playing node

### Canvas Interaction Rules

The playback overlay must respect the fact that `opentu` is a canvas product:

- it must not block the left toolbar
- it must not overlap the top-right view controls
- it must not interfere with the bottom AI input bar
- it should not dominate the canvas composition
- when command palette, search, or another high-priority overlay opens, the player should yield by collapsing or temporarily hiding
- dragging, panning, and zooming the canvas should remain the primary interaction

### Relationship To Audio Nodes

- the audio node stays the main source object
- the active node should still show active playback state
- the top-center overlay is a global playback echo, not the main editing surface
- clicking the overlay can return focus to the playing node instead of opening a separate player page

The active node should avoid a harsh bright blue outer border. Prefer:

- soft surface lift
- subtle tonal emphasis
- richer internal waveform progress
- a pause state inside the node itself

## Recommended Interaction Flow

1. User switches bottom bar from `图片` to `音频`
2. User writes a music prompt and optionally references selected canvas items
3. User sends the request
4. Chat drawer shows workflow reasoning and progress
5. When complete, an audio result card appears in chat
6. User inserts one or more generated tracks onto the canvas as audio nodes
7. User compares, annotates, groups, and re-prompts from those nodes

## Why This Fits The Product

- It preserves the canvas as the place where outputs are organized and compared
- It keeps chat as the execution log rather than the main editing environment
- It allows audio to participate in multimodal workflows with image, video, and text
- It avoids turning `opentu` into a separate audio application

## Recommended First Release Scope

- `音频` mode in the bottom AI bar
- music-generation prompt flow
- compact audio result card in chat
- insert-to-canvas audio node
- play / pause / duplicate / retry variation actions

## Later Extensions

- remix from an existing canvas audio node
- lyric-assisted song mode
- soundtrack packs for storyboards
- audio-to-video pairing suggestions
- canvas timeline lane for audio sequencing
