## 1. Architecture

- [ ] 1.1 为 Suno 请求增加 `sunoAction`，并定义 `music / lyrics` 两类执行动作
- [ ] 1.2 为任务结果增加 `resultKind` 与歌词结果字段，解除“所有 audio 任务都有媒体 URL”的假设
- [ ] 1.3 明确歌词结果的统一 markdown / text 画布格式

## 2. Provider Routing And Service Layer

- [ ] 2.1 为 Suno audio binding metadata 增加 `lyrics` 动作描述
- [ ] 2.2 实现 `POST /suno/submit/lyrics`
- [ ] 2.3 复用 `GET /suno/fetch/{task_id}`，并新增歌词结果标准化提取：
  - `text`
  - `title`
  - `tags`
  - `providerTaskId`
- [ ] 2.4 让 `music` 与 `lyrics` 共用轮询框架，但分别走各自的 submit body 与 result extractor

## 3. Task Queue And Persistence

- [ ] 3.1 调整 `TaskResult`、任务存储读写和恢复逻辑，支持无 URL 的歌词结果
- [ ] 3.2 调整任务队列 item 展示，使歌词任务显示动作、标题、标签和歌词摘要
- [ ] 3.3 为歌词任务补齐重试、刷新恢复和搜索行为
- [ ] 3.4 为歌词任务增加队列操作：
  - 复制歌词
  - 插入画布

## 4. UI And Canvas

- [ ] 4.1 在音频模式中增加 `music / lyrics` 动作切换
- [ ] 4.2 在 `lyrics` 动作下隐藏音乐专属参数：
  - `mv`
  - `title`
  - `tags`
  - `continueSource`
  - `continueClipId`
  - `continueAt`
- [ ] 4.3 调整手动“插入到画布”路径，让歌词结果走文本插入而不是音频节点
- [ ] 4.4 调整自动插入路径，按 `resultKind` 在音频节点和文本插入之间分流

## 5. Verification

- [ ] 5.1 验证歌词任务能正确提交到 `/suno/submit/lyrics`
- [ ] 5.2 验证 `/suno/fetch/{task_id}` 返回歌词结果时能正确完成任务
- [ ] 5.3 验证刷新页面后歌词任务仍可恢复与展示
- [ ] 5.4 验证歌词任务在队列中可复制、可插入，且不会被误渲染为音频卡片
- [ ] 5.5 验证音乐生成既有链路不回归
