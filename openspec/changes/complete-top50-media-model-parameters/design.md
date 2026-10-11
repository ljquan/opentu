# Top 50 图片与视频模型参数补齐实施方案

## 1. 基线与最终效果

状态：用户已批准实施和提交 PR。本文按最终范围维护实施矩阵，验收结果见 docs/qa-top50-media-model-parameters.md。

最新约束：撤回本次 Image 2 扩展和所有新增水印。已有 Image 2.5 参数、Seedance 2.5 水印等基线能力保持；Veo 四项高级参数按用户要求直接开放。

- OpenTu：`647e378d`，已包含 `5defc210`（Image 2.5 背景）和 `094fea14`（Image 2.5 高级参数）。
- 功能分支：`dev/complete-top50-media-parameters`；提交 PR 前显式同步最新 `origin/develop`。
- Tuzi 契约参考：`/Users/lkj/Desktop/working/tu-zi-api` 的 `6ad30c8db`，只读，不代表线上部署版本。
- 输入资料为用户提供的 Top 50 清单及《OpenTu 图片与视频模型接口及 Tuzi API 参数》，不是实时排行榜。

最终用户效果：用户选择这 26 个模型时，看到与所选模型及渠道相符的参数；所选值能保存、恢复，并出现在实际请求中。已有 Image 2.5 参数不重复开发，固定档位型号不显示无效档位，不支持的高级能力有明确边界。

完成需同时具备：参数入口、类型/约束、任务保存、执行透传、最终请求映射和结果消费证据。模型列入目录、DTO 有字段、模拟返回成功不能替代这些验收。

## 2. 范围与明确排除项

纳入：21 个图片模型、5 个视频模型的普通画布参数、原生工作流参数和必要的公共调用链。旧弹窗、批量任务、Agent/Skill 复用链只在实际消费受影响时调整和回归，不改无关布局。

排除：Sora、HappyHorse、Seedance 1.x、Seedream 4.x/5.0 Pro、Gemini 异步型号、音频/文本模型，以及榜单之外其他模型的新能力。公共模块变更仍需对相邻模型做负向回归。

不改变价格、额度、推荐排序、账号/Key、生产渠道配置；不新增收费重试、订阅、回调服务器或数据库迁移；不启动浏览器页面测试或真实供应商生成。用户已经授权本地实施和提交 PR；不包含合并或部署。

## 3. 逐模型实施矩阵

标记：P 为第一交付，C 为满足契约/渠道前置条件后实施，R 为已实现能力回归。表中候选不等同于供应商已支持。

### 3.1 图片模型（21 个）

| 排名 | 精确模型 ID | 当前事实 | 实施动作 |
| ---: | --- | --- | --- |
| 1 | `gpt-image-2.5-sunburst` | 背景及 4 项高级参数已有 | R：保留尺寸/分辨率/画质/背景/输出行为 |
| 5 | `gemini-3.1-flash-image-preview` | 比例、1K/2K/4K 已有 | R：核对原生和兼容协议；不重复增加数量控件 |
| 6 | `gpt-image-2.5-flare` | 同 Sunburst | R |
| 7 | `gpt-image-2` | 高级字段渠道支持未确认 | 已回退本次扩展，保持基线 |
| 13 | `gemini-3-pro-image-preview` | 比例、1K/2K/4K 已有 | R：保留已有能力 |
| 15 | `gpt-image-2.5` | 背景及高级字段已有 | R |
| 16 | `gemini-3-pro-image-preview-4k` | 有 4K 默认元数据，无质量选择项 | R/C：检查最终档位传递，不能因没有菜单就新增 1K/2K |
| 17 | `gpt-image-2-1k` | 无静态条目，有原有适配测试 | 已回退新增注册/参数组，保持基线 |
| 18 | `gemini-2.5-flash-image-vip` | 比例配置已有 | R：不套用 3.x 的质量档位 |
| 25 | `gpt-image-2-vip` | 同 Image 2 | 已回退本次扩展，保持基线 |
| 26 | `gemini-3-pro-image-preview-2k` | 有 2K 默认元数据 | R/C：按绑定确认是否需显式发 `imageSize=2K` |
| 27 | `gemini-3.1-flash-image` | 无该精确内置 ID | P/C：核实 ID 契约后复用对应参数元数据，保留请求 ID |
| 30 | `gpt-image-2.5-1k` | 已有尺寸、画质、背景及高级参数 | R：画质为 auto/low/medium/high，无独立 resolution 菜单 |
| 35 | `nano-banana-2` | 内置目录中是 Flash 3.1 的 shortLabel | P/C：区分显示名和实际运行时 ID，不能直接声称已继承 |
| 36 | `gpt-image-2.5-vip` | 背景及高级字段已有 | R |
| 37 | `gemini-3.1-flash-image-preview-4k` | 有 4K 默认元数据 | R/C：固定档位和极端比例契约核对 |
| 38 | `doubao-seedream-5-0-260128` | 比例、2K/3K 已有；高级字段未发送 | 新增水印已撤回；C：提示词优化/序列生成/图层拆解 |
| 40 | `nano-banana` | 内置目录中是 Gemini 2.5 的 shortLabel | P/C：同显示名/实际 ID 处理 |
| 42 | `gemini-2.5-flash-image` | 比例配置已有 | R |
| 49 | `gemini-3.1-flash-image-preview-2k` | 有 2K 默认元数据 | R/C：固定档位和极端比例契约核对 |
| 50 | `gemini-3-pro-image` | 无该精确内置 ID | P/C：确定契约后复用 Pro 参数元数据，保留请求 ID |

