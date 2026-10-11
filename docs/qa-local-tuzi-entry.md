# 本地 Tuzi 直达账户入口

## 本次 PR 验证

该入口与媒体优化一并提交，目标基于官方 develop `df1715ab`（1.1.25）。最终主应用 114 项受影响回归包含凭据、同步与路由测试，Drawnix/Web 类型检查与应用/SW 构建通过。此前各批验证记录保留在下文；本次不进行真实账户 API、页面交互、付费生成或部署验收。

## 使用与边界

仅独立打开在 `localhost`、`127.0.0.1` 或 IPv6 回环地址的页面接受 `?board=<画板 ID>&id=<账户 ID>&token=<系统访问令牌>`。

启动时校验参数格式，沿用已有本地 Tuzi 凭据存储，并在 sessionStorage 保存当前标签页的凭据快照与会话标记，避免其他标签页覆盖 localStorage 后改变本页账户。消费参数后从地址栏删除 `id/token`，保留画板、其他参数、hash 与 history state；同一标签页刷新继续使用。退出会清除会话标记，账户面板替换凭据会更新本页快照。关闭标签页后重新打开可再次提供链接。非回环地址与 iframe 不消费该入口。

账户、余额和供应商配置仍经现有 Tuzi API 与本地同源代理读取。同步供应商前核验 API 返回的账户 ID 与输入 ID 一致，同一凭据在会话内复用成功核验；缓存重置、鉴权拒绝或凭据变化会重新核验。明确鉴权拒绝阻断托管路由并清理托管供应商；暂时性请求失败保留已有分组。曾成功同步且凭据/配置不变的本地账户可继续使用原配置，下次调用重新尝试同步；冷启动请求失败向调用方返回错误，不直接要求重新配置。初次账户仍在设置中的 Tuzi 账户面板选择分组。

iframe 握手、父窗口 origin 校验、内存凭据与认证协议没有改变。该入口不伪造 iframe 已认证状态，不修改画板数据、生成历史或应用版本。

## 本地验证

- Tuzi 凭据、供应商同步、托管路由、postMessage bridge 和 session API 共 61 项测试通过。
- Web 与 Drawnix 类型检查通过，相关服务 ESLint 无错误，`git diff --check` 通过。
- 本项目既有 7204 开发服务返回 HTTP 200，未重启。
- 使用 `NODE_OPTIONS=--no-experimental-webstorage` 执行测试，避免 Node 26 Web Storage 抢占 JSDOM 存储；仅该次命令生效。

```sh
cd packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config vitest.config.ts \
  src/services/__tests__/tuzi-token-auth.test.ts \
  src/services/__tests__/tuzi-session-provider-sync.test.ts \
  src/services/__tests__/tuzi-managed-route-gate.test.ts \
  src/services/__tests__/tuzi-postmessage-bridge.test.ts \
  src/services/__tests__/tuzi-session-api.test.ts
```

未执行页面自动化、真实账户 API 请求、生成请求或生产部署；测试均使用虚构凭据。未提交或推送。构建产物由主任务管理，本次仅做类型和逻辑验证。

人工验收：用有效系统访问令牌打开本地链接，确认地址栏只保留画板参数，设置可见 Tuzi 账户/余额/分组；刷新后仍有效。输入无效令牌应显示账户错误，已有普通供应商和 iframe 入口仍可使用。
