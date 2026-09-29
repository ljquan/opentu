# Change: 工作流模型选择菜单搜索

## Why

工作流模型选择菜单中的模型较多，目前需要滚动查找。用户要求在截图标出的菜单顶部增加搜索功能。

## What Changes

- 在 `ModelPicker` 下拉菜单顶部增加固定搜索框，列表滚动时仍可编辑。
- 按模型名称和渠道分组名称实时进行子串匹配，忽略大小写和关键词首尾空白。
- 提供清空按钮与“未找到匹配模型”提示；清空或重新打开菜单时显示当前能力下的完整列表。
- 保持已选模型、渠道身份、能力筛选和原有选择回调；仅点击结果或通过键盘确认结果时切换模型。
- 打开菜单聚焦搜索框，正常支持中文输入、空格、方向键选择、Enter 确认和 Escape 关闭。

## Impact

- Affected specs: `workflow-model-picker-search`。
- Primary code: `packages/drawnix/src/workflow-mode/web/src/components/model-picker.tsx`。
- Supporting code: 必要时为 `web/src/components/ui/select.tsx` 增加可选固定头部插槽，并补充现有语言文件的搜索文案。
- 所有复用 `ModelPicker` 的工作流模型选择入口获得同样的搜索能力。
- 本地筛选现有可选模型，不需要网络请求或新依赖。

## Implementation Notes

沿用现有菜单、模型图标、主题变量和行布局。在组件内维护临时搜索状态，在当前能力筛选得到的模型集合中检索展示名称及渠道名称。搜索输入与 Radix Select 的键盘跳转需要隔离，避免输入时失焦或误选；中文输入法组合期间不能触发确认。

## Status

提案待用户确认，运行代码尚未修改。
