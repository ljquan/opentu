## Context

`doubao-seedance-2-5-260628` 的 endpoint 与 Seedance 2.0 一样使用 `/v1/videos` 异步 JSON 接口，但公开元数据声明了不同的时长、比例和参考素材上限。当前实现把 Seedance 2.0 的模型前缀、参数集合和引用限制散落在多个模块中。

## Goals / Non-Goals

- Goals:
  - 让 2.5 在静态目录和运行时目录中得到一致的模型能力配置。
  - 复用已经验证的 Seedance 2 异步提交、轮询、结果下载和多模态内容编码。
  - 将 2.0/2.5 的差异限制在能力配置与模型相关校验中。
  - 防止未知的未来模型 ID 自动套用 2.5 契约。
- Non-Goals:
  - 不改动 Seedance 1.x。
  - 不在 2.5 中臆造公开 endpoint 未声明的 `seed` 或 `camera_fixed` 控件。
  - 不实现视频延长、时间戳编辑、白模控制或绿幕编辑的独立 UI；本次仅保证基础视频生成协议可用。

## Decisions

- Decision: 使用公共模型识别函数。
  - `isSeedance2ModelId` 只匹配明确的 `doubao-seedance-2-0-` 和 `doubao-seedance-2-5-` 前缀。
  - `isSeedance25ModelId` 单独识别当前 2.5 模型，用于能力边界选择。
- Decision: 保留静态模型条目。
  - 静态条目保证未完成运行时模型刷新时也能展示正确的模型和参数。
  - endpoint 与价格仍由现有 provider pricing/discovery 链路提供，不在 OpenTu 复制计费数据。
- Decision: 能力配置按版本分开。
  - 2.0 保持现有 4–12 秒、7 种比例和 3/3 引用限制。
  - 2.5 使用 4–30 秒、七种比例（含 `adaptive`）、30/10/10 引用限制；Tuzi 当前实际渠道拒绝 1–3 秒请求。
  - 2.0 保留 `resolution` 请求字段；2.5 按 Tuzi 当前公开 endpoint 元数据提交 `model`、`content`、`duration`、`ratio`、`generate_audio`、`watermark`，不发送未声明的 `resolution` 字段。
  - 2.5 不展示分辨率控件，避免用户选择被请求层静默丢弃。
- Decision: 统一迁移逻辑只处理 JSON Seedance 2 家族。
  - 历史 `resolution@ratio` 仍会拆分为 `size` 与 `ratio`。
  - 2.5 新模型不继承 2.0 的 `seed` 和 `camera_fixed` UI 参数。

## Risks / Trade-offs

- 公开 endpoint 元数据未列出 2.5 的 `resolution` 参数；客户端不展示或发送该参数。若上游后续正式声明该字段，再同步恢复能力配置与请求映射。
- 2.5 的大引用上限可能放大请求体和处理时间；继续保留音频 Data URL 16 MiB 客户端保护，并在画布引用流程中按模型上限校验。
- 新增公共识别函数会触及多个模块；通过单元测试覆盖 1.x 不匹配、2.0/2.5 匹配和未知 2.x 不自动匹配。

## Migration Plan

1. 发布静态目录、公共识别函数和 2.5 能力配置。
2. 保留历史偏好和 Seedance 2.0 旧参数兼容逻辑。
3. 运行聚焦单元测试和 TypeScript 检查。
4. 使用真实 Tuzi 凭据时验证一次提交、轮询和结果读取；无凭据时明确记录未完成真实端到端验证。
