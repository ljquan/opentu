# Tuzi 供应商同步回归验收

## 效果与兼容性

已有供应商在账号同步时保留名称、API 地址、接口格式、异步图片偏好及启用状态；账号管理的凭据和计价分组仍更新。新增供应商使用默认配置和服务端状态。初始化不再因已配置 Key 而强制启用供应商，默认供应商也保留显式关闭状态。

无数据迁移和配置要求。已经被旧逻辑覆盖的用户选项无法自动恢复，需要重新设置并保存。

本修复适用于 macOS 和 Windows 的浏览器，包括 Windows Chrome、Edge。配置读取与同步使用通用 JavaScript 和浏览器存储接口，无 macOS 专属路径、快捷键或操作系统判断。

## 实际验证

环境：macOS、Node 26.8.1、pnpm 10.21.0、Vitest 3.2.4。测试使用模拟存储、账号和凭据，不调用真实生成接口。

在 `packages/drawnix` 目录运行：

```sh
pnpm exec vitest run --config vitest.config.ts src/services/__tests__/tuzi-managed-providers.test.ts src/utils/__tests__/settings-manager.test.ts
pnpm exec vitest run --config vitest.config.ts src/services/__tests__/tuzi-session-provider-sync.test.ts src/services/__tests__/tuzi-managed-route-gate.test.ts src/services/__tests__/tuzi-managed-provider-models.test.ts
pnpm exec tsc -p tsconfig.lib.json --noEmit
```

结果：5 个测试文件、37 项测试通过；类型检查通过；`git diff --check` 通过。

覆盖重复同步保留配置、凭据轮换、关闭状态在初始化和重新加载后保留、过期会话清理、临时网络失败保留配置以及模型发现和账号路由。

## 未执行与验收

未执行浏览器页面测试、全量构建、真实供应商调用及线上部署验证。既有 Workflow 全量 CI 失败不属于本次验证结果。

部署后人工验收：修改供应商名称和图片接口格式、关闭一个供应商并关闭设置窗口保存，然后刷新页面并重新打开设置，确认选项保持。账号凭据轮换后仍应使用新凭据。

Windows 验收：分别在 Chrome 和 Edge 中打开兔子控制台嵌入页面，执行上述步骤，以 Ctrl+R 刷新，再关闭并重新打开同一浏览器确认配置保留。保持相同浏览器配置文件和账号；不同浏览器的本地设置独立，不保证自动同步。当前没有真实 Windows 环境，Windows 浏览器验收待执行，不能将 macOS 上的测试通过视为 Windows 实机通过。

上述测试命令在 Windows PowerShell 同样适用，先执行 `cd packages/drawnix`，再运行各条 `pnpm` 命令。
