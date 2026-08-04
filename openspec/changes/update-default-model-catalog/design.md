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

## Decisions

- Decision: 将“默认可选目录”和“可解析模型目录”分离

  - `getStaticModelsByType` 过滤旧入口
  - `getStaticModelConfig` 仍可返回隐藏模型
  - 默认 Profile 的运行时旧模型在可选列表中继续过滤，pinned model 仍可恢复历史选择

- Decision: 新增模型保留静态展示元数据，价格和 endpoint 继续由 `/api/pricing` 缓存提供

  - 静态配置仅提供 ID、展示名、类型、默认参数和排序提示
  - 计费与 endpoint 不在 OpenTu 重复维护

- Decision: Seedance 1.x 与 2.0 分开处理

  - 1.x 保留现有 `seedance.task` 适配器和模型名转换
  - 2.0 使用 pricing endpoint 推断的 `openai.async.video`，直接提交正式模型 ID
  - 避免把 `doubao-seedance-2-0-*` 再拼接为不存在的旧式分辨率模型名

- Decision: 轮询沿用共享视频 API 的有界连续错误重试和指数退避

  - 业务失败立即结束
  - 网络错误和临时 HTTP 错误最多连续重试十次，退避上限 60 秒

- Decision: Seedance 2.0 参考音频和视频只提交服务端可访问地址
  - 接受 HTTP(S) 与上游 `asset://` 素材地址
  - 前端不把浏览器本地 Data URL、Blob URL 作为媒体 URL 提交
  - 当前变更不新增本地音频文件上传；该能力需要独立的后端存储与上传契约

## Risks / Trade-offs

- 静态新增模型可能与运行时发现模型重复：按现有模型 ID 合并和 selection key 规则去重或保留供应商来源。
- Seedance 2.0 更高分辨率或其它比例可能晚于模型条目上线：UI 按模型广场当前开放的 480p/720p、16:9 展示，实际服务端仍是最终校验边界。
- 隐藏规则只作用于默认入口；显式供应商目录仍由用户选择控制，避免越权修改其它 Profile。
- 参考音频地址由用户或上游素材流程提供；本地文件上传需等待可持久化且服务端可访问的媒体存储链路。

## Migration Plan

1. 发布新的静态目录与隐藏规则。
2. 保留旧模型配置和所有保存数据，无需数据迁移。
3. 异常时回退新增静态条目和隐藏过滤，不涉及历史数据恢复。
