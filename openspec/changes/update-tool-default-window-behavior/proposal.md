# Change: update tool default window behavior

## Why
当前工具自动常驻依赖调用入口显式传入 `autoPin`，规则分散在各处，容易遗漏。爆款视频生成与爆款音乐生成希望打开后自动常驻工具栏，但该行为需要可配置，而不是继续硬编码在单个入口里。

## What Changes
- 为 `ToolDefinition` 增加默认窗口行为配置，支持声明 `defaultWindowBehavior.autoPinOnOpen`
- 让 `tool-window-service` 在未显式传入 `autoPin` 时回退读取工具定义的默认窗口行为
- 为 `video-analyzer` 与 `music-analyzer` 工具声明默认打开即常驻
- 保持用户手动常驻/取消常驻优先，不改变已有手动 pin 语义

## Impact
- Affected specs: `toolbox-plugin-runtime`, `toolbox`
- Affected code:
  - `packages/drawnix/src/types/toolbox.types.ts`
  - `packages/drawnix/src/services/tool-window-service.ts`
  - `packages/drawnix/src/tools/tools/video-analyzer/index.tsx`
  - `packages/drawnix/src/tools/tools/music-analyzer/index.tsx`
