# Suno 音乐工作流（v2、原生与 legacy）

## 使用

1. 配置 Tuzi 供应商，发现并勾选所需的 `suno/{action}` 音频模型。
2. 打开“爆款音乐生成”，点击创作首页的“Suno 制作”直接进入；也可选择已有记录，在生成页选择 Suno v2 模型和制作动作。直接入口只创建本地记录，无需先生成歌词；未配置原生动作时禁用。
3. 按当前动作填写参数，表单提供 Tuzi 字段说明、默认值和枚举。v2 上传类动作需要可公开下载的 HTTP/HTTPS 音频地址；原生入口还提供 URL、Base64 和 multipart 本地文件上传。
4. 需要源曲目、音色或自建模型的动作，从同渠道已完成的 v2 结果中选择。结果旁的后续动作按钮可预填资源；双曲混合须再选择第二首不同曲目。
5. 任务完成后可播放曲目、查看歌词候选、下载导出文件，或查看扩写标签、歌词时间轴、波形采样数、MIDI 乐器轨和完整结构化结果。MIDI 不作为音频播放。

画布主输入栏也支持原生动作，参数菜单使用相同目录。主输入文字可补充歌词/灵感、声音描述或待扩写标签。上传、分轨、导出、训练等动作填好必需参数即可提交，不要求额外提示词。切换自定义模式会隐藏不适用字段，隐藏字段不发送；布尔值、数字（包括 0）和数组按原生类型发送。

## 已接入动作

| 用途 | 原生动作 |
| --- | --- |
| 基础创作 | `music`、`lyrics`、`sounds`、`upsample-tags` |
| 上传、翻唱、续写 | `upload`、`cover`、`upload-cover`、`extend`、`upload-extend` |
| 编辑及再创作 | `replace-section`、`concat`、`mashup`、`remaster`、`sample`、`adjust-speed`、`inspo` |
| 加轨 | `add-stem` |
| 资源制作 | `persona`、`create-model` |
| 分轨、导出、分析 | `stems`、`stems-all`、`download`、`aligned-lyrics`、`gen-midi` |

源码目录有 27 个动作，当前接入 24 个可用动作，模型名均为 `suno/动作名`。是否可调用仍取决于所选供应商是否提供并配置该模型。未知动作禁止提交。

- `create-model`：名称加 6–24 个公开音频地址，每行一个；返回模型 ID，可复用于支持 `model_id` 的动作，包括灵感模式。
- `inspo`：1–4 个公开音频地址，每行一个；提交为数组。
- `suno/create-voice`、`suno/add-instrumental`、`suno/add-vocals` 按用户确认排除，不显示为可调用模型；源码 schema 保留用于历史结果和合同追踪，不能据此推断当前供应商能力。原生 `/suno/api` 音色流程和同名加轨动作使用不同合同，不自动转换为这三个 v2 模型。
- `persona`：选择曲目并命名；可选人声区间须成对填写，结束晚于开始且短于 30 秒。
- 音色和自建模型互斥。支持音色的自定义创作动作可选择同渠道 `persona_id`；资源结果不要求包含可播放音频。
- `adjust-speed`：速度倍率 0.25–4，并可设置保持音高。`sounds` 的节拍按合同发送字符串，取值 1–300。

模型列表第一行展示完整模型 ID（如 `suno/aligned-lyrics`），第二行展示中文功能名称（如“歌词时间轴”）；说明不展示接口路径。模型选择器默认收起未接入的 Suno 入口，可勾选“显示未接入的 Suno 入口”查看，展开后标为不可选。已接入 v2 动作显示中文名与完整 `suno/...` ID，可按 ID 搜索；供应商和分类计数跟随当前可见列表。旧选择保留并提示重新选择，不自动替换或修改供应商配置。

`suno_act_mp4`、`suno_act_wav`、`suno_act_midi`、`suno_persona_create` 等已有明确合同的入口现已接入独立原生协议；未知入口仍不可选。旧版 `suno_music` / `suno_lyrics` 继续使用原有链路。MP4 使用 `/suno/api/v1/mp4/generate`，不转换为 v2 download。

