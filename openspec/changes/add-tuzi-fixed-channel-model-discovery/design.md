## Context

Tuzi `https://api.tu-zi.com/api/pricing` 返回模型数组，模型记录包含 `model_name`、`hot_rank`、`hot_score` 和 `hot_call_count` 等字段。模型列表可能变化，不能在应用初始化时隐式请求或把当前榜单当成永久配置。

## Decisions

- 固定渠道用 `providerKind: 'tuzi-fixed'` 标识，内部 base URL 固定；普通渠道保持现有结构。
- 凭据使用 `credentials: [{id, label, apiKey, createdAt}]` 与 `activeCredentialId`。展示和导出时脱敏；请求只读取当前 Key。路由快照保存 channelId 与 credentialId；端点由固定渠道类型约束，不保存明文 Key 到任务元数据。
- 模型发现使用显式操作 `fetchTuziModels('hot'|'all')`。`hot` 按有效 `hot_rank` 升序取前 200；缺少有效排名的记录不进入热门模式。`all` 保留接口返回上限内的全部有效模型。
- 发现结果先进入编辑器草稿，用户保存后才写入配置。请求失败、超时或结构不合法时保留当前模型列表。
- 按现有 capability 推断规则生成初始能力，无法判断的模型默认为 text；用户可在保存前修正。

## Risks / Trade-offs

- 榜单不是供应商能力契约，本次固定渠道用于工作流本地模型；文档批量生图仍使用 OpenTu 托管模型，未新增该桥接。
- 全量列表可能很大；界面使用分页/虚拟列表，并设置响应和模型数量预算。
- 多 Key 手动选择减少隐式计费风险，但不会自动绕过失效 Key。

## Verification

- 单元测试覆盖响应解析、hot_rank 排序/前 200、全部模式、超时/非法响应、固定地址和当前 Key 选择。
- 配置组件测试覆盖未点击不发请求、失败保留旧列表、切换 Key 后新请求使用所选 Key。
