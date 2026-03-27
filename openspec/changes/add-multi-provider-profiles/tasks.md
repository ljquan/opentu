## 1. Data Model And Migration

- [ ] 1.1 将 `settings-manager` 从单一 `gemini` 配置扩展为 `profiles + catalogs + presets`
- [ ] 1.2 实现旧版单配置到默认 Profile/Preset 的自动迁移
- [ ] 1.3 扩展敏感信息加密逻辑以支持多个 Profile 的 API Key
- [ ] 1.4 将路由配置从 `profileId + defaultModelId` 迁移为 `defaultModelRef`

## 2. Profile-Scoped Model Discovery

- [ ] 2.1 将运行时模型发现状态改为按 `profileId` 管理
- [ ] 2.2 支持每个 Profile 独立保存 `discoveredModels` 与 `selectedModelIds`
- [ ] 2.3 为每个 Profile 记录接口能力与模型摘要
- [ ] 2.4 引入统一的 provider transport / adapter，处理模型发现路径和鉴权方式

## 3. Settings And Management UI

- [ ] 3.1 将当前设置页重构为 `供应商配置 / 默认模型预设` 两个主视图
- [ ] 3.2 实现 Profile 的新增、编辑、删除、启停、测试连接
- [ ] 3.3 将“获取模型 + 添加模型”合并为供应商详情中的“管理模型”入口，主设置页只保留摘要信息
- [ ] 3.4 在默认模型预设里提供按供应商分组的模型选择器，不再先单独选 Profile 再选模型
- [ ] 3.5 将设置中的 legacy “兼容默认模型” 区域降级为兼容入口或移除出主流程，避免与默认模型预设产生双重心智

## 4. Default Presets

- [ ] 4.1 新增 Preset 的增删改查与当前激活 Preset 状态
- [ ] 4.2 支持为文本、图片、视频分别选择默认模型引用，并自动绑定其所属供应商
- [ ] 4.3 在主界面增加当前 Preset 的切换入口与“仅作为默认值”说明
- [ ] 4.4 当用户显式选择模型时，不要求额外设置供应商路由即可完成调用

## 5. Runtime Request Resolution

- [ ] 5.1 将图片、视频、文本生成请求改为优先按当前显式选择的模型引用解析路由
- [ ] 5.2 当没有显式模型引用时，再回退到当前 Preset 默认模型与 legacy 配置
- [ ] 5.3 为不支持所需能力的 Profile 提供可见的校验与失败提示
- [ ] 5.4 确保现有模型选择器按供应商分组展示，并携带模型来源信息
- [ ] 5.5 消除仍然直接依赖 `geminiSettings` 或纯 `modelId` 的旧链路，统一到 `ModelRef -> ProviderProfile` 路由

## 6. Verification

- [ ] 6.1 补充迁移与路由解析测试
- [ ] 6.2 手工验证多 Profile 并存、模型独立管理、按模型来源调用、默认预设切换后的请求行为
