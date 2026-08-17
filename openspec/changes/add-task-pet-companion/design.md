# Design: 任务灵宠提醒

## Context

OpenTu 已有完整的统一任务队列、任务事件流、IndexedDB 任务持久化、设置对话框、浏览器语音合成和环境备份能力。本功能只需要读取当前标签页内的全局任务状态并展示提醒，不应新增第二套任务状态、轮询、远端通知服务或任务写入链路。

Codex 灵宠将应用状态映射为 `idle`、`running`、`waiting`、`review`、`jumping`、`failed` 等动画。首版沿用这一状态模型，但使用 OpenTu 已有兔子品牌图片配合 CSS 动作实现，不新增精灵图生成、宠物目录或自定义宠物导入能力。

## Goals / Non-Goals

- Goals:
  - 在左侧工具栏垃圾桶上方提供低干扰、持续可见的任务状态反馈
  - 支持动作、语音和文本气泡三种反馈组合
  - 支持文本、生图、生视频任务类型筛选
  - 复用统一任务队列作为唯一事实源，并正确处理并发任务
  - 偏好可恢复、可备份，异常数据安全回退
  - 保持固定的小内存占用，不读取或复制任务结果媒体
- Non-Goals:
  - 不新增服务端接口、账号级同步或系统通知权限
  - 不修改任务创建、执行、取消、重试或持久化语义
  - 不支持音频、角色和组合工作流的专项提醒
  - 不支持自定义宠物上传、宠物市场或 Codex v2 精灵图导入
  - 不生成新的灵宠图片资产

## Reuse

- `useSharedTaskState()`：获取当前任务快照，用于稳定派生活动任务状态且不播报历史任务
- `taskQueueService.observeTaskUpdates()`：增量接收任务事件，不增加轮询；终态以 `event.task.status` 为准，不依赖不完整的专用事件名
- `TaskType`、`TaskStatus`、`TaskExecutionPhase`：直接映射任务类型和执行阶段
- `ttsSettings`、`resolveVoice()`、`inferSpeechLanguage()`：沿用已有语音选择和播放参数
- 设置对话框现有导航、开关和响应式布局：新增独立“任务灵宠”页
- 左侧工具栏现有底部操作区和按钮尺寸：将灵宠入口插入垃圾桶正上方，不新增可拖拽浮层位置状态
- `AppSettings`、`settingsManager` 和现有环境备份：保存、校验、监听并备份小型非敏感偏好，不新增独立存储键
- `apps/web/public/logo-tuzi.png`：作为首版内置灵宠视觉资产

## Data Model

```ts
interface TaskPetSettings {
  version: 1;
  enabled: boolean;
  motionEnabled: boolean;
  speechEnabled: boolean;
  taskTypes: {
    text: boolean;
    image: boolean;
    video: boolean;
  };
}

interface AppSettings {
  // existing settings omitted
  taskPet: TaskPetSettings;
}
```

默认值：

- `enabled: true`
- `motionEnabled: true`
- `speechEnabled: false`
- 文本、生图、生视频均为 `true`

`settingsManager.normalizeSettings()` 只接受明确的布尔值和版本号；缺失、损坏或未来版本配置回退到默认值。写入失败只影响跨刷新持久化，不中断当前页面的灵宠状态。现有环境备份会随 `AppSettings` 自动导出和恢复该字段，无需修改备份格式或增加白名单。

任务类型映射沿用现有事实源：图片为 `TaskType.IMAGE`，视频为 `TaskType.VIDEO`，文本为 `TaskType.CHAT`。`CHAT` 还承载部分文本模型分析任务，首版统一归入“文本”提醒，不读取提示词来进一步分类。

## State Mapping

| Task state             | Pet state | Visual feedback        | Speech     |
| ---------------------- | --------- | ---------------------- | ---------- |
| task created / pending | `wave`    | 挥手并提示任务已开始   | 可播报开始 |
| submitting             | `running` | 轻快忙碌跳动           | 不重复播报 |
| processing             | `running` | 忙碌循环，气泡展示进度 | 不播报进度 |
| polling                | `waiting` | 等待摇摆               | 不重复播报 |
| downloading            | `review`  | 检查结果动作           | 不重复播报 |
| completed              | `jumping` | 完成跃起并显示结果提示 | 可播报完成 |
| failed                 | `failed`  | 短暂抖动并显示失败提示 | 可播报失败 |
| no active task         | `idle`    | 低频呼吸               | 不播报     |

