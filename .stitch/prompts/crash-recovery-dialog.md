# Crash Recovery Dialog

Design a desktop-first recovery dialog for `opentu`, an AI whiteboard application.

The dialog appears when the app detects repeated abnormal exits during startup. The design should feel trustworthy, calm, and highly actionable. This is not a destructive error dialog. It should help the user recover safely and continue work.

## Product Context

- The app is a whiteboard and AI workspace with a complex canvas-based UI
- This dialog is shown before the main editing flow fully recovers
- Users may be dealing with memory pressure, a heavy board, or unstable browser state

## Design Direction

- Calm, professional, supportive
- Clean layered surfaces with subtle depth
- Strong visual hierarchy
- Desktop-first modal with responsive behavior for narrower widths
- Avoid loud "danger" styling; use warning tone with controlled emphasis

## Content Structure

1. Warning icon or status illustration
2. Clear title explaining that repeated abnormal exits were detected
3. Short explanatory body copy
4. Optional memory usage card
5. Two actions:
   - Secondary: continue loading
   - Primary: enter safe mode

## Required UI Details

- Centered modal over a dimmed backdrop
- Comfortable width around `440px` to `520px`
- Rounded corners and soft shadow
- Separate the memory section visually from the explanatory copy
- Show a compact progress bar for memory usage when memory data exists
- Primary action should be visually prominent but not aggressive
- Secondary action should remain easy to scan and click

## UX Requirements

- The safe-mode action must feel recommended
- The continue-loading action must still feel available
- The dialog should reduce anxiety and make the next step obvious
- Wording and spacing should support quick scanning under stress

## Implementation Constraints

- This screen will be reimplemented locally in React
- Use the screen as a visual reference, not as final runtime HTML
- Keep the structure straightforward to translate into component code
