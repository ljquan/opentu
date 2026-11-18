# Change: 接入 Tuzi Vidu Q3 / Q4 视频系列

状态：2026-11-17 用户以“是的”确认方案，已完成本地适配及有界实测；测试 API 基址采用 `https://apioss.tu-zi.com/v1`。资料核对于 2026-11-17，来源为同站 `/api/pricing` 和 Vidu 官方文档。

## Why

Tuzi 当前开放 8 个 Vidu 型号，OpenTu 仍使用通用视频参数和表单回退，不能正确表达各型号的动作、图片和时长约束。`viduq3-ad` 已在本会话通过一次真实参考图生成，但该结果尚不能证明 OpenTu 的适配或其他型号可用。

## What Changes

- 接入下表的精确模型 ID、Vidu 厂商归类、按钮短代码、时长和分辨率。未知后缀不继承这些合同。
- 输入栏继续使用现有附件；按有效动作提交有序图片：文生无图、图生一图、首尾帧两图、参考模式按型号限制。支持多种动作的型号提供自动判断及显式模式选择，显式模式优先，不自动更换型号。
- 所有现有视频入口复用同一个 JSON 构造器：`POST /v1/videos`，顶层 `model/prompt/images/duration/size` 和 `metadata.action`；复用原有任务查询、结果缓存和画布插入。
- 本地或缓存图片读取原始字节，按已声明的 PNG/JPEG/WebP data URI 合同提交；公网图片 URL 保留。校验动作、素材数量、时长、分辨率和请求大小；无效输入在发送前报错。
- Q3 参考模式最多 7 张图片；Q4 Preview 参考模式最多 15 张。显式图生为 1 张、首尾帧为 2 张，不以图片数量自动覆盖用户明确选择的模式。
- 2026-11-18 按 Mix 专用适配器补充 `viduq3-mix` 的画幅、种子、水印、音频参考、元数据、透传文本和回调。Mix 使用顶层 `resolution`，其他七个型号沿用原配置。

| 模型 ID | 可用动作 | 时长 | 分辨率 |
| --- | --- | --- | --- |
| viduq3-ad | 参考 | 3–15 秒 | 720p / 1080p |
| viduq3-drama | 参考 | 2–16 秒 | 720p / 1080p |
| viduq3 | 参考 | 3–16 秒 | 540p / 720p / 1080p |
| viduq3-turbo | 文生 / 图生 / 首尾帧 / 参考 | 普通 1–16 秒；参考 3–15 秒 | 540p / 720p / 1080p |
| viduq3-pro-fast | 图生 / 首尾帧 | 1–16 秒 | 720p / 1080p |
| viduq3-pro | 文生 / 图生 / 首尾帧 | 1–16 秒 | 540p / 720p / 1080p |
| viduq4-preview | 图生 / 参考 | 3–16 秒 | 540p / 720p / 1080p / 2K / 4K |
| viduq3-mix | 参考 | 3–15 秒 | 720p / 1080p |

默认值优先采用公开模型表单显式设置：一般 5 秒 / 720p，Drama 为 8 秒 / 1080p。页面文字所述省略参数默认值与部分表单不同，客户端将显式发送所选值。

## Impact

- 受影响能力：模型目录与运行时发现、视频参数、输入栏工作流、统一视频请求、主线程/共享提交及任务恢复。
- 复用现有 React 参数控件，保持原有视频型号的参数、默认值及供应商配置。
- 无新运行时依赖、后端修改、数据库迁移或全局 API 地址变更。
- 对 `https://apioss.tu-zi.com` 增加 OpenTu 本地开发和 Nginx 同源代理；代理侧固定注入 `apioss_port=3105`，仅匹配该精确地址，不改变普通 Tuzi 节点。
- 更新现有视频使用文档与 QA，以最终实现和实际测试记录为准。

## Validation And Remaining Decisions

1. 本地回归覆盖 8 型号及各模式的正确 JSON、无图/超量/不支持素材、Turbo 参考时长、默认值、路由和完成/失败恢复；执行类型、相关静态检查及构建。默认不做页面点击或视觉验收。
2. 测试 API 基址为 `https://apioss.tu-zi.com/v1`，不改全局默认服务地址，不增加参考素材转存功能。
3. 测试地址确认后，每个型号至多提交 1 次最低有效时长、最低清晰度的真实请求；保存任务 ID 并只轮询原任务，检查实际文件和计费。任何受理状态不等同于生成成功，结果不明时不重交。
4. 官方能力与 Tuzi 开放能力分别核对；远程 URL 的实际尺寸/大小由服务端最终检查。只将实际完成的测试记为通过。

## Final Outcome

- 八型号各一次最小规格真实生成全部 completed；8 份 MP4 均下载并成功解码 3 帧；实际账单按任务 ID 匹配，合计 ¥5.196625。
- 通过 apioss 同源代理完成 OpenTu 页面复测：`viduq3-ad` 页面任务完成并插入白板，额外扣费 ¥1.323；远程任务 ID 见 QA。
- 本地十文件回归为 309 项通过、2 项既有失败；Sora 和 Seedance 两项失败已在未修改的基础提交 `3c5dc76d` 复现。drawnix/Web 类型检查与 Web 构建通过。
- Mix 在 7205 页面粘贴公网 MP3 后，真实请求含 1 图和 1 段声音，下载的 3.042 秒成片含非静音音轨。高级选项的独立效果和刷新恢复仍待验证。完整命令、任务 ID、实际媒体参数及限制见 `docs/qa-tuzi-video-model-parameters.md` 的 Vidu 章节。

## Sources

- Tuzi 模型目录：`https://apioss.tu-zi.com/pricing?search=vidu`，同站公开 `/api/pricing` 的精确型号说明、参数与 endpoint。
- Vidu Q3：`https://platform.vidu.cn/docs/api-reference/video-models/vidu-q3/reference-to-video`，参考模式 1–7 张图片及 Base64/URL 格式；此来源不替代 Tuzi 对可用动作的限制。
- Vidu Q4：`https://platform.vidu.cn/docs/api-reference/video-models/vidu-q4-preview/image-to-video`，图生为一张图片，3–16 秒及 540p–4K 档位。
- Vidu Q4 参考模式：`https://platform.vidu.cn/docs/api-reference/video-models/vidu-q4-preview/reference-to-video`，最多 15 张图片。官方参考音频能力不能覆盖 Tuzi 目录中“未开放参考音频”的限制。

## Pre-Implementation Checks

- OpenSpec 严格校验通过：`openspec validate add-vidu-video-models --strict`。
- 现有基线通过：`node node_modules/vitest/vitest.mjs run --config packages/drawnix/vite.config.ts packages/drawnix/src/services/tuzi-video-request.test.ts packages/drawnix/src/services/tuzi-video-advanced.test.ts packages/drawnix/src/components/ai-input-bar/__tests__/tuzi-video-workflow.test.ts`，3 文件 / 109 测试通过。
- 当前 worktree 原无依赖目录；其锁文件与主工作区完全相同，已通过忽略的 `node_modules` 符号链接复用既有依赖，未安装或升级依赖。Node 26 的 localStorage 和缺少 IndexedDB 出现既有测试环境警告，但本次基线测试通过。
- 上述为实施前基线记录；最终 Vidu 回归、类型、构建和实测结果见 Final Outcome 及对应 QA。