## Tuzi 原生操作与参数

原生入口提供完整制作动作选择，共 26 个 `/suno/api` 操作，并补充两项 legacy 操作。主输入栏和音乐工具共用 schema，每个动作只展示其参数。接口由动作选择；所选入口名称不发送为 OpenAI model，Tuzi 按 endpoint 决定计费模型，渠道需支持对应操作。

| 分组 | 动作 |
| --- | --- |
| 音乐制作 | generate、sounds、extend、upload-cover、upload-extend、add-instrumental、add-vocals、mashup、replace-section |
| 歌词与风格 | lyrics、style、timestamped-lyrics |
| 导出 | wav、stems、midi、mp4、cover-image |
| 音色 | persona、voice-validate、voice-generate、voice-regenerate、voice-check |
| 文件和额度 | upload-url、upload-base64、upload-stream、credits |
| legacy 扩展 | legacy-upload、legacy-concat |

- 生成使用原生 camelCase 字段，例如 customMode、instrumental、model、callBackUrl；版本按官方枚举展示，不代表生产渠道已开放全部版本。新版标题可选，自定义模式需 style/lyrics/negativeTags 至少一项；非自定义模式需风格、歌词或参考素材至少一项。仅对应模式字段发送。
- MP4 需要 taskId、audioId、callBackUrl，可选 author/domainName；MIDI 需要 taskId、callBackUrl，audioId 可选；WAV 需要 taskId、audioId、callBackUrl。结果中的 MP4 使用视频播放器，MIDI 保留乐器数据/文件，不进入音频缓存。
- 分轨和局部替换支持合同规定的两种来源，已有任务/曲目或音频地址；两类不能同时选择。来源选择器按稳定资源键复用同渠道结果，不使用会随任务排序变化的数组下标。
- Persona 使用 taskId、audioId、name、description；可选人声区间按默认起点 0、终点 30 计算，长度 10–30 秒。音色验证先取得并展示 validateInfo，准备好验证文案的 wait_validating 状态完成当前步骤，再将 taskId 和朗读录音 verifyUrl 提交创建音色。后续音乐使用 voiceId 作为 personaId，并设置 personaModel=voice_persona。
- 大部分任务要求用户填写 HTTP/HTTPS 回调地址；不伪造回调服务。voice-regenerate 按官方合同使用拼写 calBackUrl。OpenTu 使用轮询获取结果，不新增回调接收后端。
- 原生任务按操作对应的 record-info/validate-info 查询；同步 Persona、时间轴、音色状态、上传与额度直接完成。URL 上传若被 Tuzi 代理转换为 legacy 异步任务，改查 `/suno/fetch/{id}`。
- 本地文件使用 FileReader 和序列化 data URL 保存任务草稿，提交 multipart 时恢复原始文件字节；可填写 fileName。当前本地文件控件限 20 MB，更大文件请使用 URL 上传。文件内容不保存到全局参数偏好 localStorage，实际任务/音乐草稿仍保留内容以支持恢复；未提交编辑不持久化。上传文件有效期由上游决定。
- 原生结果保存到 analysisData.sunoNative、音乐记录 sunoNativeResults；歌词候选同时保存为歌词版本。完整时间轴、MIDI、音色验证信息、文件与公开 ID 可查看。已知跨 profile 资源拒绝，v2 ID 不自动转换为原生资源，外部已有公开 ID 可手工填写。

