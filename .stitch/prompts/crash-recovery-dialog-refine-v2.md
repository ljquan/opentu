# Crash Recovery Dialog Refinement V2

Refine the current `opentu` crash recovery screen into a true desktop utility modal.

This is not a mobile card and not a full-page composition. It is a recovery dialog inside a desktop whiteboard productivity app.

## Keep This Exact Product Structure

1. Top warning icon area
2. Title: 检测到页面异常退出
3. Explanatory body text about repeated load failures
4. Optional memory usage card titled 当前内存使用情况
5. Bottom action row with:
   - Secondary: 继续加载
   - Primary: 安全模式
6. Small footer hint about `?safe=1`

## Product Meaning To Preserve

- The app failed to load repeatedly
- Possible reasons include too many canvas elements and browser memory limits
- Safe mode is the recommended action
- The user can later switch boards from the sidebar

## Hard Layout Constraints

- Desktop modal only
- Centered over dimmed backdrop
- Modal width between 480px and 560px
- Modal should visually dominate the center area enough to feel like a real desktop dialog
- Use a compact but breathable vertical rhythm
- Keep the memory card between body copy and actions
- Keep both actions in a single bottom row

## Visual Direction

- Calm, trustworthy, operational
- Desktop productivity software, not a lifestyle app
- Whiteboard-tool shell compatibility
- Soft warning tone
- Neutral surfaces with restrained accent color
- Rounded corners and soft shadow
- Clear hierarchy and stronger information grouping than the current version

## Avoid

- mobile card proportions
- excessive empty gray canvas around a tiny card
- wellness / meditation / self-care visual language
- reframing this into a generic recovery page
- changing the main content structure
