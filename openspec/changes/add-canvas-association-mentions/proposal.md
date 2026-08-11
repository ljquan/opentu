# Change: 画布联想引用与结果连线

## Why

当前 AI 任务栏只能使用当前选区或上传素材作为参考，无法在编写提示词时保留多个明确的画布元素身份。任务完成后也没有稳定的来源元素 ID，因此无法把本次参考来源与最终结果建立可持久化连线。

## What Changes

- 在知识库按钮旁增加“开启联想”持久开关，默认关闭；关闭时 `@` 保持普通文本语义
- 在提示词原光标位置显示可删除的内联 `@对象` 引用；引用标签参与提示词语义，媒体二进制仍与文本状态分离
- 开启联想后，用户本次直接新输入、且光标仍紧邻的任意位置 `@` 都进入画布拾取状态；不限制 `@` 前后的正文，点击当前画板业务元素后把触发字符替换为有序引用 token。粘贴、历史文本和程序化回填中的 `@` 不伪造拾取
- 引用仅保存 `referenceId`、`boardId`、`elementId`、类型和显示标签；提交时才从当前画板解析图片、视频、音频、文本或可栅格化内容
- 扩展工作流、Agent 和任务队列上下文，携带有界引用快照；对当前模型不能消费的引用类型做显式阻止，禁止静默丢弃
- 请求被发布为画布任务后固化本次引用 ID，并把每个仍存在的来源连接到新建的 `generation-anchor` 或 `workzone` 任务节点；确认回执期间切板时延迟到来源板恢复后补线
- 最终结果插入画布后，把同一批关系线的任务端点迁移到首个最终结果；移动端点时同步线端点，删除任一端时仅移除关系线

## Impact

- Affected specs:
  - `ai-input-generation`
- Affected code:
  - `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - `packages/drawnix/src/components/ai-input-bar/canvas-association-state.ts`
  - `packages/drawnix/src/components/ai-input-bar/canvas-association-resolver.ts`
  - `packages/drawnix/src/components/ai-input-bar/workflow-converter.ts`
  - `packages/drawnix/src/components/ai-input-bar/ai-input-bar.scss`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - `packages/drawnix/src/mcp/tools/*-generation.ts`
  - `packages/drawnix/src/plugins/canvas-association.ts`
  - `packages/drawnix/src/services/model-adapters/seedance2-adapter.ts`
  - focused tests for the modules above

## Non-Goals

- 不新增服务端账号、权限或数据库实体
- 不重构任务栏之外的编辑器、画布选择系统或通用连线工具
- 不把生成中的临时锚点改为永久节点；任务完成时复用并迁移已有关系线，而非创建第二组线
- 不让不支持视频或音频参考的模型静默忽略引用
