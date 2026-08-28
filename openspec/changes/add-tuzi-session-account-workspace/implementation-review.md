# OpenTu 本地 Tuzi 集成改动审查说明

## 1. 文档目的

本文档用于审查 `/Users/lkj/Desktop/working/opentu` 和配套 Tuzi API 工作区当前已经实现但尚未提交的 Tuzi 集成改动。

本文档只描述当前本地代码现状，不代表以下事项已经完成：

- 不代表改动已经提交、推送或创建 PR。
- 不代表已经合并最新 `upstream/develop`。
- 不代表真实 Tuzi 账户、真实模型调用和局域网浏览器流程已经全部验收。
- 不把 `.dev` 运行文件计入产品改动。
- Tuzi API 改动位于独立仓库 `/Users/lkj/Desktop/working/tuzi-api`，不属于 OpenTu 仓库的 Git 差异。

## 2. 当前 Git 状态

- 当前分支：`codex/tuzi-url-token-integration`。
- 当前分支与同名上游分支提交一致，本地功能改动位于未提交工作区。
- 已跟踪修改：10 个文件，约 508 行新增、140 行删除。
- 新增的 Tuzi 账户、Session、托管 Provider、模型同步源码和测试目前仍是未跟踪文件。
- 当前没有暂存文件。
- `.dev/opentu-dev.pid` 是本地运行产物，不应纳入功能提交。

### 配套 Tuzi API 仓库

- 仓库：`/Users/lkj/Desktop/working/tuzi-api`。
- 当前分支：`main`。
- 该仓库当前有大量其他未提交改动；下节只列出能够由 OpenTu 调用链确认属于本次集成的后端改动。
- 管理员权限、后台菜单、用户管理、支付、日志管理等其他工作区改动不纳入本次 OpenTu 集成范围。

## 3. 已实现的用户效果

### 3.1 设置入口与页面结构

- Tuzi 嵌入模式下，打开设置默认进入“Tuzi 账户”。
- 设置中提供“Tuzi 账户”和原有“供应商”等入口。
- Tuzi 账户页面分为“账户余额”和“日志”两个视图。
- 非 Tuzi 嵌入模式继续使用原有独立 Provider/API Key 配置流程。

### 3.2 账户余额与分组 Key

- 显示当前账户名称、登录状态和数据同步状态。
- 显示账户余额、已经使用的额度和请求次数。
- 显示当前账户有权限使用的 Tuzi 分组。
- 每个授权分组显示对应托管 Provider，并提供“换新 Key”操作。
- 换新 Key 明确要求后端删除旧 Token，而不是仅禁用旧 Token。
- 后端明确返回旧 Token 未删除时，前端不会把本次更换显示为成功。
- 更换成功后更新原 Provider，不新建重复 Provider。
- 更换成功后重新获取该 Provider 的全部模型并启用。

### 3.3 使用日志

- 日志由 Tuzi Session 接口读取，并按页请求。
- 当前每页显示 10 条，支持上一页、下一页、当前页和总范围显示。
- 默认列包括时间、模型、输出、详情和金额。
- 用户可通过“列设置”选择展示字段，选择结果保存在浏览器本地。
- 至少保留一个可见列，避免日志表成为空表。
- 可选字段包括渠道、用户、Token、分组、类型、调用状态、耗时、输入、IP、重试次数、Request ID 和上游 Request ID 等。
- 渠道、用户和 Token 等管理字段根据 Tuzi 账户角色开放，不默认授予普通用户。
- 点击日志行或“查看详情”后才展开该条日志的摘要详情。
- “计费过程”和原始“日志详情”JSON 在摘要展开后仍保持隐藏，需要再次点击“展开内容”才显示。
- 原始内容可以再次收起，避免大段 JSON 长期占据页面。
- 日志详情可展示请求域名、请求路径、图片或视频 URL、Request ID、Response ID、上游 Request ID、Token 数量、耗时及后端扩展字段。

### 3.4 供应商目录和开关规则

- 供应商目录拆分为“自定义供应商”和“Tuzi 账户分组”。
- “新增供应商”按钮只位于自定义供应商区域。
- Tuzi 账户自动生成的 Provider 单独显示，避免与用户手工 Provider 混淆。
- 自动生成的 Provider 复用 default Provider 的已有表单配置和能力字段，不使用空白新增供应商模板。
- default Provider 不再被硬编码为无法关闭。
- 任意 Provider 都可关闭，但系统阻止关闭最后一个启用中的 Provider。
- 存在 Tuzi 账户托管分组后，旧的内置 Tuzi Provider 会自动关闭，减少重复入口。

