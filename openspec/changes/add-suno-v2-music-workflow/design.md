## Decisions
- v2 使用独立 `tuzi.suno.v2` binding；动作由精确 `suno/{action}` 模型指定。legacy 仍使用 `tuzi.suno.music`。
- 目录保留 Tuzi 27 项合同，当前开放 24 个 v2 动作；create-voice/add-instrumental/add-vocals 明确不可用，目录不能作为供应商已开放的证据。
- 历史音色克隆结果返回 persona_id，继续沿用任务和音乐记录保存，但 create-voice 新提交禁止；后续自定义音乐动作从同 profile 结果选择音色，不把音色资源当作可播放歌曲。
- 参数 schema 摘自 Tuzi 本地 sunoprotocol/catalog.json 的 2026-10-06 合同；运行时目录不包含价格、供应商地址或示例资源 ID。scripts/sync-suno-v2-catalog.mjs 生成参数目录及单独的请求/结果测试样例，保留动作字段差异、描述、枚举、类型和约束。
- create-model 的 6–24 个地址与 inspo 的 1–4 个地址提供多行输入并转换为数组。模型资源与音色资源按各动作 schema 可选，model_id 不被错误地限制为 custom=true；persona_id 与 model_id 互斥。
- aligned-lyrics、gen-midi、upsample-tags 分别校验时间轴/波形、乐器轨/文件和扩写文字。完整 result 保存，并在音乐工具和任务列表展示；MIDI 链接不进入音频播放或缓存。
- 音乐结果的后续动作由目录中的资源字段生成，音色/自建模型同样能预填到下一步，不再手写少数歌曲动作名单。
- v2 请求按动作发送原生 JSON，保留 false/0；不注入 model/messages/stream/notify_hook。运行时 callbacks 不发送给供应商。
- 复用 AudioAPIService 的取消、轮询、退避及提交后持久化。v2 envelope code 与任务 status 分开处理，明确成功但空结果时失败，不无限等待。
- 多歌曲、多歌词及导出文件完整保留；结构化结果放入任务现有 analysisData 字段。无音频结果不写入音频缓存或画布。
- 音乐工具保存来源 profileId 和公开 music_id；只从同 profile 的成功 v2 结果选择资源。真实用户/App/上游渠道归属由 Tuzi 验证，前端不得声称已经验证。
- legacy clip_id 不等于 v2 music_id；旧数据不迁移或猜测转换。
- 主输入栏复用 ParametersDropdown，按目录生成动作字段并支持资源单选、多曲目/导出格式多选。草稿仍保存字符串，提交前转换为原生 boolean/number/array，按自定义模式过滤隐藏字段；workflow 与 MCP 使用 sunoV2Body/sunoV2Resources 传到音频任务。
- 主输入栏从已完成任务选择同 profile 的公开资源；音乐工具从当前记录选择。未接入且无合同的 legacy 别名隐藏旧参数，并在 UI、workflow、MCP 和服务禁止提交，不转换成同名 v2 动作。
- 音乐工具创作首页提供 v2 直接入口，只创建本地音乐记录并进入已配置的原生动作，不提交歌词或其他供应商请求。
- `/models` 中的 `suno/{action}` 强制归为音频；同 profile 的 pricing 缓存仅在提供对应 `POST /suno/v2/{action}` 路径时补充遗漏模型。补充条目标记来源，缓存撤回时移除；不自动勾选模型，不新增网络请求。Chat Completions 元数据不决定 v2 的请求合同。

## Validation
- 模拟 transport 验证提交与恢复只查询原任务，错误 envelope、空成功、超时及取消。
- 测试目录、binding、原生请求、跨 profile 资源与音乐记录同步。
- 类型检查、相关回归及构建；不做页面测试或真实付费请求。

## Native/legacy extension (user: 都接好)
- 用户明确授权接入剩余 Suno 接口。补齐 Tuzi `/suno/api` 的 26 个操作（19 个任务提交、Persona/时间轴/音色检查、三种上传和额度查询），以及 legacy concat/upload；保留既有 music/lyrics。
- 以 Tuzi 路由及 sunonative adaptor 为网关合同，以 2026-10-13 读取的 docs.sunoapi.org OpenAPI 补足透传字段。生成可追踪目录，原生协议独立为 tuzi.suno.native，不混用 v2 资源。
- 原生模型入口提供动作选择，默认匹配其动作；保存 sunoNativeAction、原生 body 与资源来源。查询按保存动作使用 record-info/validate-info；同步操作直接完成，无需伪造 task ID。
- 回调地址按官方 schema 展示并校验，不填造假地址。上传 stream 使用 multipart，base64/URL 使用 JSON；结果中的公开 URL 可供后续上传创作使用。
- 结构化结果保存到 analysisData.sunoNative，MP4、图片、MIDI 与音频分开展示，只有实际音频进入现有音频缓存。公开任务 ID 不推算或替换成上游私有 ID；Tuzi 对后续请求体资源映射能力仍需真实环境验证。
- 分阶段：合同目录及协议/测试 → 主输入栏/音乐工具/结果与恢复 → 全部受影响测试、类型、构建及 QA/DOC。没有新增依赖、后端服务、部署或付费调用。

- 原生模式条件按官方当前合同：标题可选、模式对应参考/高级字段过滤；voice validate 的 wait_validating 带文案时结束当前步骤，避免等待用户录音期间轮询超时。
- 全局参数偏好排除 file/base64Data；本地文件限 20 MB，真实提交为原始字节 multipart。资源选择使用稳定复合键；资源来源跨 profile 拒绝、公开 voiceId 复用为 personaId 且选择 voice_persona。
- Tuzi 查询 public→upstream ID 转换有源码证据，原生后续 POST body 则透传，无同等转换；这是未修改的网关限制，不能以 mock 验证声明端到端可用。

## Latest v2 availability correction
- 源码目录不是供应商模型可用性合同。用户最新确认排除 suno/create-voice、suno/add-instrumental、suno/add-vocals，覆盖此前无条件开放 27 动作的决定。
- 明确不可用名单集中在 suno-v2.ts，表单、模型选择、binding、workflow/MCP 和服务提交共用 supported 状态；pricing 不补充这三项。旧设置保留但禁用，历史结果继续可读；音乐后续按钮不显示不可用动作。
- 不触碰 native /suno/api 的独立动作，未执行真实请求。