### 3.2 视频模型（5 个）

| 排名 | 精确模型 ID | 当前事实 | 实施动作 |
| ---: | --- | --- | --- |
| 23 | `doubao-seedance-2-0-260128` | 时长/分辨率/比例/音频/seed/镜头/参考素材已有 | 保持原有参数；官方水印支持未确认，不开放 |
| 28 | `doubao-seedance-2-5-260628` | 官方文档明确输出格式；draft/priority 无可靠官方合同 | 保留已有 watermark/output_format，移除 draft/priority |
| 29 | `MiniMax-H3` | V2、基础参数、首尾帧、参考视频、提示词增强、2K 重制已有 | 新增水印已撤回；C：回调、参考音频、显式参考图模式 |
| 32 | `veo3.1` | 时长/尺寸和两张首尾帧输入已有；通用路径丢高级参数 | P：直接开放四项高级参数和 metadata 桥；上游尾帧另列依赖 |
| 44 | `doubao-seedance-2-0-fast-260128` | 同 2.0 基础参数 | 保持原有参数；官方水印支持未确认，不开放 |

### 3.3 对前期结论的修正

- Image 2.5 五型号的背景和高级参数已完成；`-1k` 也有画质选项，不能说不需要画质。
- Image 2 普通/VIP 的工作流通过 `extendAdapterParameters` 已能补充高级字段；缺项主要在主画布配置，不要重复实现适配器。
- `nano-banana(-2)` 的 shortLabel 不能证明同名 API ID 自动继承参数；无精确契约时保留待确认状态。
- Gemini 固定 2K/4K 元数据不是最终请求已保留档位的证明；需核对不同入口和绑定。
- OpenTu 已有 Veo 首尾帧 UI 和传输；Tuzi Gemini 上游转换仍只取第一张，并标注 lastFrame/referenceImages TODO。缺口在具体后端路径。
- Seedance 2.5 的 `output_format`/`priority` 已由 OpenTu 发出，但 Tuzi Doubao 和 SeedanceProxy DTO 没有对应消费；不能报告线上生效。
- Seedream DTO 对 `optimize_prompt_options` 的注释指向 5.0 Pro；不能推导 Lite 也支持优化和图层拆解。

## 4. 技术路线与公共约束

### 4.1 复用现有架构

```text
ModelRef + Provider binding
  -> model-config / getCompatibleParams
  -> 主画布参数或 native-parameters
  -> model-scoped preferences / Task.params
  -> GenerationAPIService 或 FallbackMediaExecutor
  -> requestSchema 对应 adapter
  -> JSON / FormData / metadata
  -> Tuzi DTO -> 选中渠道适配器 -> 供应商
```

继续使用现有 `ParamConfig`、`ProviderModelBinding` 和工作流 `PARAMETER_CONSUMERS`/`ADAPTER_PARAMETER_IDS`。不新增整套能力平台；只有相同判断被多个入口复用时才抽取窄的纯函数。

支持判断按精确模型、所选 profile、requestSchema 和已知渠道契约进行。相同模型 ID 可走不同协议，不能只检查 `includes('gemini')` 或 DTO 字段存在。现有快照不能识别 Tuzi 内部渠道时，保留未知状态，后端专属字段不自动全局启用；确认后记录可复查的契约版本/来源。

### 4.2 参数和默认值

- 只序列化允许字段；禁止把整个 `params` 原样铺进请求，避免回调、控制函数和旧模型残留字段泄漏。
- 数字验证有限值及范围；整数参数拒绝小数，布尔明确解析 true/false，不使用 `Boolean('false')`。
- 缺省不发，显式 `false`、`0` 必须保留；已有默认值不因补参数而更改。
- 各 profile/model 隔离参数。切换模型恢复合法值，历史任务保留原数据，执行前只验证当前消费字段。
- 不增加参数的收费重试。提交失败不自动换模型、改尺寸或删除高级项再次请求。

