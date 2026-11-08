## Context

- 现有 `seedream-adapter.ts` 使用旧 JSON 路径，按 `seedream_quality` 将比例映射为 2K/3K/4K 像素，适用于原有模型。
- `model-config.ts` 有基于 `seedream` 标签的共享尺寸控件；只增加模型 ID 会导致 Flash 继承不合适的参数。
- `binding-inference.ts` 将 Seedream 模型推断为 `openai.image.seedream-json`，需要在通用匹配前识别精确 Flash ID。
- 适配器选择同时存在 binding/schema 和模型/标签两条路径，旧持久化 binding 也可能指向旧合同，需同时验证。
- 当前图片请求类型已经包含 `background`、`outputFormat`、参考图及额外参数，结果已经支持 `width`、`height` 和 `raw`，优先复用。
- 原生分层位于 `layer-decomposition/provider.ts`，自动分层由本地服务优先执行，Pro 作为兜底。该流程保持当前行为。

## Goals / Non-Goals

- Goals: 在现有入口完成 Flash 普通生成、参考图和透明背景的完整参数传递，正确路由 v3，限制错误组合，保留结果和错误证据。
- Non-goals: 新建通用图片执行框架、推断 Lite/Pro/Flash 别名、变更全局图片压缩设置、实现未经定义的 Flash 图层自动对齐、增加自动付费重试。

## Decisions

### 1. 精确模型及独立 schema

使用完整 ID `doubao-seedream-5-0-flash-260915` 和专属 schema `tuzi.image.seedream-flash-json`。新适配器仅对精确模型/schema 生效，不按所有 `seedream` 标签匹配。注册顺序、旧 binding 修正及无 binding 的模型选择均需测试，避免被旧适配器抢先处理。

模型可出现在内置目录中；实际可调用性仍受所选 Provider 的模型列表、权限和余额约束，不把本地配置当作服务开通证明。

### 2. 路由复用当前 Provider

通过现有 `sendAdapterRequest` 和 Provider transport 发送请求，沿用当前 Provider 的主机、鉴权、请求观察与超时机制，不硬编码替换用户的服务主机。

服务根地址和尾部 `/v1` 配置应最终得到唯一的 `/api/v3/images/generations`，不能拼成 `/v1/api/v3/...`。优先复用现有 `trim-v1` 策略；其它路径形式按既有 Provider 配置约定处理并给出可定位错误。绑定不声明轮询路径，不新增异步 `/videos` 兜底。

### 3. 参数白名单及产品默认值

普通生成请求仅构造文档允许字段：`model`、`prompt`、可选 `image`、`size`、`response_format`、`output_format`、`background`、`watermark`、`optimize_prompt_options` 和可选 `stream:false`。普通生成不向服务发送 `layer_decomposition:true`。

产品默认值为 `size:1K`、`response_format:url`、`output_format:png`、`background:opaque`、`watermark:false`；提示词优化只在用户选择时传 `mode:standard`。支持调用方显式选择 Base64。内部未选择状态在序列化前归一化，不向服务透传 `auto`、`null`、旧质量字段、组图字段、mask 或未知字段。

尺寸界面提供档位。精确尺寸程序入口验证正整数、921600～4624220 像素及 1:16～16:1 比例，包含边界；禁止旧 3K/4K。普通生成必须有非空提示词，参考图数量为 0～10，显式空数组不作为合法 API 字段发送。

### 4. 透明背景和参考图

透明背景要求恰好一张带透明通道的 PNG 参考图及 PNG 输出。对明确无效的输入在生成请求前报错。对本地/缓存/Base64 参考图复用原始字节读取路径，确保提交前的缩放或编码不会剥离透明通道；不修改其他模型的默认压缩行为。

远程图必须由所选服务可访问。若浏览器不能读取或确认透明参考图，给出导入本地 PNG 的可操作提示，不仅凭 URL 后缀认定有透明通道。文件格式、透明通道与实际透明像素分开验证，避免将 PNG 签名当作透明效果证据。

### 5. 响应和错误

复用 `ImageGenerationResult` 和现有缓存。URL 和 Base64 按请求格式读取，Base64 MIME 使用实际 `output_format`，保留 `raw`。服务 `size` 可填充结果尺寸元数据，但缓存/画布已有解码尺寸仍作为实测值。空列表、损坏的图片字段及响应内错误都不能当作成功。

继续由现有传输层记录可用请求 ID 和处理结果不确定场景。新增适配器不自动重试生成，也不自动切换到另一图片模型或服务。错误信息不包含密钥或完整认证头。

### 6. 原生拆图单独后续接入

本期不把 `layer_decomposition` 作为普通生图菜单开关，不改变自动分层首选路径或固定 Pro 模型。当前 Flash 文档不足以证明它符合既有画布分层合同。补齐语义后再按现有分层适配入口转换，保留每个产物的原始元数据，不通过猜测补齐坐标和层级。

## Risks / Trade-offs

- 独立适配器增加少量代码，但能隔离 v3 路由和尺寸限制，保留旧 Seedream 的既有行为。
- 第一版直接提供三个尺寸档位，避免用旧比例映射产生越界尺寸；自定义尺寸输入控件不在本期范围。
- 透明参考图可能被中间处理改成 JPEG，必须以端到端参数/字节测试确认。
- mock 和构建不能证明服务真实行为、CORS、权限、计费或输出透明效果；没有相应授权时如实保留未验证状态。
- 现有未提交的 `packages/drawnix/src/data/image.test.ts` 属于任务前状态，保持原样。

## Validation Plan

1. 精确目录、参数菜单、偏好隔离、schema 和 adapter 选择测试。
2. 根地址/尾部 `/v1`/专属主机路径测试，普通和旧持久化 binding 选择测试。
3. 请求字段及成功、失败、边界测试，特别覆盖 `watermark:false`、透明参考图和 JPEG/Base64 MIME。
4. 原生调用与工作流转换、现有 Seedream/Flash 相邻模型回归。
5. 类型、修改文件 lint、Web 构建和最终差异审查；不运行页面交互测试。

## Rollback

本变更为增量模型/适配器配置，无数据库迁移。回退本任务差异即可恢复原目录和路由；已缓存图片继续走现有读取路径。无需更改密钥、其他 Provider 或分层服务。

## Open Questions

- Flash 拆图的坐标格式、基准画布、归一化尺度、底图识别及层级规则，需由接口方补充。
- 专属服务是否允许浏览器访问 v3 路由，以及真实输出、计费和限流行为，尚未调用验证。
