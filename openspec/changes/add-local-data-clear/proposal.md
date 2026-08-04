# Change: 新增本地数据清理入口

## Why

网页当前缺少与浏览器“清除网站数据”语义一致、但不会误删登录状态和用户偏好的应用内入口。用户需要在桌面左侧工具栏底部快速清理图片缓存，或在明确确认后清除生成历史、本地文件等业务数据。

## What Changes

- 在桌面左侧工具栏最下方新增“清理网站数据”按钮，不替换现有按钮
- 提供“仅清除缓存”和“清除全部本地数据”两种模式
- “仅清除缓存”跟随现有图片缓存清理范围，并释放页面内图片对象 URL
- “清除全部本地数据”额外清理任务、工作流、聊天、素材、本地画板、知识库、角色、播放列表和专项生成记录
- 保留 Cookie、登录状态、Service Worker 注册、主题、语言、模型/API 配置、提示词隐藏记录、用户编辑覆盖值及其他用户偏好
- 存在活动任务或未同步变更时显示强化确认，但允许用户确认后继续
- 清理期间阻止旧任务、旧媒体请求和画板自动保存重新写回已删除数据
- 清理成功后刷新当前页面；任一步失败时不刷新并显示错误

## Impact

- Affected specs:
  - `local-data-clear`
- Affected code:
  - `packages/drawnix/src/components/toolbar/`
  - `packages/drawnix/src/components/local-data-clear/`
  - `packages/drawnix/src/services/local-data-clear-service.ts`
  - `packages/drawnix/src/services/unified-cache-service.ts`
  - `packages/drawnix/src/services/sw-channel/`
  - `apps/web/src/sw/`
