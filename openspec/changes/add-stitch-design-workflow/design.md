## Context

`opentu` 当前的前端结构以编辑器能力为中心，`apps/web/src/app/app.tsx` 负责应用初始化、工作区恢复、URL 状态、崩溃恢复、安全模式等应用级装配；`packages/drawnix/src/drawnix.tsx` 承担核心白板编辑器、工具栏、抽屉、AI 面板、媒体库、项目切换等大量交互能力。

这意味着并不是所有 UI 都适合先进入 Stitch：

- 编辑器核心区域高度依赖本地状态与插件链
- 外围页面和面板则更接近典型的“信息架构 + 视觉布局”问题，适合由 Stitch 提供方案探索

如果不先定义边界，Stitch 很容易被误用为“直接产出生产代码”的工具，导致设计稿与业务实现失去可维护性。

## Goals / Non-Goals

- Goals:
  - 为 `opentu` 建立一条可重复使用的 Stitch 设计闭环
  - 让仓库内持久化保存设计系统上下文与 screen 映射
  - 优先提升外围页面、抽屉、弹窗、空状态页的设计探索效率
  - 保持代码实现为交互逻辑与生产行为的唯一真源
- Non-Goals:
  - 本次不让 Stitch 直接接管核心白板编辑器 UI
  - 本次不把 Stitch 生成的 HTML 直接作为生产代码运行
  - 本次不要求一次性覆盖所有前端页面

## Decisions

- Decision: Stitch 只主导“受边界约束的页面与面板”

  - 优先覆盖弹窗、设置面板、项目抽屉、媒体库、空状态页
  - 不直接覆盖核心画布、框选、拖拽、缩放、插件联动区域

- Decision: 仓库内必须保存 Stitch 设计资产的映射关系

  - 通过 `.stitch/screens.json` 记录 `surfaceId -> projectId -> screenId`
  - 通过 `.stitch/DESIGN.md` 沉淀视觉系统、品牌语言与 prompt 约束
  - 避免 Stitch screen 只存在于外部系统、无法被后续开发和维护复用

- Decision: 设计结果进入代码前必须经过“结构转译”

  - Stitch screen 的 HTML 与 screenshot 只作为视觉参考和结构蓝本
  - 最终组件仍按 React + 现有工程模式手工实现
  - 所有状态、事件、服务调用、数据依赖继续留在本地代码

- Decision: 首批只跑通一个最小闭环，再逐步扩展

  - 先选低风险单元，如 `CrashRecoveryDialog`
  - 跑通完整流程后，再扩展到项目抽屉、设置面板、媒体库等

## Proposed Repository Artifacts

```txt
.stitch/
  DESIGN.md
  screens.json
  prompts/
    crash-recovery-dialog.md
    project-drawer.md
    settings-panel.md
  downloads/
    <surface-id>/
      screen.json
      screenshot.png
      design.html
```

### Artifact Roles

- `DESIGN.md`
  - 项目级视觉系统说明
  - 颜色、字体、圆角、阴影、语气、信息密度等约束
  - 作为 Stitch prompt 的上下文来源

- `screens.json`
  - 每个 surface 的唯一映射
  - 示例：

```json
{
  "crash-recovery-dialog": {
    "projectId": "17192920079115887108",
    "screenId": "49b0b7c5283f462d8fafd181b7cbaf5b",
    "entry": "apps/web/src/app/CrashRecoveryDialog.tsx"
  }
}
```

- `prompts/*`
  - 记录每个页面/模块送入 Stitch 的 prompt
  - 保证后续编辑与再生成时上下文可追溯

- `downloads/*`
  - 保存从 MCP 拉回的 HTML / screenshot / metadata 快照
  - 作为编码阶段的参考输入

## Workflow

1. 选择一个受边界约束的页面/模块
2. 在 `.stitch/prompts/` 中整理 prompt，并结合 `.stitch/DESIGN.md`
3. 使用 Stitch 生成或编辑 screen
4. 将 `projectId` / `screenId` 固化到 `.stitch/screens.json`
5. 通过 Stitch MCP 拉取 `get_screen`、设计系统与截图
6. 按仓库规范将结果实现为 React 组件
7. 完成后回写下载快照与必要的设计说明

## Initial Candidate Surfaces

- `apps/web/src/app/CrashRecoveryDialog.tsx`
  - 优势：边界清晰、交互简单、适合先跑闭环
- `packages/drawnix/src/components/project-drawer/*`
  - 优势：信息层级明确，适合 Stitch 做布局与信息架构
- `packages/drawnix/src/components/settings-dialog/*`
  - 优势：表单和分组较多，适合先做视觉系统统一
- `packages/drawnix/src/components/media-library/*`
  - 优势：典型内容浏览 UI，适合做卡片、筛选、空状态设计

## Risks / Trade-offs

- 风险: 团队把 Stitch 结果误当成最终代码
  - Mitigation: 在 spec 中明确“结构参考，不是生产代码”

- 风险: screen 映射与代码实现脱节
  - Mitigation: 每个 surface 必须在 `.stitch/screens.json` 中绑定入口文件

- 风险: 过早接入复杂编辑器区域，增加返工成本
  - Mitigation: 首批只选低风险外围页面

- 风险: 外部 Stitch 项目变动无法追溯
  - Mitigation: 在仓库中保存 prompt、screen 映射和下载快照

## Open Questions

- `.stitch/screens.json` 是否需要加入 `status` 字段，如 `concept / approved / implemented`
- 下载快照是统一提交进仓库，还是仅作为本地辅助资产
- 首批试点是否只选一个页面，还是并行推进多个低风险面板
