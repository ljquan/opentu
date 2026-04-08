## 1. Architecture

- [ ] 1.1 为标准 Kling 视频定义“能力模型 + 执行版本”路由约束
- [ ] 1.2 设计标准 Kling 的 binding metadata，补齐 `versionField / defaultVersion / versionOptions / versionOptionsByAction`
- [ ] 1.3 明确标准 Kling 与 `kling-video-o1*` 的边界和排除规则

## 2. Provider Routing And Adapter Layer

- [ ] 2.1 调整 Kling binding 推断，使 `kling_video` 作为标准 Kling 视频能力入口
- [ ] 2.2 在标准 Kling binding 中声明 `model_name` 版本元数据
- [ ] 2.3 更新 Kling adapter，使其按 action 解析并校验 `model_name`
- [ ] 2.4 保持对 `kling-v1-5`、`kling-v1-6` 等历史版本型模型 ID 的兼容
- [ ] 2.5 显式排除 `kling-video-o1` 与 `kling-video-o1-edit`，避免误走标准 Kling 路由
- [ ] 2.6 在标准 Kling image2video 请求中预留 `image_tail` 透传能力
- [ ] 2.7 在标准 Kling adapter 中校验 `cfg_scale` 与 `camera_control` 的官方取值范围

## 3. UI And Parameter Exposure

- [ ] 3.1 为标准 Kling 能力模型暴露最小必要的 `model_name` 版本选择
- [ ] 3.2 保证 `duration / size / aspect_ratio` 与标准 Kling binding 元数据保持一致
- [ ] 3.3 暴露 `klingAction2 / mode / cfg_scale / negative_prompt` 参数，不阻塞主链路
- [ ] 3.4 通过平铺字段组装 `camera_control`，暂不处理 `image_tail / callback_url`
- [ ] 3.5 为 Kling 数值参数补齐 `min / max / step` 约束元数据，并同步 MCP 描述

## 4. Verification

- [ ] 4.1 验证 `kling_video` 在无参考图时走 `text2video`
- [ ] 4.2 验证 `kling_video` 在有参考图时走 `image2video`
- [ ] 4.3 验证 `text2video` 可使用 `kling-v2-6`
- [ ] 4.4 验证 `image2video` 可使用 `kling-v2-6`
- [ ] 4.5 验证历史 `kling-v1-6` 请求仍可成功映射到标准 Kling adapter
- [ ] 4.6 验证 `kling-video-o1*` 不会误走标准 Kling `/kling/v1/videos/{action}` 路由
- [ ] 4.7 验证超范围 `cfg_scale` 与非法 `camera_control` 会在提交前失败
