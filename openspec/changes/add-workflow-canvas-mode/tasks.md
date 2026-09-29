# Tasks: 工作流画布模式

## 1. Model And Persistence

- [x] 1.1 定义版本化工作流文档、Frame、端口、输出和边类型
- [x] 1.2 通过测试实现输入增长、单输出替换、自连/环路拒绝规则
- [x] 1.3 实现持久化校验、旧原型迁移和失败保护
- [x] 1.4 实现 Board 快照与双模式文档会话

## 2. Canvas Nodes And Connections

- [x] 2.1 实现只创建空白 Frame 的添加节点命令
- [x] 2.2 实现端口重命名、输出选择和节点删除联动
- [x] 2.3 实现连接创建、替换、删除和路径渲染
- [x] 2.4 实现工作流 Plait 插件及键鼠/触控交互

## 3. Mode And Generation Integration

- [x] 3.1 将同一 Drawnix 引擎接入活动文档切换
- [x] 3.2 添加薄工作流工具栏并移除卡片式覆盖层
- [x] 3.3 解析上游输出引用并桥接底部 AI 输入栏
- [x] 3.4 把异步结果路由回来源文档和目标 Frame

## 4. Verification

- [x] 4.1 运行全部工作流定向测试和普通白板回归测试
- [x] 4.2 运行 typecheck、目标 ESLint 和生产构建
- [x] 4.3 使用真实浏览器验证桌面和移动端完整流程
- [x] 4.4 对照需求与验收清单核对 diff，记录剩余风险

## 5. Flexible Source Ports (2026-09-19)

- [x] 5.1 补充输入口发起连线、实际起点路由及非破坏重连测试，先确认失败再实现
- [x] 5.2 持久化可选源端口，兼容旧连线并保持节点移动后的端口锚点
- [x] 5.3 支持输入口拖拽和点击连接，区分键盘激活与鼠标合成点击
- [x] 5.4 验证下游输出引用、桌面/触屏交互、刷新和双模式隔离
- [x] 5.5 完成工作流测试、类型检查和目标静态检查

## 6. Manual Ports And Frame Resize (2026-09-19)

- [x] 6.1 先写失败测试并实现输入口新增、删除和连接保护
- [x] 6.2 在工作流节点层加入可访问的加号/减号控件，并保持端口触控区域稳定
- [x] 6.3 复用现有 Frame resize 插件，验证尺寸、端口、连线和内容持久化
- [x] 6.4 完成新增/删除/缩放的桌面与触屏浏览器回归记录

## 7. Workflow Edge Deletion (2026-09-19)

- [x] 7.1 为连线命中、工具栏删除和 `Delete`/`Backspace` 增加失败回归测试
- [x] 7.2 在工作流连接层提供选中命中路径，保持底层边锁定并避免拖动破坏
- [x] 7.3 删除选中边时只写入边删除操作，保留节点、端口和其它连线
- [x] 7.4 完成工作流测试、类型检查、静态检查和浏览器回归

### Manual Ports And Resize Verification

2026-09-19: `output/playwright/workflow-mode/verify_ports_resize.py` passed in Chromium at 1440x900. It verified input add/remove, protection for the last and connected inputs, four Frame resize handles, source edge endpoint rerouting, and reload restoration of Frame bounds, port metadata, and edge points.

2026-09-19: `output/playwright/workflow-mode/verify_ports_resize_mobile.py` passed in Chromium touch mode at 390x844. It verified responsive add/remove controls near the fixed toolbar, input-to-input touch activation, four resize handles, touch corner resize, and endpoint rerouting. The mobile rule moves the remove control inside the port side when the node is near the viewport edge.

### Flexible Ports Verification

2026-09-19: workflow tests 20 files/108 tests passed; `nx run web:typecheck` and scoped Prettier checks passed. Workflow ESLint reported 0 errors and 15 existing test-code warnings. The test environment still logs the existing IndexedDB, source-map and dependency-metadata warnings. This is focused verification, not a claim that the entire repository test suite is green.

`output/playwright/workflow-mode/verify_flexible_ports.py` passed in isolated Chromium contexts at 1440x900 and 390x844. Verified input-to-input mouse drag, sequential clicks, native Enter/Space activation, occupied-port forwarding, single-output replacement, cycle rejection, touch drag/taps, correct endpoints and refresh/mode-switch persistence. Mobile uses a seeded vertical layout followed by native touch gestures. Both contexts reported zero uncaught page errors. The browser tests exposed and covered two event issues: canvas shortcuts intercepting button activation and implicit touch capture on the port's inner circle. No live image/video generation API requests were made.

## Prior Verification

2026-09-16: workflow tests 20 files/97 tests, normal-board regressions 81/81, queue and long-video focused tests passed; target ESLint reported 0 errors, Prettier/typecheck/build/browser/pixel/diff checks passed. The local `openspec` CLI was unavailable, so strict CLI validation remains an environment limitation rather than an unrun claim.
