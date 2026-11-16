# Seedream 5.0 Flash 接入说明

本功能按用户提供的《Seedream 5.0 Flash 图片生成 API 调用文档》1.0 版（2026-10-26）接入，模型为 `doubao-seedream-5-0-flash-260915`。本地代码和模拟接口测试已覆盖主要调用路径；2026-10-31 以非生成请求复现主站实际响应缺少跨域头，并验证本地同源代理能读取参数错误。真实生成、成功响应及图片回填仍需另行验收。

## 使用

1. 在现有图片模型选择中选择 **Seedream 5.0 Flash**，使用已经配置的 Provider。是否能够调用仍取决于该 Provider 的模型权限和额度。
2. 输入非空提示词，选择 `1K`、`1.5K` 或 `2K`。这些值是输出规模档位，不承诺固定正方形宽高。
3. 按需添加参考图，最多十张。普通生成每个请求只返回一张，界面的批量数量通过多个任务完成。
4. 选择 PNG/JPEG、水印和提示词优化；透明背景需要恰好一张带透明通道的 PNG 参考图，输出必须为 PNG。

本项目默认显式传入 `size:1K`、`response_format:url`、`output_format:png`、`background:opaque`、`watermark:false`。提示词优化选择“服务默认”时省略优化字段，选择“标准优化”时传入 `optimize_prompt_options.mode:standard`。这些默认设置属于客户端选择，并非推断服务默认值。

透明模式检查参考 PNG 的颜色类型/透明块和完整块边界，并在生成提交前使用浏览器图片解码器验证可读性。图片存在 alpha 通道不代表其中必定有透明像素，也不保证服务返回图片一定透明。远程参考图若因 CORS 无法读取，应下载后重新导入原始透明 PNG。

Flash 在任务执行前不经过通用参考图有损压缩，AI 输入栏和单图生成工具在选择 Flash 时也保留导入字节。此前已被压缩为 JPEG 的素材无法恢复透明度，需要重新导入。现有上传组件的 25 MiB 限制继续生效；适配器程序入口对单张内联或本地读取图片执行文档的 30 MiB 上限，公开 URL 的实际大小仍由服务端校验。

## 请求与入口

- 请求 schema：`tuzi.image.seedream-flash-json`。
- 路径：所选服务的 `POST /api/v3/images/generations`。
- 支持服务根地址及尾部 `/v1` 地址配置，通过现有 `trim-v1` 策略避免 `/v1/api/v3/...`。
- 鉴权、超时、任务观察和缓存沿用现有 Provider transport；读取参考图时不附带 Provider 密钥。
- 本地 Vite 开发页面位于 `localhost`、`127.0.0.1` 或 `[::1]` 时，主站 HTTPS 的 Flash v3 POST 复用现有 `/__opentu_tuzi_proxy__/api/` 固定目标代理。凭据归属校验与 `ch` 标记在改写地址之前完成，Authorization 继续用于所选主站请求，浏览器 Cookie 不随代理请求发送。保持同步 v3 合同，不改用 v1，也不在连接失败后直连重发。
- 该处理只作用于开发模式、上述本地页面、精确主站源及 Flash v3 路径。生产构建、LAN IP 页面、自定义供应商和其他节点保持原请求方式；线上直连仍依赖服务端在实际响应中正确返回 CORS 头。
- 兼容 AI 输入栏/工作流、任务执行器、MCP 图片工具和原生图片客户端；旧持久化的通用图片、编辑及异步图片 binding 在调用规划时归一化为 Flash v3 同步合同。
- 模型使用精确 ID 匹配。相似名称不自动继承 Flash 合同，旧 Seedream 尺寸、质量和分层路径继续按原约定执行。

程序入口可传入精确尺寸，例如 `1280x720`。必须使用小写 `x`、正整数宽高，像素数为 921600～4624220，宽高比为 1:16～16:1，边界均包含。菜单只提供三个档位；未新增自定义宽高输入控件。

