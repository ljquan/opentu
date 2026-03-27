# Change: 基于 Base URL 和 API Key 动态发现模型列表

## Why

当前设置页中的 `API Key` 和 `Base URL` 只负责保存配置，图片、视频、文本模型选择器仍然完全依赖静态常量表。
这导致当用户接入一个新的兼容服务商时，无法像 Cherry Studio、Chatbox 等客户端一样直接通过 `/v1/models` 自动发现可用模型，也无法按服务商分类浏览返回的模型。

## What Changes

- 为设置页增加“根据当前 Base URL + API Key 获取模型列表”的能力
- 新增运行时模型发现与缓存层，统一产出图片、视频、文本三类动态模型列表
- 基于 `/v1/models` 返回中的 `id`、`owned_by`、`supported_endpoint_types` 对模型做类型和厂商分类
- 让设置页和现有模型选择器优先使用动态模型列表；当发现失败或未配置时回退到静态模型表
- 保留现有手输模型 ID 的兼容能力，不阻断自定义模型使用

## Impact

- Affected specs:
  - `runtime-model-discovery`
- Affected code:
  - `packages/drawnix/src/components/settings-dialog/settings-dialog.tsx`
  - `packages/drawnix/src/components/ai-input-bar/ModelDropdown.tsx`
  - `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - `packages/drawnix/src/components/ttd-dialog/ai-image-generation.tsx`
  - `packages/drawnix/src/components/ttd-dialog/ai-video-generation.tsx`
  - `packages/drawnix/src/constants/model-config.ts`
  - `packages/drawnix/src/utils/settings-manager.ts`
  - `packages/drawnix/src/utils/` 下新增模型发现/归类模块

## Analysis

基于 `2026-03-12` 的实测：

- `https://api.tu-zi.com/v1/models` 在携带有效 Bearer Token 时会返回标准模型列表，结构为 `{"data":[...], "object":"list", "success":true}`
- `https://api.tu-zi.com/models` 不返回 JSON，而是返回站点 HTML，因此实现必须显式归一化到 `/v1/models`
- 当前设置页默认保存的是 `https://api.tu-zi.com/v1`，但用户需求描述的是“基础 base URL”，因此发现逻辑需要兼容 `https://host` 和 `https://host/v1` 两种输入
- 返回字段中没有现成的“模型类型”和“厂商中文名”，需要在前端做一层适配：
  - 模型类型：由 `supported_endpoint_types`、模型 ID 关键字共同推断
  - 厂商分类：由 `owned_by` 优先映射，必要时再回退到模型 ID 前缀/关键字映射
- 现有 `ModelDropdown` 和 `VendorTabPanel` 强依赖静态 `ModelConfig.vendor` 枚举，因此动态模型不能直接透传接口原始字段，必须先转换成内部 `ModelConfig`

本次变更默认采用“显式触发同步”而不是“输入时自动请求”的交互，以避免设置弹窗在键入过程中频繁发起网络请求。
