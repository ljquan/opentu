## 1. Runtime Model Catalog

- [x] 1.1 为运行时模型目录增加手动添加/更新模型的方法
- [x] 1.2 手动模型写入当前 `profileId` 的 `discoveredModels`，并加入 `selectedModelIds`
- [x] 1.3 自动发现模型刷新时保留已有手动模型，避免被远端列表覆盖
- [x] 1.4 对模型 ID 做 trim、空值校验和重复处理，避免保存无效条目
- [x] 1.5 在 `ProviderCatalog.manualBindings` 保存自定义接口绑定
- [x] 1.6 manual binding 直接复用站内已有协议、请求格式、提交路径和轮询路径

## 2. Settings UI

- [x] 2.1 在供应商模型区域增加“添加自定义模型”入口
- [x] 2.2 新增轻量表单：模型 ID、模型类型、调用方式、可选显示名、可选描述
- [x] 2.3 添加成功后立即出现在当前供应商“已添加模型”列表
- [x] 2.4 移除模型时同时支持自动发现后添加的模型和手动模型
- [x] 2.5 默认提供文本、图片、视频、音频的受控接口预设
- [x] 2.6 调用方式自动带入提交路径、请求体和轮询方式，不要求用户填写模板
- [x] 2.7 增加受控的自定义 HTTP 配置：URL、Method、Body、Headers、响应字段和可选轮询

## 3. Routing Compatibility

- [x] 3.1 验证默认模型预设可选择手动模型并保存 `ModelRef`
- [x] 3.2 验证文本、图片、视频、音频入口显式选择手动模型后仍按所属供应商调用
- [x] 3.3 保持现有供应商能力开关、兼容模式和 adapter 推断不被绕过
- [x] 3.4 自定义接口绑定进入 `listSettingsModelBindings` 并优先于推断绑定
- [x] 3.5 文本和视频执行入口使用手动 binding 的 `submitPath` / `baseUrlStrategy`
- [x] 3.6 文本、图片、视频、音频入口复用原有固定模型 adapter 与响应归一化
- [x] 3.7 自定义 HTTP 手工绑定优先于 schema 偏好和异步图片偏好，且请求地址不被重写
- [x] 3.8 自定义音频支持同步 URL 或任务轮询，不依赖 Suno 固定路径

## 4. Verification

- [x] 4.1 补充 `runtime-model-discovery` 单测覆盖四类手动添加、刷新保留、同 ID 跨类型校验
- [x] 4.2 补充 settings repository 单测覆盖四类手动 binding 被 planner 选中
- [x] 4.3 补充 settings manager 单测覆盖 `manualBindings` 重载不丢失
- [x] 4.4 补充 media executor / media api routing 单测覆盖手动文本、视频路径
- [x] 4.5 补充 adapter 单测覆盖自定义图片模型根据参考图自动切换生成/编辑接口
- [x] 4.6 运行定向 Vitest 与 `drawnix:typecheck`
- [x] 4.7 运行 OpenSpec 校验；本机 `npx --yes openspec validate add-manual-provider-models --strict` 无可执行入口，已记录不可用原因
- [x] 4.8 使用本地真实 HTTP 服务验证自定义模型请求命中配置地址并携带模型、提示词和尺寸