请求体按允许字段构造，界面中的水印字符串转换为 JSON 布尔值，保留 `false`；旧 `quality`、`seedream_quality`、未知字段等不透传，服务不会收到 `n`。内部默认 `n:1` 省略，显式多图计数报错并提示使用批量任务。显式空提示词、非法枚举、null 配置、过多参考图、透明 JPEG、蒙版、流式和原生拆图请求在生成提交前报错。

普通生成支持 URL 或 `params.response_format:b64_json`，Base64 MIME 按产物 `output_format` 设置，验证图片签名并保留原始响应。返回 `size` 写入尺寸元数据；它是服务报告值，图片显示和验收仍以解码尺寸为准。普通生成若返回多个产物或含 `z_index` 的图层响应会被拒绝。

2026-10-27 尺寸补修：当响应没有合法的 `data[0].size` 时，Flash 复用现有图片尺寸读取函数，从返回图片读取自然像素并写入任务结果。读取失败保留已生成图片，尺寸继续显示未知，不用请求档位猜测宽高，也不重新提交生成。

对已经完成、没有尺寸记录的图片，重新打开详情时会补读原图。缓存图片只读原始缓存文件，不使用缩略图或画布显示尺寸；稳定 URL 的尺寸按元素和 URL 保存为 `imageNaturalSize`，刷新后可以复用。画板切换、图片被替换或详情关闭后不会迟到写回；不改变图片摆放尺寸和撤销历史。该部分复用 develop 已有的原图尺寸修复，并在 2026-10-27 完整合入 develop 时按内容去重。

当前本地功能分支已通过合并提交 `c77b3b6e` 完整包含 `origin/develop 5ef5e7da`，包括工具栏文字宽度、防换行、横向布局和参考连线显示设置。Flash 接入及其附加测试保留为本地未提交改动，未推送。浏览器保存的工具栏偏好继续生效；要显示紧凑图标和固定删除按钮，在设置的“图片工具栏”中勾选“删除”、关闭“显示工具文字”。

## 错误、限制与维护

Flash v3 没有在本次文档中定义结果查询协议，因此本功能不对 Flash 构造旧 `/v1/images/generations/result` 查询地址。保留响应观察和可用请求 ID；连接中断或响应无法读取时提示先核对控制台使用记录，不自动重新提交生成或切换模型。

同源代理只修复后续请求的响应读取链路，不能补回此前被浏览器拦截的响应，也不会自动恢复已失败且已计费的任务。已有图片优先从控制台对应记录取回；不要用再次生成代替结果恢复。修改后刷新本地页面即可加载新代码，无需清理画板数据或重新填写 Key。

本期未开放 Flash 自动拆图定位。文档还需明确边界框格式及坐标基准、normalized 尺度、底图识别和层级顺序，才能转换成现有画布分层合同。现有本地分层优先、Pro 兜底流程没有切换到 Flash。

关键文件：

- `packages/drawnix/src/constants/seedream-flash.ts`：精确模型、schema、路径、档位。
- `packages/drawnix/src/constants/model-config.ts`：目录与独立参数。
- `packages/drawnix/src/services/model-adapters/seedream-flash-adapter.ts`：参数校验、原始参考图、PNG alpha 检查、同步请求和结果。
- `packages/drawnix/src/services/provider-routing/`：binding 推断和旧 binding 归一化。
- `packages/drawnix/src/services/media-executor/fallback-adapter-routes.ts`：Flash 参考图保留与恢复元数据边界。
- `packages/drawnix/src/utils/gemini-api/services.ts`：原生客户端复用专属适配器。

不需要新增依赖、环境变量、数据库迁移或独立服务。回退本任务差异即可移除 Flash 接入；现有缓存图片继续由公共缓存模块读取。实际验证与基线失败记录见 [QA](./qa-seedream-5-flash.md)。
