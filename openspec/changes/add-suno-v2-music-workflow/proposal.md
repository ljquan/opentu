# Change: Suno v2 接入现有音乐工具

## Why
现有音乐工具使用 legacy Suno 提交和 clip_id，无法执行 Tuzi Suno v2 的动作及资源工作流。

## What Changes
- 新增独立 v2 协议、动作目录、请求校验和结果标准化，复用音频任务提交、轮询及恢复。
- 保留 Tuzi 注册表 27 项合同，按当前可用范围接入 24 个 v2 动作；主输入栏和音乐工具使用相同参数与可用性目录。
- 保存公开资源 ID 和来源渠道，展示歌曲、歌词、模型、音色、时间轴、MIDI 和风格扩写结果。
- 保持 legacy 行为，禁止 v2 回退为 Chat Completions。

## Impact
- Affected specs: audio-generation, provider-routing
- Affected code: audio API、provider binding、音乐工具、音频任务结果及持久化。
- Approval: 用户已在本对话明确批准本计划并要求实施。
- Scope update: 用户最新要求以 Tuzi API 的实际参数完成 OpenTu 接入；保留完整 27 动作合同供追踪；当前可调用范围以最新三项排除更正为准。未知动作和没有合同的旧别名不猜测转换。

- Native scope: 最新“都接好”授权补齐 26 个 Tuzi 原生操作和 legacy 上传/拼接；MP4、Persona 等已知别名使用独立 tuzi.suno.native，保持 v2 和 legacy 音乐/歌词兼容。
- Provider boundary: 本地协议/表单/恢复验证；真实请求体 taskId 的上游映射仍存在 Tuzi 网关限制，未修改网关或执行收费测试。

- Latest correction: 用户截图指出 suno/create-voice、suno/add-instrumental、suno/add-vocals 不应存在于可用列表；当前明确排除这三个 v2 模型，源码目录 27 项中只开放 24 项。已有 native 合同独立判断，不自动互转。此前完整开放 27 项的决定已被此更正覆盖。
