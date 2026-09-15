# Tuzi 图片 Request ID 幂等恢复接入验收文档

更新日期：2026-09-15

## 1. 问题描述

图片正式 POST 发生断网、超时或响应流中断时，客户端无法判断上游是否已经受理。直接切换节点重发会产生重复生成和重复计费；页面刷新后若丢失 Request ID，则无法继续找回原结果。

本次联动同时解决以下问题：

- OpenTu 在 POST 前持久化稳定 `submissionRequestId`，刷新后仍能继续轮询。
- Tuzi API 使用现有共享数据库提供跨节点幂等围栏，不新增第二层代理。
- 结果不明确时不切换 POST；只有 API 明确声明未受理且可重试时才安全切换。
- 恢复查询每轮优先原节点，必要时再查询共享存储可见的可信备用节点。
- 本地局域网 API 复用现有数据库，不创建虚构数据库或独立数据源。

## 2. 最终行为契约

### 2.1 正式提交

可信 Tuzi 同步图片 POST 同时满足：

```http
POST /v1/images/generations
X-Request-Id: <submissionRequestId>
```

- Request ID 在正式 POST 前与实际调用路由、binding、提交标记一起事务持久化。
- 首次提交使用任务提交身份；用户重试会生成新的提交 Request ID，旧轮询不能覆盖新任务。
- 不可信地址、第三方绝对 URL、非同步图片协议不注入该请求头，也不进入本恢复状态机。

### 2.2 POST 节点切换规则

| 原节点结果 | 是否切换 POST | 后续动作 |
| --- | --- | --- |
| 2xx 且响应完整 | 否 | 走原完成流程 |
| 网络错误、超时、响应流中断 | 否 | 结果不明确，按同 ID 查询原节点 |
| 404、5xx、HTML 或普通 429 | 否 | 保留原错误/恢复语义，不跨节点重提 |
| `accepted=false,retryable=true` | 是 | 携带同一个 `X-Request-Id` 切换可信备用节点 |
| 已存在相同幂等记录 | 否 | API 返回 `202 processing_or_existing`，客户端转结果查询 |

明确未受理响应需要同时暴露：

```http
X-Tuzi-Request-Accepted: false
X-Tuzi-Request-Retryable: true
```

响应 JSON 同步返回 `accepted`、`retryable` 和 `request_id`。客户端只以明确协议触发备用 POST，不根据单独状态码猜测。

### 2.3 恢复查询

```http
GET /v1/images/generations/result?request_id=<submissionRequestId>
X-Request-Id: <submissionRequestId>
```

- 每轮先查原配置节点。
- 原节点网络失败、429 或 5xx 时，本轮可继续查可信备用节点。
- 任一节点返回 `processing_or_not_found` 后立即结束本轮，按退避等待下一轮。
- 不发送第二次不明确的图片 POST；总截止时间沿用原图片任务 15 分钟。
- 恢复查询、远程图片缓存和终态写回共用有界并发与取消链路。

## 3. 代码架构更新

### 3.1 OpenTu

| 模块 | 职责 |
| --- | --- |
| `provider-transport.ts` | 限定 Request ID 注入范围；仅处理明确未受理的图片 POST 备用切换 |
| `image-generation-recovery-service.ts` | 原节点优先的只读轮询、备用查询、有界并发、超时与清理 |
| `tuzi-api-endpoints.ts` | 可信公网节点与显式本地节点分离；本地节点不进入公网备用集合 |
| `settings-repository.ts` | 为旧版 `legacy-default` 配置补全可持久化 profile/binding 快照 |

通用 GET/HEAD 不通过传输层自动跨节点。图片恢复服务自行控制查询顺序，避免共享层引入不可见的路由变化。

### 3.2 Tuzi API

| 模块 | 职责 |
| --- | --- |
| `image_submission_idempotency.go`（controller） | 在转发前认领提交；分类已受理、未受理、结果未知和终态 |
| `image_submission_idempotency.go`（model） | 复用 `request_billing_records` 完成跨节点原子认领与 fencing |
| `relay.go` | 将图片幂等认领接入真实 relay，并输出明确受理协议 |
| `cors.go` / `nginx-tuzi-api.conf` | 放行 `X-Request-Id`，向浏览器暴露两个 Tuzi 判定响应头 |

幂等键为：

```text
(request_id, action=image_submission, account, account_id)
```

同一账户和 Request ID 的并发请求只有一个请求获得执行权。记录只保存幂等状态，不保存请求体或生成图片，避免额外大内存和数据库膨胀。

## 4. 数据库与迁移

- 复用当前 Tuzi API 数据库及现有 `request_billing_records` 表。
- 不新增数据库、不复制业务数据、不修改图片结果存储方式。
- 当前本地数据库已存在联合唯一索引 `idx_request_billing_idem(request_id, action, account, account_id)`。
- 2026-09-15 本地完整性检查结果为 `ok`。
- 上线前必须确认所有备用 API 节点连接同一业务数据库；否则不得开启跨节点安全切换。
- SQLite 只用于本地局域网验收；生产沿用 API 站当前数据库类型与迁移机制。

