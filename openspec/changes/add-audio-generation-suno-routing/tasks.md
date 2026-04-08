## 1. Architecture

- [ ] 1.1 为 `audio` 模态补齐核心类型，包括模型类型、任务类型、结果类型和默认路由
- [ ] 1.2 设计 Suno 的动作绑定结构，区分能力动作、执行端点和 `mv` 版本
- [ ] 1.3 定义音频任务提交与轮询状态的标准化映射

## 2. Provider Routing And Adapter Layer

- [ ] 2.1 为 provider routing 增加 `audio` 操作与对应的 binding metadata
- [ ] 2.2 新增 `AudioModelAdapter` 和音频 API service
- [ ] 2.3 实现 Suno 音乐生成提交 `/suno/submit/music`
- [ ] 2.4 实现 Suno 单任务查询 `/suno/fetch/{task_id}`
- [ ] 2.5 将 Suno 的能力动作映射到可执行请求，而不是直接按发现模型 ID 调用

## 3. UI And Settings

- [ ] 3.1 在设置页中增加音频默认模型路由
- [ ] 3.2 在 AI 输入栏中增加 `音频` 模式切换
- [ ] 3.3 为 Suno 音乐生成暴露基础参数表单：
  - `mv`
  - `title`
  - `tags`
  - `continue_clip_id`
  - `continue_at`
- [ ] 3.4 在任务队列和历史记录中展示音频任务与音频结果

## 4. Runtime Behavior

- [ ] 4.1 保证未显式选择模型时，音频请求可正确走默认 preset
- [ ] 4.2 保证显式选择 Suno 能力动作时，可以解析到正确的执行规则与 `mv`
- [ ] 4.3 保证任务刷新恢复时，音频任务可继续轮询并更新进度

## 5. Verification

- [ ] 5.1 验证 AI 输入栏可发起音频生成任务
- [ ] 5.2 验证 Suno 音乐生成接口可提交并回填 `task_id`
- [ ] 5.3 验证 `/suno/fetch/{task_id}` 能驱动任务状态从提交到完成
- [ ] 5.4 验证音频结果能进入任务列表与历史记录
- [ ] 5.5 验证图片、视频、文本既有链路不回归
