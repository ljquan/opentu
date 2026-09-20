# MiniMax-H3 V2 工作流

## Decisions

- 普通生成使用 POST /v2/video_generation，所有 H3 任务查询使用 GET /v2/query/video_generation/{task_id}。
- 提示词增强使用 POST /v2/h3_context_ir，model 为 MiniMax-H3，请求包含 content、duration、ratio，不包含 resolution。读取 task.content.prompt 后用于普通视频生成。
- AIInputBar 在创建视频工作流前增强，成功后仅将本次提交的 prompt_enhancement 设为 false，防止下游重复增强；输入历史保留原始提示词。没有独立增强弹窗。
- 中文界面附加“请用中文输出”，英文界面附加英文要求；不调用翻译模型。语言指令不是服务端强制保证。
- 两条视频 API 调用链共享 minimax-h3-video-workflow；其他入口携带增强参数时也可串行增强后生成。
- 重制使用 POST /v2/video_regeneration，请求仅包含 model、source_task_id、resolution=2K。重制不再次增强提示词。
- 不按分组限制操作。增强使用当前供应商，重制保留源任务供应商路由。
- 任务队列进度与终态回写保留执行器持久化的 remoteId 和 invocationRoute，避免覆盖源任务 ID。

## Validation And Errors

UI 与创建重制任务的业务层均要求已完成的 MiniMax-H3、768P 和非空远端 ID；提交前再次校验源分辨率和 ID。已是 2K、其他分辨率、缺少 ID 的任务拒绝重制。历史通用尺寸 1280x720 / 720x1280 按原 H3 请求的 768P 默认值兼容。

HTTP 错误、非零 base_resp.status_code、失败/取消状态、缺失任务 ID 或增强文本均终止流程。Context IR 使用有次数上限的轮询并支持传入 AbortSignal。服务端负责判断源任务归属、有效性与保留期限，本地不声称可提前验证。

## Risks And Recovery

- 上游权限、分组或源任务限制仍可能导致请求失败，错误反馈给用户，不切换到 Chat 规避。
- 旧任务已经丢失的远端 ID 不会自动恢复。
- 增强阶段发生在主页面提交预处理，刷新页面不会恢复该阶段；换板后不继续创建视频工作流。
- 不迁移存储，不删除已有任务。回滚功能代码即可撤回新入口；保留已有任务数据。
- 页面交互、真实计费接口与语言遵循情况须人工验收，mock 测试不能代替上游验收。

## Verification

参数和路由测试验证固定 V2；工作流测试覆盖增强成功、关闭、失败、超时和语言指令；重制测试覆盖资格与源供应商；任务队列测试覆盖 remoteId 进度和终态回写。实际结果见 qa/2026-09-15-MiniMax-H3-V2工作流-验证记录.md。
