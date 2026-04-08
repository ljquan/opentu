## Context

现有实现已经有三类偏好存储：

- `AIInputBar` 的通用生成偏好
- 图片工具偏好
- 视频工具偏好

但这些偏好更接近“最近一次 UI 状态”，没有建立“模型 -> 参数偏好”的索引。结果是：

- 切换模型时，用户常用参数无法自动回填
- 运行时发现的多供应商同名模型可能共享错误参数
- 图片、视频、音频三条链路的行为不一致

## Goals

- 为图片、视频、音频提供统一的按模型偏好记忆能力
- 优先按 `selectionKey` 隔离不同供应商来源的同名模型
- 切换模型时自动回填用户上次使用过的兼容参数
- 与现有默认参数、强制参数、任务编辑初始化逻辑兼容

## Non-Goals

- 不同步 prompt、参考图、上传文件等高体积状态
- 不记录不兼容当前模型的参数
- 不改变任务执行 payload 的语义，只改变 UI 回填来源

## Data Model

新增一层“模型作用域偏好”存储，按生成类型拆分：

- `image`
  - key: `selectionKey || modelId`
  - value: `aspectRatio` + `extraParams`
- `video`
  - key: `selectionKey || modelId`
  - value: `duration` + `size` + `extraParams`
- `audio`
  - key: `selectionKey || modelId`
  - value: `selectedParams`

每条记录保留：

- `modelId`
- `selectionKey`
- `updatedAt`
- 参数值对象

## Precedence

模型切换或初始化时，表单值优先级应为：

1. 编辑已有任务或外部显式传入的初始值
2. 该模型的用户偏好
3. 当前模型默认参数
4. 强制参数修正逻辑

这样可以避免本地偏好覆盖任务复现、历史编辑、外部入口显式指定的参数。

## Integration Plan

### 图片

- 在模型变化时，不再直接清空到通用默认值
- 先读取该模型的图片偏好
- 回填 `aspectRatio` 和兼容 `extraParams`
- `MJ` 等特殊模型继续沿用现有兼容过滤

### 视频

- 替换当前“模型变更即重置 `duration/size`”逻辑
- 改为“先读模型偏好，再回退默认值”
- 图片上传数量、storyboard 支持能力仍按当前模型能力实时裁剪

### 音频

- 在 `AIInputBar` 的音频模式下，将 `selectedParams` 改为按模型隔离
- 切换音频模型时优先恢复该模型的上次参数
- `applyForcedSunoParams` 仍在最后阶段统一修正

## Risks

- 旧存储结构与新结构并存时，可能出现首次切换模型后的回填差异
- 若仅按 `modelId` 存储会产生串值，因此必须优先使用 `selectionKey`
- 不同模型参数集合变化频繁，必须统一走兼容性过滤，避免无效参数残留

## Verification

- 图片：两个模型分别设置不同宽高比/参数，来回切换后能正确回填
- 视频：两个模型分别设置不同 `duration/size/extraParams`，来回切换后正确回填
- 音频：不同 Suno 类模型切换时，动作和参数能分别记住
- 多供应商同名模型：验证参数不会串用
- 编辑任务：验证任务参数优先于模型偏好