进度气泡按固定区间去重，同一任务在同一区间内的更新不重复触发显著动作。取消任务只恢复到下一个活动任务或 `idle`，不进行失败语音播报。

## Event Flow

1. 灵宠组件从 `AppSettings` 加载偏好，并通过共享任务状态读取当前活动任务；初始化快照只决定稳定视觉状态，不播报历史任务。
2. 组件建立一个任务事件订阅，只处理用户已启用的文本、生图和生视频任务。
3. 事件协调器根据任务状态迁移、执行阶段和进度区间生成轻量展示事件；完成/失败从 `event.task.status` 判断。
4. UI 仅保存当前展示状态、最近任务摘要和一个自动收起计时器，不保存媒体结果或完整提示词。
5. 终态事件进入固定大小计数器，并在短窗口内合并为“多个任务完成/失败”的气泡与语音。
6. 组件卸载或功能关闭时取消订阅和计时器，并停止发起后续语音；已开始的短播报自然结束，避免全局取消操作影响其他朗读。

入口按钮占用与其他工具按钮一致的稳定尺寸。桌面端放在垃圾桶正上方；移动端沿用现有规则隐藏垃圾桶时，灵宠作为底部操作区末项。动作只变换按钮内的兔子图片，不能推动工具栏重排；提示气泡绝对定位到工具栏面向画布的一侧并限制宽度，不覆盖相邻按钮。

任务重试会复用原任务 ID，因此去重键使用任务 ID 与本次 `startedAt` 组合；同一次运行的 `taskUpdated` 与少数额外 `taskCompleted` 事件只触发一次终态反馈。

## Permissions And Boundaries

- 灵宠只读任务事件，不调用任务创建、更新、取消或重试接口，也不向展示组件暴露队列写方法。
- 语音使用浏览器 `speechSynthesis`，不使用麦克风，不申请额外权限，不上传播报内容。
- 不读取或展示任务提示词、结果 Blob、远端 URL、API Key 或供应商配置；文案只包含任务类型、状态和数量。
- 任务队列当前没有用户或画板级隔离，首版展示当前标签页内全局队列的聚合状态，不声称其属于当前画板。
- 本地偏好不包含敏感信息，并随现有 `AppSettings` 环境备份导出和恢复。
- 浏览器不支持语音或阻止自动播放时，保留文字和动作反馈，不将其视为任务失败。
- 浏览器语音合成是全局共享资源；当画布朗读或其他语音正在播放时，灵宠跳过本次播报，不调用全局 `cancel()` 打断既有音频。

## Concurrency And Performance

- 只建立一个 RxJS 订阅，不新增轮询、Worker 或远端请求。
- 非终态高频进度只比较状态和固定进度区间，不复制提示词或媒体字段，不按每帧重启动画。
- 活动任务进度记录随终态/删除事件释放；终态去重集合使用固定上限，超过后淘汰最旧运行键。
- 并发终态只使用按类型和结果计数的固定大小聚合器，不保存无界事件数组。
- 同一时刻只保留一个动画收尾计时器和一个语音计划；新终态合并到待播摘要，不形成语音队列。
- 灵宠图片只加载一次，CSS 变换不创建逐帧位图或 Canvas 缓冲区。
- 系统开启 `prefers-reduced-motion: reduce` 时停用循环位移动画，只保留静态状态和气泡。
- 灵宠位置固定在工具栏，不记录坐标、不监听拖拽事件，也不引入高频布局持久化。

## Risks / Trade-offs

- 静态图片配合 CSS 的表现力低于 Codex v2 精灵图，但能以最小资源和改动完成完整交互闭环；后续可在相同状态机上替换为精灵图。
- 浏览器语音在部分平台可能受自动播放策略限制，且与画布朗读共享资源；设置页提供明确开关，冲突时跳过播报，以无声降级保证任务流程不受影响。
- 多任务并发时只能突出一个当前状态；通过终态聚合和“最近活跃任务优先”保证提示可读，详细状态仍由任务队列承载。
- `TaskType.CHAT` 也包含部分分析任务；首版将其视作文本任务，换取不读取隐私内容、不引入新的任务分类协议。

## Migration Plan

无需业务数据迁移。旧版 `AppSettings` 缺少 `taskPet` 时由规范化逻辑补默认值；回滚时旧代码会忽略该字段，不影响其他设置。
