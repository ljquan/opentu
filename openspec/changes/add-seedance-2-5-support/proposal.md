# Change: 适配 Seedance 2.5 视频模型

## Why

Tuzi 已上线 `doubao-seedance-2-5-260628`。它与现有 Seedance 2.0 使用相同的异步视频 JSON 协议和多模态 `content` 结构，但能力边界不同，当前 OpenTu 会把它当作普通运行时视频模型，无法稳定走 Seedance 适配器。

## What Changes

- 将 `doubao-seedance-2-5-260628` 纳入静态模型目录和视频模型配置。
- 让 Seedance 2.0 与 2.5 共用异步 JSON 协议路由、任务轮询和多模态内容编码。
- 为 Seedance 2.5 独立配置 4–30 秒时长和 9:16/16:9/1:1 比例；不展示或发送当前 endpoint 未声明的分辨率参数。
- 为 Seedance 2.5 支持最多 30 张图片、10 段视频和 10 段音频参考，并保留音频 Data URL 资源保护。
- 将散落的 2.0 前缀判断收敛为公共模型识别函数，覆盖参数迁移、工作流、画布引用、适配器和 provider binding。
- 为 2.5 增加路由、参数、提交请求和引用数量回归测试。

## Impact

- Affected specs:
  - `runtime-model-discovery`
  - `provider-routing`
- Affected code:
  - `packages/drawnix/src/utils/seedance-model.ts`
  - `packages/drawnix/src/constants/model-config.ts`
  - `packages/drawnix/src/constants/video-model-config.ts`
  - `packages/drawnix/src/types/video.types.ts`
  - Seedance 适配器、provider routing、AI 输入栏和偏好存储相关模块

## Compatibility

- Seedance 1.x 路由与模型名转换保持不变。
- Seedance 2.0 现有参数和历史偏好保持不变。
- 不修改 tuzi-api、价格、分组或后端模型配置。
