## Context

OpenTu 将内置模型作为默认可选目录，并把运行时发现的供应商模型合并到选择器。历史任务和已保存预设仍通过 `getModelConfig` 与 pinned model 解析模型，因此“下架”必须只影响新选择，不能删除模型身份。

模型广场的价格数据同时提供模型描述和 endpoint 元数据。Seedance 2.0 系列声明 `POST /v1/videos`，与 Seedance 1.x 的逻辑模型到分辨率模型名转换不同。

## Goals / Non-Goals

- Goals:
  - 默认入口展示已确认的九个新增模型
  - 默认入口隐藏 GPT-5.4 及以下旧模型，历史引用继续可解析
  - 最新模型排在同系列旧模型之前
  - Seedance 2.0 正确走统一异步视频接口和受控参数范围
- Non-Goals:
  - 不删除旧模型路由或历史数据
  - 不改变其他供应商 Profile 的手动模型目录
  - 不复制模型广场价格数据到静态配置
  - 不修改模型广场的模型、分组、价格、路由或 endpoint 元数据
  - 不修改 tuzi-api 代码、配置或数据库

## Decisions

- Decision: 将“默认可选目录”和“可解析模型目录”分离

  - `getStaticModelsByType` 过滤旧入口
  - `getStaticModelConfig` 仍可返回隐藏模型
  - 默认 Profile 的运行时旧模型在可选列表中继续过滤，pinned model 仍可恢复历史选择

- Decision: 新增模型保留静态展示元数据，价格和 endpoint 继续由 `/api/pricing` 缓存提供

  - 静态配置仅提供 ID、展示名、类型、默认参数和排序提示
  - 计费与 endpoint 不在 OpenTu 重复维护，且 OpenTu 不向模型广场回写任何数据

- Decision: Seedance 1.x 与 2.0 分开处理

  - 1.x 保留现有 `seedance.task` 适配器和模型名转换
  - 2.0 使用 pricing endpoint 推断的 `openai.async.video`，直接提交正式模型 ID
  - 避免把 `doubao-seedance-2-0-*` 再拼接为不存在的旧式分辨率模型名

- Decision: Seedance 2.0 参数以官方 JSON 契约为准

  - `resolution` 与 `ratio` 使用两个独立控件和请求字段，不用组合尺寸替代
  - 分辨率为 480p、720p、1080p，比例为 16:9、4:3、1:1、3:4、9:16、21:9、adaptive
  - 时长只接受 4-12 秒整数，并透传可选 `seed` 与 `camera_fixed`
  - 旧任务中的 `resolution@ratio` 组合值只作为读取兼容，不再作为新 UI 选项

- Decision: 轮询沿用共享视频 API 的有界连续错误重试和指数退避

  - 业务失败立即结束
  - 网络错误和临时 HTTP 错误最多连续重试十次，退避上限 60 秒

- Decision: Seedance 2.0 参考媒体按官方类型分别校验
  - 参考视频只接受官方声明的公网 HTTP(S) 地址
  - 参考音频接受 HTTP(S)、`asset://`、`data:audio/*;base64` 和素材 ID
  - Blob URL 仍在提交前拒绝，避免把仅浏览器本地可见的地址发给服务端
  - 音频 Data URL 必须使用小写 MIME、有效 Base64，最长 16 MiB；携带 Data URL 时只允许单任务提交，批量任务改用公网 URL 或素材 ID
  - 当前变更不新增本地音频文件上传；该能力需要独立的后端存储与上传契约

## Risks / Trade-offs

- 静态新增模型可能与运行时发现模型重复：按现有模型 ID 合并和 selection key 规则去重或保留供应商来源。
- 官方页面没有声明不同 Seedance 2.0 站内档位的参数子集；当前三个站内模型 ID 使用同一套官方参数，最终仍由上游校验具体模型能力。
- 隐藏规则只作用于默认入口；显式供应商目录仍由用户选择控制，避免越权修改其它 Profile。
- 官方没有给出素材 ID 格式或音频大小限制；本地不臆造素材 ID 前缀，16 MiB Data URL 上限属于客户端与网关的资源保护边界。
- 参考音频由用户或上游素材流程提供；大文件和批量任务优先使用 HTTP(S) 或素材 ID，避免在浏览器任务数据中重复保存大段 Base64。

## Migration Plan

1. 发布新的静态目录与隐藏规则。
2. 保留旧模型配置和所有保存数据，无需数据迁移。
3. 异常时回退新增静态条目和隐藏过滤，不涉及历史数据恢复。