### 4.3 模型 ID 与别名

对 `nano-banana-2`、`nano-banana`、`gemini-3.1-flash-image`、`gemini-3-pro-image` 建立有限、显式的参数元数据映射。前两个只在展示时保持显示名；如果 provider 返回精确同名 ID，则为该 ID 建立受限运行时契约，实际请求继续发送该 ID。

非 preview 名称不能仅凭相似字符串重写成 preview。以 endpoint 元数据、现有绑定或已确认渠道契约建立参数关联；未知 ID 不自动匹配。优先在 `getCompatibleParams` 的纯参数解析处和 runtime discovery 衔接，避免复制一套参数表，也不迁移已存 `ModelRef`。

## 5. 最终实现与依赖

### 5.1 Gemini 精确别名

nano-banana 复用 gemini-2.5-flash-image；nano-banana-2 和 gemini-3.1-flash-image 复用 gemini-3.1-flash-image-preview；gemini-3-pro-image 复用 gemini-3-pro-image-preview。getStaticModelConfig 保留精确 ID，getCompatibleParams 只映射参数兼容 ID。已有静态配置优先，运行时 profile/selectionKey 保留。未知近似名称不匹配；不新增静态选择器条目。

### 5.2 Veo 四字段

| 参数 | metadata | 规则 |
| --- | --- | --- |
| negative_prompt | negativePrompt | 字符串，trim 后为空则省略 |
| generate_audio | generateAudio | 布尔或保存的 true/false 字符串 |
| seed | seed | 非负安全整数，渠道可配置 seedMax |
| person_generation | personGeneration | 默认 dont_allow/allow_adult/allow_all，渠道可限制枚举 |

utils/veo-parameters.ts 集中白名单和校验。video-api-service.ts 与 media-api/video-api.ts 在既有 multipart 提交前调用，缺省不增加 metadata。显式 false 和 0 必须保留，其他模型不应用映射。supportedParameters 不作为开放门槛；类型及取值限制仍生效。前端直接开放不等于真实供应商确认。

生成音频使用默认/关闭/开启三个等宽按钮，默认清空值。已有带固定默认值的开关沿用原样。高级功能关闭时清空高级参数。

### 5.3 Seedance 与水印撤回

Seedance 2.5 原有水印及 mp4/mov 请求保持，output_format 同步到工作流消费者和白名单。移除 draft/priority 定义与消费，遗留保存值不进入请求，不迁移历史任务。原 binding 的路由 priority 与生成参数 priority 是不同字段，路由优先级保留。

Seedream Lite、Seedance 2.0/Fast 和 H3 不保留本次新增水印。Seedream/H3 请求构造恢复基线；其他模型已有水印也保留。

### 5.4 保存恢复与工作流

原生目录将 binding.metadata.video 交给 applyNativeAdapterContract 应用 Veo 取值限制。task-invocation-route 仅持久化允许字段，过滤嵌套凭据。视频偏好从 selectionKey 解析 profile/model，使用所选供应商而非默认供应商参数清单。

## 6. 验证与验收

1. 配置和26-ID测试：Gemini 精确别名、未知相似 ID、Image 2 回退和 Image 2.5 保留、新增水印撤回与旧水印保留。
2. 请求测试：两条 Veo multipart metadata、false/0/缺省、非法布尔/种子/枚举、相邻模型隔离；Seedance 旧参数不透传。
3. 工作流/偏好/快照：消费者白名单、可选限制、供应商作用域、凭据过滤。
4. 运行受影响测试、TypeScript、构建、OpenSpec strict 和 git diff --check；基线失败单列，不删除或跳过失败断言。
5. 获得 PR 授权后先提交、显式 fetch/merge origin/develop，再最终验证、更新 QA/DOC、推送并创建 PR；不合并。

默认不执行页面测试、截图、付费请求或部署。测试请求使用 mock transport/fetch，不宣称供应商生效。

## 7. 条件工作包与维护

Seedream 优化/序列/图层拆解、Seedance callback/frames/尾帧、H3 参考音频、原生 Gemini 视频高级参数和 Tuzi Veo 后端媒体转换未实施。各工作包需单独确认具体模型/渠道请求与结果合同，不能借用相邻模型能力或 DTO 字段推定支持。

本次不增加依赖、环境变量和迁移。功能回滚使用提交级撤回，保留用户任务、素材和供应商配置。最终 QA/DOC 和 PR 注意事项记录本地验证、基线问题及未验证渠道风险。
