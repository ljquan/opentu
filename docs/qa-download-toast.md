# 下载 loading 提示关闭回归

## 范围与原因

快速下载成功或失败时，TDesign 可能在 React 18 挂载提示前收到关闭请求并忽略它。
消息封装现在在异步模块加载后的微任务中用 flushSync 完成 loading 挂载，再返回实例。
接口不变；单次关闭仍只针对该实例。此调整覆盖共享封装的 loading 调用方。

## 环境与验证

2026-09-25，macOS，Node 26.8.1、pnpm 10.21.0，已安装项目依赖。
React 18.3.1、TDesign 1.16.3，Vitest/JSDOM 使用真实消息组件，不 mock close。

- 原实现运行新增测试：3 项失败、1 项通过，复现快速成功、快速失败及并发关闭残留。
- 最终实现：2 个测试文件、11 项通过，覆盖即时成功/失败、未结束操作保持可见、并发隔离、重复关闭和原有下载工具回归。
- 文件级 ESLint、库 tsconfig.lib.json 类型检查、Git 差异检查均通过。

```sh
pnpm exec vitest run --config packages/drawnix/vite.config.ts packages/drawnix/src/utils/__tests__/message-plugin.test.ts packages/drawnix/src/utils/__tests__/download-utils.test.ts
pnpm exec eslint packages/drawnix/src/utils/message-plugin.ts packages/drawnix/src/utils/__tests__/message-plugin.test.ts
pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json
git diff origin/develop...HEAD --check
```

## 限制与验收

未执行页面测试、生产验证或完整应用构建；JSDOM 不覆盖真实浏览器的退出动画。
工具输出包含既有 NPM_TOKEN 配置占位、Node API 和缓存配置弃用及 Browserslist 数据过期警告，不影响上述通过结果。
flushSync 仅用于 loading 创建，但会同步提交 React 待处理更新；没有做性能基准。
部署后人工验收：选中缓存图片快速下载，确认文件下载且 loading 消失；失败时错误提示出现、loading 消失；并发操作的提示互不误关。
没有接口、配置、依赖或使用方式变化，故不新增 DOC；回滚可撤销本 PR。
