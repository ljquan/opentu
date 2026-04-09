# Change: 工具箱插件化运行时与音乐播放器工具

## Why

当前工具箱把内置工具定义、内部组件映射、iframe 工具配置散落在多个全局文件中：

- 工具定义依赖 `built-in-tools.ts`
- 内部 React 工具依赖 `InternalToolComponents.tsx`
- 画布嵌入和弹窗打开各自做分支判断

这使得每增加一个工具，都需要同步修改多处中心化映射，难以满足“每个工具一个独立目录、像插件一样集成”的目标。

同时，仓库虽然已有画布音频节点与全局音频播放服务，但缺少一个面向素材库音频选择、后台播放和与播放控件联动的独立播放器工具。

## What Changes

- 引入统一的工具插件注册中心，收敛内置工具清单与内部组件解析
- 将内置工具重构为“每个工具一个目录”的 manifest/entry 结构
- 保留 URL 工具能力，但将其视为 `iframe` 类型工具插件
- 新增音乐播放器工具，可直接浏览素材库音频并驱动全局播放会话
- 让播放器工具与现有播放控件共享同一播放状态，并支持互相切换

## Impact

- Affected code:
  - `packages/drawnix/src/constants/built-in-tools.ts`
  - `packages/drawnix/src/services/toolbox-service.ts`
  - `packages/drawnix/src/components/toolbox-drawer/*`
  - `packages/drawnix/src/components/tool-element/*`
  - `packages/drawnix/src/components/audio-node-element/*`
  - `packages/drawnix/src/tools/**/*`
