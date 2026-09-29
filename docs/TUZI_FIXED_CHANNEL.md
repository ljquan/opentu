# Tuzi 固定渠道使用与 QA

## 使用

在工作流设置点击“Tuzi 固定渠道”，添加一个或多个 API Key，点击其中一个的“使用”，然后保存。地址固定为 https://api.tu-zi.com，协议固定为 OpenAI；不自动轮换 Key。密钥按既有本地配置方式存储，输入默认隐藏。

点击“获取热门 200”按有效 hot_rank 排序，最多取 200 个；点击“获取全部模型”获取全部有效、去重的模型。进入设置、切换 Key、刷新应用不会自动请求榜单。无需向公开 pricing 接口发送 Key。

榜单的 `/api/pricing` 响应没有跨域许可头。非 Tuzi 同源部署使用宿主已有的 `/__opentu_tuzi_session__/api/pricing` 代理；请求不携带 Cookie 或 Authorization。自托管环境也需要将此前缀转发到 Tuzi，不能返回 SPA 首页。HTTP 错误、非 JSON 响应、网络失败和超时会显示具体原因，原模型列表保持不变。

获取结果先进入草稿；同名模型保留原有能力设置，可修改能力后保存。取消不应用模型草稿，失败保留原列表。列表分页并支持搜索。响应上限 20 MiB、10000 条，超时 20 秒；超限报错，不静默截断全部模式。

切换 Key 后新请求使用所选 Key，已提交视频任务保存原凭据标识并使用原 Key 查询。修改 Key 会生成新的标识；仍需恢复旧任务时请保留旧 Key，另行添加新 Key。删除原 Key 后旧任务查询会报错，不会尝试其他 Key。

JSON 配置导出排除固定渠道 Key（包括顶层镜像），导入后需重新添加。普通渠道既有导出行为保持不变。此渠道尚未接入文档批量生图的 OpenTu 托管模型桥接。榜单能力推断不能保证供应商支持具体生成参数。

## QA（2026-09-26，本地）

环境：opentu-4 当前工作区，Vitest/JSDOM，网络使用 mock，无真实付费生成。

- `pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts`：24 文件、135 测试通过；含新增 11 项 Tuzi 测试。
- 覆盖：热门排序和 200 上限、全部模式、去重、非法/空/超量列表、视频标签、公开请求不带认证、HTTP 失败、取消和超时、固定地址和当前 Key、导出脱敏、旧任务原 Key 恢复与缺失拒绝、打开不获取、保存草稿及失败保留。
- `pnpm exec tsc -p packages/drawnix/src/workflow-mode/web/tsconfig.json --noEmit`：通过。
- `pnpm nx run web:build`：通过（包含依赖构建）。
- 新编辑器、发现服务、配置存储、配置文件、视频服务 ESLint：0 错误；视频服务已有非空断言警告 1 条。
- `git diff --check`：通过。
- 未执行浏览器页面测试、真实付费生成、刷新后实际远程任务恢复；组件验证不代表供应商端到端验收。OpenSpec CLI 当前不可用，未运行严格校验。

## 维护与回滚

### 榜单跨域修复验证

- 公开接口实测：HTTP 200、665 条模型但无 `Access-Control-Allow-Origin`；本地 7204 同源代理返回 HTTP 200 和 665 条模型。
- `pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts tests/native-tuzi-discovery.test.ts tests/native-tuzi-editor.test.tsx`：2 文件、14 测试通过。
- 工作流 TypeScript 检查和应用构建通过；未执行浏览器页面测试或生产部署验收。

实现位于 workflow-mode/web 的 tuzi-channel-editor、tuzi-model-discovery、use-config-store、config-file 和 video 服务；画布元数据传递凭据标识。上游榜单字段变化时应更新解析与 mock 测试。可移除固定渠道停止使用，移除前确认无需恢复旧任务；普通渠道不受影响。