合同来源：Tuzi `router/relay-router.go`、`relay/channel/task/sunonative/adaptor.go`、`controller/suno_native_proxy.go`，以及 2026-10-13 读取的 [官方 OpenAPI 文档索引](https://docs.sunoapi.org/llms.txt)。pricing 的 Chat Completions 标签不能决定协议。原生目录由 `scripts/sync-suno-native-catalog.mjs` 生成，校验每条操作确实存在于 Tuzi 路由。

**网关限制：** 当前所核对的 Tuzi 源码会把提交返回的上游任务 ID 换成公开 ID，并在查询参数中还原；原生后续 POST 请求体的 taskId 当前直接透传，未发现同等转换。这可能使依赖前一步任务的 MP4/Persona/续写等被上游拒绝。OpenTu 仅保存和使用公开 ID，不推算或暴露私有 ID；网关侧兼容修复及真实后续动作验收尚未完成，本次未修改 Tuzi 仓库。配置仅代理 legacy 的渠道也可能不支持部分原生操作，失败时保留真实错误，不回退为 chat/v2。

## 协议与数据

- v2 使用独立 `tuzi.suno.v2` 协议：`POST /suno/v2/{action}` 提交，`GET /suno/v2/fetch/{task_id}` 查询。请求体为动作原生 JSON，不注入 OpenAI `model/messages/stream` 或 Tuzi 不支持的 `notify_hook`。
- 合同来源为 Tuzi `pkg/sunoprotocol/catalog.json`、`validation.go` 与 `relay/channel/task/sunov2/testdata/upstream_results.json`，目录标记的核对日期为 2026-10-06。这是本地 Tuzi 源码合同核对，不代表生产供应商验证。
- 表单、类型转换、校验和动作绑定共用 `packages/drawnix/src/services/suno-v2-catalog.json`。请求/结果样例单独用于 mock 测试。
- `/models` 的 `suno/{action}` 即使被标为文本也归为音频。同供应商 pricing 缓存中精确匹配原生 POST 路径的条目可补充遗漏动作，需要用户勾选后使用。Chat Completions 标签、GET 查询路径及 legacy 别名不能作为 v2 请求合同。
- 任务保存远程 task_id 和调用来源，恢复时查询原任务，不重新提交。终态失败、成功空结果直接报错；长时间处理中按现有音频轮询期限超时。
- 完整结果、公开资源 ID 和来源 profileId 保存在任务 `analysisData.sunoV2` 与音乐记录 `sunoV2Results`。提交时保存 `sunoV2Drafts`，未提交的编辑是临时状态。无音频结果不进入音频缓存或画布。
- 音乐工具只选择当前记录、同 profile 的资源；主输入栏选择同 profile 已完成任务的资源。Tuzi 内部用户、应用和实际上游渠道归属仍由网关验证。legacy clip_id 不转换为 v2 music_id。

## 维护与限制

在 OpenTu 根目录同步本地 Tuzi 合同：

```sh
node scripts/sync-suno-v2-catalog.mjs /path/to/tu-zi-api
node scripts/sync-suno-native-catalog.mjs /path/to/downloaded-official-markdown /path/to/tu-zi-api
```

脚本只读 Tuzi checkout，更新 OpenTu 参数目录及测试样例。新增动作后须检查条件参数、资源引用、结构化结果处理和 UI 表单，再运行 QA 中的回归命令。不要只修改可用名单或依赖 pricing 标签。

没有新增依赖、环境变量、数据库迁移或部署顺序要求；需在已有供应商设置勾选原生模型。新增记录字段均可选，旧记录保持兼容。撤销此变更可回退功能，回退版本无法展示新增 Suno 结果。

“停止等待”仅本地取消，不保证远程任务取消或停止计费。未返回 task_id 的网络失败不证明远端未接收请求，重试前应检查供应商记录。公开音频可访问性、导出链接有效期及真实渠道产出仍需实际环境验收。

本次未做浏览器页面测试、真实 Tuzi 生成或计费验证。PR 提交前的最终验证为 584 项主回归通过、偏好测试 38 通过及 1 项上游既有失败，5 个项目类型检查和 Web 构建通过；全仓 lint 与循环检查仍有基线问题。完整命令、基线对照及验证边界见 `qa/2026-10-13-Suno-v2工作流.md` 的 2026-10-15 最终验证节。
