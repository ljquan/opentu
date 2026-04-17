## 1. Spec

- [x] 1.1 补充 unified 动作模型与参数约束说明
- [x] 1.2 明确 `clip_id` 作为续写真实标识的保存规则

## 2. Data And Service

- [x] 2.1 扩展音频请求类型，支持 `infill_start_s / infill_end_s`
- [x] 2.2 扩展音乐记录类型，保存统一动作与续写参数
- [x] 2.3 在音频服务中为 `/suno/submit/music` 发送续写与 Infill 参数
- [x] 2.4 确保轮询中发现的 `clip_id` 能稳定进入最终结果

## 3. Music Analyzer UI

- [x] 3.1 在 `GeneratePage` 增加 `新生成 / 续写 / Infill` 动作切换
- [x] 3.2 根据动作展示和校验 `continueAt / infillStartS / infillEndS`
- [x] 3.3 在已生成片段卡片上增加“续写 / Infill”快捷入口
- [x] 3.4 将所选片段的真实 `clip_id` 自动带入表单

## 4. Verification

- [x] 4.1 为音频服务补充续写与 Infill 参数构造测试
- [x] 4.2 为 `clip_id` 继承逻辑补充回归测试
- [x] 4.3 手工验证统一入口下三种动作的字段显隐与校验