### 3.5 登录和账号切换同步

- 应用启动时自动同步当前 Session 的授权分组及 Provider。
- 窗口重新获得焦点、页面从后台恢复可见时再次同步。
- 点击设置中的“供应商”时重新读取当前账户 Provider，再刷新页面内数据。
- 同步请求会复用正在执行的 Promise，减少并发重复创建 Key 和重复模型发现。
- 切换 Tuzi 账号后，用新账号分组替换旧账号的托管 Provider 和 Key。
- Session 过期时清理本地托管 Provider，避免继续使用上一账号的凭据。
- Session 过期页面提供“去登录”和“重试”。重新登录后可通过同步恢复，不要求强制刷新整个页面。

### 3.6 模型自动发现

- 首次创建 Tuzi 托管 Provider 后调用 Tuzi `/v1/models`。
- 自动保存并使用接口返回的全部模型。
- 托管 Key 变化后重新请求模型列表。
- 已存在但模型目录为空的托管 Provider 会自动补全模型。
- 多个分组并行发现模型；单个分组失败不会阻止其他分组完成同步。
- Tuzi 托管 Provider 已接入模型分组、模型下拉和供应商回退选择。

### 3.7 嵌入模式配置与凭据边界

- 嵌入模式由 Vite 构建环境变量控制，URL 参数不能开启该模式。
- Tuzi API 地址由受信配置提供。
- 本地开发环境中，API 主机名会跟随当前 OpenTu 页面主机名，例如 `localhost` 和局域网 IP 保持一致。
- 公开 API 域名不会被页面主机名自动替换。
- 嵌入模式忽略 URL 中的 `settings` 和 `apiKey`，防止旧 URL 凭据覆盖当前 Session Provider。
- Session 请求使用浏览器 Cookie；OpenTu 不读取 Cookie 内容。
- 当前托管 Key 仍保存到 OpenTu 现有 Provider 本地存储，这是兼容现有调用链的已知安全取舍，并非服务端保密存储。

### 3.8 Tuzi API 后端配套改动

#### Session 认证

- Session 认证请求不再要求客户端额外提交 `New-Api-User` 或 `Rix-Api-User` 用户 ID Header。
- 旧的 access token 认证仍保留用户 ID 一致性校验，避免改变原有 API Key 调用契约。
- Session 缺失或失效时返回 HTTP 401，并在响应中提供稳定错误码 `SESSION_EXPIRED`。
- 已禁用账户返回 HTTP 403 和 `ACCOUNT_DISABLED`，不再以普通成功状态返回。
- 增加 Session 认证、旧 access token 兼容和过期状态测试。

#### OpenTu 托管 Provider 接口

- 新增 `GET /api/opentu/provider-groups`，返回当前 Session 用户可授权的分组。
- 新增 `POST /api/opentu/providers/ensure`，按当前用户授权分组自动创建或复用托管 Token。
- 新增 `POST /api/opentu/providers/:group/rotate`，为指定授权分组创建新 Token 并返回新的 Provider 信息。
- OpenTu 路由统一使用 Session 用户身份，不允许通过参数指定其他用户。
- 未授权分组返回禁止访问，不创建 Token。
- Provider 返回固定的 `tuzi-managed-*` ID、分组、显示名称、状态、轮换时间和 `sk-*` API Key。

#### 托管 Token 生命周期

- 托管 Token 使用 `OpenTu Managed / <group>` 命名，按用户和分组查找。
- 首次 ensure 时复用已有有效托管 Token，避免重复创建。
- 轮换时创建替换 Token，并删除旧的启用 Token。
- 轮换前会清理同分组其他旧 Token，包括已禁用记录。
- 轮换成功后旧 Token 不应保留为禁用记录。
- 对托管 Token 加锁，降低同一账户并发 ensure/rotate 造成重复 Token 的风险。
- 自动修复历史托管 Token 的无限额度、无限次数、未过期和启用状态。
- 达到用户 Token 数量上限时返回错误，不绕过现有 Token 限制。

#### 跨域和本地开发配置

