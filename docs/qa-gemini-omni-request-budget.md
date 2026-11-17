# Gemini Omni 视频请求体积修复（2026-11-17）

## 问题与范围

用户反馈 `gemini-omni-1.2-flash` 返回 `synchronous video request exceeds 1 MiB`。
此前也出现过 `save_task_runtime_context_failed` / `private_data` 字段超长；本次没有服务端日志，不能证明两类错误具有相同上限或均已修复。

旧逻辑允许单个 Gemini 本地素材达到 20 MiB，通用图片预处理中的 1 MiB 文件目标也未计入 Base64 膨胀、多个参考图、UTF-8 提示词和其他 JSON 字段。

## 改动

- 在 `buildTuziVideoRequest` 的 Gemini Omni 分支返回前检查完整 UTF-8 JSON，覆盖共享视频提交和主线程视频服务，包括本地缓存引用及显式多模态输入。
- 请求超过 1 MiB 时，给所有内嵌图片共同分配剩余预算，并预留 16 KiB 余量。小图片优先保留，引用顺序不变。
- 仅压缩提交副本，优先降低 JPEG 质量，必要时等比缩小，不裁切。透明区域使用白底。源图片、提示词、其他输入均不修改。
- 公网 URL 继续按 URL 传递，不增加下载或图床上传。小请求保持原样。
- “保留原图”开启时拒绝超限请求并给出操作提示。超大文本、内嵌视频或压缩后仍超限的请求在生成 POST 前失败，不自动换模型、丢弃参考素材或重试。
- 其他视频型号不经过本限制。无新增持久化字段、依赖、配置或数据库迁移。

## 验证

自动化命令：

```sh
node node_modules/vitest/vitest.mjs run --config packages/drawnix/vite.config.ts \
  packages/drawnix/src/services/gemini-omni-request-budget.test.ts \
  packages/drawnix/src/services/tuzi-video-request.test.ts \
  packages/drawnix/src/services/tuzi-video-advanced.test.ts \
  packages/drawnix/src/services/video-api-service.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/drawnix/tsconfig.lib.json --pretty false
git diff --check
```

结果：132/132 项通过；TypeScript 和差异格式检查通过。测试环境有既有 `indexedDB is not defined` 配置写入告警，不影响断言结果。

另在独立本地测试页面，通过 Chrome 真实 Canvas 编码合成的噪声 PNG，不调用付费 API：

| 场景 | 原请求字节 | 处理后字节 | 输出尺寸 |
| --- | ---: | ---: | --- |
| 单图 | 4,405,466 | 734,203 | 1200×800 |
| 两张参考图 | 3,213,765 | 784,415 | 两张均 700×500 |
| 含长中文提示词 | 2,056,924 | 842,249 | 700×500 |
| Worker / OffscreenCanvas | 4,405,466 | 734,203 | 1200×800 |
| Image / DOM Canvas 兼容路径 | 4,405,466 | 734,203 | 1200×800 |

五项均验证完整请求小于 1 MiB、输出可解码、输入对象未修改。

本轮未发起真实收费生成，未验证供应商任务受理、出片、账单或 `private_data` 错误是否消失；没有部署。浏览器验证为独立编码测试页面，不等同于完整画布流程验收。

## PR 前复核

基于 `origin/develop` 的 `d7ad7b97`（1.2.14，已包含画布 PR #342）建立独立修复分支，再次运行上述 132 项测试和 TypeScript 检查，均通过。
`node node_modules/vite/bin/vite.js build --config apps/web/vite.config.ts` 生产构建通过；`node scripts/validate-startup-bundle.js` 通过，启动预算合规且无 chunk 循环。构建保留既有 Sass 弃用和大分块提示。
