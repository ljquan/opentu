## Context

应用的本地数据分布在 Cache Storage、多个 IndexedDB 数据库、LocalForage store 和页面内存中。部分数据库同时保存业务历史与用户配置，因此不能通过删除整库或 `localStorage.clear()` 实现。

## Goals / Non-Goals

- Goals:
  - 提供桌面端清理入口和两档清理模式
  - 通过明确白名单删除业务数据，保留用户配置和登录状态
  - 中止活动任务后再清理，避免异步任务重新写回
  - 使用 store `clear()` 和按 key 删除，避免读取大 Blob 和内存峰值
- Non-Goals:
  - 不支持移动端或触屏布局
  - 不删除服务端数据、Cookie 或登录状态
  - 不注销 Service Worker，不清静态资源缓存和字体缓存
  - 不提供未同步数据的同步、导出或恢复能力

## Decisions

- Decision: 使用单一 `localDataClearService` 编排风险检测与清理，UI 不直接操作存储。
- Decision: “全部”模式只清业务 store/key 白名单，绝不删除含 `config` 的整库。
- Decision: 活动任务先统一阻止写回并 abort，再清空持久化 store。
- Decision: 清理图片缓存时递增缓存 epoch，丢弃清理前请求的迟到缓存写入，并释放 Service Worker 内存中的图片响应和视频 Blob。
- Decision: 本地画板作为最后一个业务存储清理，并在成功后保持写入暂停直至页面刷新，避免防抖自动保存重新落库。
- Decision: 知识库、角色、播放列表、聊天、素材和生成历史按明确 store/key 白名单清理，配置 store、提示词隐藏记录和用户编辑覆盖值不参与删除。
- Decision: Service Worker 图片缓存使用可等待结果的 `cache:clearAll` RPC，避免单向发布未被处理。
- Decision: 全部成功后调用当前页面刷新；发生部分失败时保留当前页面并提示用户重试。

## Risks / Trade-offs

- 多存储之间无法形成单个原子事务，失败时可能出现部分清理；通过失败不刷新和可重复执行降低影响。
- 强制清理会丢失未同步内容；通过风险提示和输入确认文字降低误操作概率。
- “本地文件”包含本地画板和素材，属于高破坏操作；对话框中必须明确列出。
- Service Worker 无法中止已经发出的网络请求；缓存 epoch 会阻止这些旧请求在清理完成后重新写入媒体缓存。

## Migration Plan

无需数据迁移。上线后入口仅在用户主动确认时执行；回滚时移除入口与编排服务即可，已被用户清除的数据无法自动恢复。