- `TUZI_CORS_ALLOWED_ORIGINS` 用于显式配置允许携带 Cookie 的 Origin。
- 不再使用允许所有 Origin 的 credentialed CORS 配置。
- `*` 不会被当作允许携带凭据的 Origin。
- CORS 响应保留 `Access-Control-Allow-Credentials`，并返回匹配的具体 Origin。
- `SESSION_SECURE=false` 可用于本地 HTTP 开发环境；生产环境应保持安全 Cookie 配置。
- OpenTu API 路由启用 CORS 中间件，使账户、日志和托管 Provider 请求可以携带 Session Cookie。

#### 后端测试

- `middleware/auth_test.go` 覆盖 Session 无用户 ID Header、旧 access token 仍需 Header、Session 过期和禁用账户。
- `middleware/cors_test.go` 覆盖允许 Origin、拒绝未配置 Origin、禁止 wildcard credentialed CORS。
- `controller/opentu_provider_test.go` 覆盖轮换时删除旧 Token，而不是仅禁用。

## 4. 已改文件范围

### 4.1 已跟踪文件修改

| 文件 | 已实现内容 |
| --- | --- |
| `components/settings-dialog/settings-dialog.tsx` | Tuzi 账户入口、默认视图、供应商分区、进入供应商时同步、开关保护 |
| `components/settings-dialog/settings-dialog.scss` | 供应商分组布局和样式 |
| `drawnix.tsx` | 启动、窗口聚焦和页面恢复时同步 Session Provider |
| `utils/gemini-api/auth.ts` | 嵌入模式忽略 URL 凭据并选择有效 Provider |
| `utils/model-grouping.ts` | 托管 Provider 的模型分组和回退路由 |
| `utils/settings-manager.ts` | 嵌入模式设置导入和动态托管 Provider 兼容 |
| `vite-env.d.ts` | Tuzi 嵌入模式环境变量类型 |
| 3 个现有测试文件 | 模型下拉、模型分组和设置管理回归覆盖 |

### 4.2 新增源码

| 文件 | 已实现内容 |
| --- | --- |
| `components/settings-dialog/TuziAccountPanel.tsx` | 账户余额、分组 Key、分页日志、列权限及两级详情展开 |
| `components/settings-dialog/tuzi-account-panel.scss` | 账户和日志页面整体布局、响应式及折叠详情样式 |
| `components/settings-dialog/provider-toggle-utils.ts` | 最后一个启用 Provider 的关闭保护 |
| `services/tuzi-embedded-config.ts` | 嵌入模式和本地/局域网 API 地址解析 |
| `services/tuzi-session-api.ts` | Session 账户、日志、Provider ensure/rotate 接口及响应解析 |
| `services/tuzi-managed-providers.ts` | 托管 Provider 创建、更新、删除和模板复用 |
| `services/tuzi-managed-provider-models.ts` | 首次和换 Key 后自动发现全部模型 |
| `services/tuzi-session-provider-sync.ts` | Session Provider 同步编排和并发去重 |

### 4.3 新增测试

- `TuziAccountPanel.test.tsx`
- `provider-toggle-utils.test.ts`
- `tuzi-session-api.test.ts`
- `tuzi-managed-providers.test.ts`
- `tuzi-managed-provider-models.test.ts`
- `tuzi-session-provider-sync.test.ts`

### 4.4 文档

- `proposal.md`：变更原因、范围和非目标。
- `design.md`：Session、CORS、托管 Key 和 Provider 同步设计决定。
- `specs/tuzi-session-account/spec.md`：需求及场景规格。
- `tasks.md`：实施状态清单。
- `qa/2026-08-20-Tuzi账户与自动分组Provider-人工测试文档.md`：自动化证据和待人工验收场景。

### 4.5 Tuzi API 相关文件

以下文件位于 `/Users/lkj/Desktop/working/tuzi-api`：

| 文件 | 已实现内容 |
| --- | --- |
| `controller/opentu_provider.go` | 分组 Provider ensure、Token 轮换、授权分组校验 |
| `controller/opentu_provider_test.go` | 验证旧 Token 在轮换后被删除 |
| `middleware/auth.go` | Session 认证、Session 过期码、禁用账户码、旧 Token Header 兼容 |
| `middleware/auth_test.go` | Session 和 access token 认证回归测试 |
| `middleware/cors.go` | 显式 Origin allowlist 和 credentialed CORS |
| `middleware/cors_test.go` | CORS 允许、拒绝和 wildcard 测试 |
| `router/api-router.go` | OpenTu Provider 路由和 API CORS 挂载 |
| `main.go` | Session Cookie 安全配置读取 |
| `.env.example` | `SESSION_SECURE` 和 `TUZI_CORS_ALLOWED_ORIGINS` 配置说明 |
| `model/log.go` | 日志中补充调用状态和计费状态字段，供日志详情展示 |

