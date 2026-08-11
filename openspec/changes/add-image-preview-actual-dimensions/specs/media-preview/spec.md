## ADDED Requirements

### Requirement: 图片预览显示任务结果实际尺寸

系统 SHALL 在统一图片预览中显示当前图片任务结果的实际像素宽高，并与任务栏使用同一 `result.width` 和 `result.height` 数据源。

#### Scenario: 从任务列表打开图片预览

- **GIVEN** 已完成图片任务包含有效的结果宽高
- **WHEN** 用户从任务列表打开该图片预览
- **THEN** 预览工具栏 SHALL 显示宽 x 高
- **AND** 显示值 SHALL 与任务栏一致

#### Scenario: 从画布打开生成图片预览

- **GIVEN** 画布图片关联到包含有效结果宽高的生成任务
- **WHEN** 用户双击图片打开预览
- **THEN** 预览工具栏 SHALL 显示该任务的实际宽 x 高
- **AND** 画布缩放后的几何宽高 SHALL NOT 替代任务结果宽高

#### Scenario: 存量画布图片缺少任务关联

- **GIVEN** 当前画布图片没有生成任务 ID
- **WHEN** 用户双击该图片打开预览
- **THEN** 系统 SHALL 仅按当前图片 URL 回查已有图片任务
- **AND** 回查失败 SHALL NOT 阻止图片预览

#### Scenario: 尺寸不可用或媒体不是图片

- **GIVEN** 结果宽高缺失、非法，或当前媒体为视频或音频
- **WHEN** 用户打开媒体预览
- **THEN** 预览工具栏 SHALL NOT 显示图片尺寸
- **AND** 其他预览操作 SHALL 保持可用