## 5. QA 验收矩阵

### 5.1 自动化验证

| 范围 | 验证项 | 结果 |
| --- | --- | --- |
| OpenTu 功能开发阶段定向测试 | 恢复轮询、Provider 路由、设置快照、端点解析 | 176/176 通过 |
| Tuzi API controller | 成功、明确 429、计费不明确、网络结果未知、确定失败、重复提交响应 | 通过 |
| Tuzi API model | 重复认领、fencing record ID、8 并发唯一获胜者 | 通过 |
| Tuzi API CORS | 请求头放行和判定响应头暴露 | 通过 |
| 本地 API OPTIONS | `X-Request-Id` 预检返回 204 | 通过 |
| 本地数据库 | `PRAGMA integrity_check` | `ok` |

API 仓库完整 `go test ./controller ./model` 仍包含与本功能无关的既有失败，不把它记录为本次通过项；合并前以定向用例和 CI 差异为准。

2026-09-15 再次复核时，OpenTu 的端点与设置套件 9/9 通过；另外两个套件因当前工作树复用的依赖目录缺少 `@aitu/utils` 工作区链接而未加载，没有出现测试断言失败。依赖链接完整的 CI/标准工作区仍需再次执行四个定向套件，作为发布门禁。

### 5.2 手工验收

- [ ] 健康请求仅出现一个图片 POST，不提前出现恢复 GET。
- [ ] POST 与后续 GET 使用完全相同的 Request ID。
- [ ] 断网或 5xx 后不出现第二个图片 POST，轮询先回原节点。
- [ ] 普通 429 不切换；只有两个 Tuzi Header 分别为 `false/true` 时才切换。
- [ ] 明确未受理后备用 POST 使用同一个 Request ID，数据库只有一条对应幂等记录。
- [ ] 刷新页面后任务恢复为轮询，成功结果写回原卡片。
- [ ] 取消、删除或重试后，旧 Request ID 的迟到结果不能覆盖新任务。
- [ ] DevTools 不出现 `HeaderDisallowedByPreflightResponse`。
- [ ] 请求 URL 不出现图片同源代理路径，不产生第二层代理。
- [ ] 局域网页面只直连显式配置的本地 API；本地地址不进入公网备用列表。

## 6. 最终部署方案

部署顺序必须为“数据库检查 → API → 网关/CORS → OpenTu”，不能先发布前端。

1. 同步 Tuzi API `dev` 最新提交并解决差异。当前功能工作树比远端 `dev` 落后 2 个无关 UI 修复提交，合并前需先纳入最新基线。
2. 备份当前业务数据库，确认 `request_billing_records` 表和联合唯一索引存在；不切换数据库连接。
3. 先发布全部 Tuzi API 节点，确认它们复用当前共享数据库。
4. 发布 Nginx/API CORS 配置，放行 `X-Request-Id`，暴露 `X-Tuzi-Request-Accepted` 与 `X-Tuzi-Request-Retryable`。
5. 对每个公网节点执行 OPTIONS 预检和重复 Request ID 并发验收。
6. 再发布 OpenTu，使浏览器开始发送新请求头并启用受控切换。
7. 小流量观察重复提交率、`processing_or_existing`、明确未受理切换和恢复成功率，再全量。

本地局域网联调配置保持：

```text
OpenTu: http://<局域网IP>:4200
Tuzi API: http://<局域网IP>:18180
VITE_TUZI_EMBEDDED_MODE=true
VITE_TUZI_API_BASE_URL=http://<局域网IP>:18180
```

### CORS 发布后检查

```bash
curl -i -X OPTIONS 'https://<API节点>/v1/images/generations/result?request_id=probe' \
  -H 'Origin: https://<OpenTu站点>' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,x-request-id'
```

验收响应必须为 2xx/204，且 `Access-Control-Allow-Headers` 包含 `X-Request-Id`。真实 POST 响应还必须通过 `Access-Control-Expose-Headers` 暴露两个 Tuzi 判定头。

## 7. 回滚方案

1. 优先回滚 OpenTu，停止浏览器发送新协议和受控备用 POST。
2. API 的幂等记录逻辑可随后回滚；保留 `request_billing_records` 中既有记录不会影响旧 API，也不需要删表。
3. CORS 放行可保留，单独允许/暴露 Header 不改变旧客户端功能。
4. 回滚期间不得删除幂等记录或联合唯一索引，避免仍在途请求失去围栏。

## 8. 发布门禁

- Tuzi API 已基于最新 `origin/dev` 集成并完成 CI。
- OpenTu 在依赖链接完整的标准工作区再次通过四个定向套件。
- 所有生产节点共享同一数据库，且数据库已备份。
- 所有 API/Nginx 节点的 OPTIONS 与 Expose-Headers 验证通过。
- QA 手工验收全部完成，无重复图片 POST、重复计费或旧任务覆盖。
- OpenTu 最后发布；未完成 API/CORS 发布时禁止提前启用前端功能。
