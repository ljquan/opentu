# Audio Generation Canvas Refine V2: Better Scrubbing And Softer Active State

Refine the current `opentu` audio workspace playback state.

- Base screen: `33b8482865e3496386a7eba8f9d27489`

Keep the overall composition and shell. This is a targeted refinement.

## Main Fixes

### 1. Make The Top Playback Progress Bar Easier To Drag

The current progress control feels visually too small for comfortable scrubbing.

Improve the top-center playback overlay so the scrubber feels more usable:

- make the progress track visibly taller
- give the thumb / handle a clearer touch and mouse target
- preserve a clean desktop utility look
- avoid looking like a giant mobile slider
- keep the overlay compact, but make the progress interaction obviously draggable

Preferred feel:

- slim but not tiny
- enough height for confident pointer interaction
- easy to grab without precision frustration

### 2. Remove The Harsh Blue Border On The Active Canvas Audio Node

The currently playing node should still feel active, but not by using a bright hard blue outer border.

Replace the active state with a softer and more tasteful treatment:

- subtle surface lift or soft glow
- gentle tonal emphasis
- slightly richer shadow or background tint
- stronger waveform progress
- pause state inside the node

The node should still read as the playing source, but feel elegant and integrated with the whiteboard surface.

## Keep

- top-center playback overlay
- dotted whiteboard canvas
- compact left toolbar
- top-right utility cluster
- right workflow drawer
- bottom-centered AI input bar in audio mode
- one active node and one secondary comparison node

## Avoid

- tiny scrubber hit area
- neon or saturated active glow
- strong blue rectangular border around the playing node
- consumer streaming app styling
- redesigning the whole workspace
