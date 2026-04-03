## 1. Workflow Definition

- [ ] 1.1 定义 `opentu` 中哪些 UI 适合走 Stitch，哪些 UI 必须继续以代码驱动为主
- [ ] 1.2 定义从 prompt 到 Stitch screen，再到 MCP 拉取与编码实现的标准闭环
- [ ] 1.3 明确设计稿、screen 映射、代码实现之间的责任边界

## 2. Repository Artifacts

- [ ] 2.1 建立 `.stitch/` 目录结构与命名约定
- [ ] 2.2 定义 screen 映射文件格式，用于记录 `repo surface -> projectId -> screenId`
- [ ] 2.3 定义 `.stitch/DESIGN.md` 的职责，用于沉淀项目视觉系统与 prompt 上下文

## 3. Initial Rollout Surfaces

- [ ] 3.1 选择首批 3 到 5 个低风险页面/模块作为 Stitch 试点
- [ ] 3.2 为每个试点页面记录目标、边界、依赖状态与实现入口文件
- [ ] 3.3 明确每个试点页面的 Stitch prompt 与回收编码策略

## 4. Design Retrieval And Implementation Rules

- [ ] 4.1 约定如何从 Stitch MCP 拉取 `screen`, `htmlCode`, `screenshot`, `designSystem`
- [ ] 4.2 约定如何将 Stitch 结果转译为 React 组件，而不是直接嵌入原始 HTML
- [ ] 4.3 约定如何在实现完成后回写或更新 screen 映射与设计文档

## 5. Verification

- [ ] 5.1 用一个真实页面跑通完整闭环：需求 -> Stitch 设计 -> MCP 拉取 -> 本地实现
- [ ] 5.2 验证 `.stitch` 资产、screen 映射与实现组件之间可追踪
- [ ] 5.3 验证试点流程不会干扰核心编辑器功能开发
