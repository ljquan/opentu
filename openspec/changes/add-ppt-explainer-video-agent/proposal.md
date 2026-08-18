# Change: 增加 PPT 讲解视频 Agent

## Why

OpenTu 已有 PPT 大纲、页面整图、演讲备注、视频任务、供应商路由、素材库和画布插入能力，但这些能力彼此独立，用户无法从主题、当前 PPT 或 PPTX 一次完成讲稿、单/双人讲解和最终成片。

公开兔子源码目前只提供通用媒体任务，没有可安全硬编码的 PPT 讲解成片端点。因此本变更增加两种明确执行模式：优先使用声明 `ppt-explainer` 能力的远端最终成片服务；没有专用服务时，OpenTu 使用现有文本、图片和有声视频模型取得逐页讲解音轨，再以原 PPT 页面作为固定画面本地合成为最终成片。

## What Changes

- 新增内置 Agent Skill 与 MCP 工具 `generate_ppt_explainer_video`
- 支持从主题生成、当前画布 PPT、上传 PPTX 三种来源创建任务
- 支持确认大纲，以及用户确认警告后跳过大纲确认
- 支持单声线、双声线对谈、单数字人、双数字人四种讲解模式
- 新增可恢复的 PPT 讲解根任务状态机，复用标准 `VIDEO` 任务、IndexedDB 与原供应商路由快照
- 新增 `ppt-explainer` 供应商能力绑定，规范 submit、poll、可选 cancel、幂等键和最终视频 URL
- 主题生成在画布上新增独立 PPT，不删除或替换已有 PPT，并按任务所有权隔离页面集合
- 主题生成和缺图补全 SHALL 先把完整页面图写回用户可见 PPT，再从同一组页面冻结快照并生成讲解视频，不允许后台隐藏页图绕过画布
- 新增现有模型成片模式：把逐页快照与本页讲稿交给 Seedance 等有声视频模型生成讲解音轨，丢弃模型重绘画面，再以原 PPT 快照、音轨、字幕和转场确定性合成；界面明确提示语音内容、音色和时长由模型决定，可能波动
- 使用包含 `canonicalBaseUrl` 的 v2 无密钥路由快照固定恢复目标，允许凭据轮换但拒绝端点漂移
- 使用 Web Locks、执行尝试校验和取消墓碑协调同一任务的跨标签执行，并对最终画布交付单独加锁
- 新增浏览器 PPTX 安全解析与逐页快照能力；优先直传给支持 PPTX 的远端绑定，否则按页转换后提交
- 最终成片只登记一次，并同时进入素材库和创建任务时所属画布
- 不设置 OpenTu 产品层页数、输入大小、单条发言、总成片时长或同 PPT 活跃任务数硬限制；供应商和运行环境的真实错误保持可见
- 本地成片采用独立、可取消、按页释放资源的合成器，不直接复用会全量持有视频帧/chunks 的旧合并实现

## Impact

- Affected specs:
  - `ppt-explainer-video`（新增）
  - `pptx-import`（新增）
- Affected code:
  - `packages/drawnix/src/constants/skills.ts`
  - `packages/drawnix/src/mcp/**`
  - `packages/drawnix/src/components/ai-input-bar/**`
  - `packages/drawnix/src/components/media-library/**`
  - `packages/drawnix/src/components/project-drawer/**`
  - `packages/drawnix/src/services/ppt/**`
  - `packages/drawnix/src/services/ppt-explainer/**`（新增）
  - `packages/drawnix/src/services/pptx-import/**`（新增）
  - `packages/drawnix/src/services/provider-routing/**`
  - `packages/drawnix/src/services/media-executor/**`
  - `packages/drawnix/src/components/startup/**`
  - `packages/drawnix/src/services/task-queue-service.ts`
  - `packages/drawnix/src/services/task-storage-reader.ts`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - `packages/drawnix/src/contexts/AssetContext.tsx`
  - `packages/drawnix/src/types/shared/core.types.ts`
  - `packages/drawnix/src/services/canvas-operations/**`
- New dependencies:
  - `pptx-glimpse@5.3.0`：MIT，按需加载的浏览器 PPTX 渲染器；包声明 Node.js `>=22`，须在项目 Node 20 CI 基线上验证实际构建
  - `fast-xml-parser@5.10.1`：OOXML 关系和元数据解析
  - `jszip@3.10.1`：ZIP 中央目录和结构安全检查
- Related active changes:
  - 复用 `add-provider-protocol-routing` 已落地的 planner、binding 与 transport 代码，不修改其通用路由语义
  - 复用 `ai-input-generation` 已有多媒体 Skill 模型选择，不修改画布联想、目标跟随或跨媒体提示词语义

## Delivery Constraint

当前公开源码和文档未提供真实 `ppt-explainer` submit/poll/cancel 契约。本变更 SHALL NOT 猜测或硬编码兔子私有路径；没有真实专用 binding 时 SHALL 使用明确的逐页有声视频生成模式，而不是把普通 Seedance 等视频 binding 伪装成专用成片服务。