## 5. 已执行验证

当前可确认的验证结果：

- Tuzi 账户面板定向测试：5 个测试通过。
- 最近一次 `pnpm nx run drawnix:typecheck`：通过。
- 最近一次 `git diff --check`：通过。
- 此前 Tuzi Session、托管 Provider、模型分组和设置管理定向测试已执行通过，具体覆盖范围记录在 QA 文档。
- Tuzi API 的 Session、CORS 和托管 Provider 定向测试已有代码覆盖；本轮未重新执行整个 Go 测试套件。

未将以下内容标记为已经通过：

- 真实浏览器登录和退出完整流程。
- 真实账户首次自动创建全部分组 Key。
- 后端数据库确认旧 Key 已物理删除。
- 真实文本、图片和视频模型调用。
- 账号切换后的完整浏览器无刷新流程。
- 局域网其他设备访问和 Cookie/CORS 完整验证。
- 日志页最终视觉和交互人工验收。

## 6. 审查重点与风险

1. **Key 存储边界**：托管 Key 仍保存在浏览器 Provider 设置中，可被浏览器运行环境读取。
2. **后端依赖**：自动创建和删除旧 Key 依赖 Tuzi API 对应接口语义，前端测试不能替代后端数据库验证。
3. **账号隔离**：代码会在 Session 过期或账号切换时替换托管 Provider，仍需真实双账号流程确认无旧 Key 残留。
4. **日志权限**：前端按角色隐藏管理列，但真正的数据隔离必须由后端日志接口保证。
5. **未跟踪文件**：核心新增源码和测试尚未被 Git 跟踪，后续提交时容易遗漏。
6. **分支历史**：当前分支存在功能提交及对应 revert 的历史，不适合直接形成最终 PR 历史。
7. **上游同步**：当前分支尚未整合最新 `upstream/develop`，同步后可能出现接口或设置模块冲突。
8. **运行产物**：`.dev/opentu-dev.pid` 不应提交。
9. **双仓库提交边界**：OpenTu 和 Tuzi API 是两个独立仓库，后续提交必须分别检查和提交，不能只提交 OpenTu 仓库。
10. **Tuzi API 工作区混杂改动**：`tuzi-api` 中还存在管理员权限等其他未提交改动，提交本次集成时必须按文件和功能严格筛选。

## 7. 建议审查清单

- [ ] 确认设置默认进入“Tuzi 账户”符合产品预期。
- [ ] 确认余额、已用额度、请求次数和分组信息满足展示需求。
- [ ] 确认换新 Key 必须删除旧 Key，删除失败不得显示成功。
- [ ] 确认普通用户不可见渠道、用户和 Token 等管理字段。
- [ ] 确认日志默认字段和可选字段符合 Tuzi API 页面权限。
- [ ] 确认日志摘要点击后展示，计费过程和原始 JSON 需要二次点击。
- [ ] 确认日志每页 10 条及分页交互符合预期。
- [ ] 确认自定义供应商和 Tuzi 账户分组的视觉分区。
- [ ] 确认新增供应商入口只保留在自定义供应商区域。
- [ ] 确认 default 可以关闭，但最后一个启用 Provider 不可关闭。
- [ ] 确认首次登录和换 Key 后自动获取并启用全部模型。
- [ ] 确认切换账号后无需强制刷新，并且不会继续使用旧账号 Key。
- [ ] 接受或调整浏览器本地保存托管 Key 的安全取舍。
- [ ] 确认完成真实账户、局域网、模型调用和数据库删除验证后再提交。
- [ ] 在 Tuzi API 仓库中确认只纳入 Session、CORS、OpenTu Provider 和必要日志字段改动。
- [ ] 确认 Tuzi API 其他管理员权限等本地改动不被误提交到本次功能。

## 8. 审查结论记录

- 审查结果：待审查。
- 需要调整：待填写。
- 明确不包含：数据库迁移、支付、云端画布存储，以及重写 Tuzi Relay/计费/日志系统。
- 提交、同步上游、推送和 PR：均未执行。
- Tuzi API 后端提交、同步上游、推送和 PR：均未执行。
