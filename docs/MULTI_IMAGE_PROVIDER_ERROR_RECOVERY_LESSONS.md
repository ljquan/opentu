# 多图生成与供应商错误恢复经验总结

更新日期：2026-06-10

## 背景

本轮排查来自工具箱中的多图生成和任务队列失败提示。用户连续遇到两类表面相似、根因不同的问题：

1. 多图生成规划任务失败，页面显示“响应中未找到有效 JSON”。
2. 视频任务失败，任务列表直接显示 `status=403 403 Forbidden` 和一整段 Google reCAPTCHA JSON。

这两类问题都发生在 AI 供应商响应进入任务队列后，但处理方式不同：

- JSON 问题属于“模型输出/响应包裹不可解析”。
- reCAPTCHA 403 属于“供应商风控拒绝”，前端无法绕过，只能识别、提示和保留排障信息。

## 问题表现

### 1. 规划任务 JSON 解析失败

多图生成会先生成分镜/页面规划，再按页面生成图片。部分供应商返回内容时会套一层响应 envelope，例如：

- Google `candidates[].content.parts[].text`
- OpenAI-compatible `choices[].message.content[]`

如果解析器只查普通字符串，就会误判为“没有 JSON”。

### 2. 历史默认模型残留导致继续失败

默认图片模型从旧的 `gpt-image-2-vip` 切到 `gpt-image-2` 后，历史本地设置和多图记录仍可能保存旧模型。仅修改静态默认值不能覆盖已经持久化的用户本地状态。

### 3. 供应商原始错误污染任务列表

`omni-flash` 视频提交被 Google 侧返回：

```text
reCAPTCHA evaluation failed
PUBLIC_ERROR_UNUSUAL_ACTIVITY
```

旧逻辑把完整 HTTP 错误文本作为 `task.error.message` 展示，导致任务列表出现大段 JSON，用户无法判断该换模型、重试还是配置 API Key。

## 修复思路

### 1. 对规划任务主动要求 JSON

创建多图规划 CHAT 任务时，为不同协议同时透传 JSON 输出约束：

- Google: `response_mime_type: application/json`
- OpenAI-compatible: `response_format: { type: 'json_object' }`

这不能保证所有模型 100% 遵守，但能减少自然语言包裹和 markdown fence 的概率。

### 2. JSON 解析器要理解供应商 envelope

解析入口不能只看原始文本，还要从已知供应商结构中抽取文本字段：

- `candidates[].content.parts[].text`
- `choices[].message.content`
- `choices[].message.content[].text`
- `choices[].delta.content`

解析失败时不要只抛“响应中未找到有效 JSON”，应带上响应预览，方便判断是空响应、截断、自然语言还是 envelope 未兼容。

### 3. 历史默认值需要显式迁移

默认值变更必须覆盖三层：

- 静态默认：`DEFAULT_IMAGE_MODEL_ID`
- 全局设置：`gemini.imageModelName` 和默认 invocation preset
- 业务记录：多图历史记录中的 `imageModel`

迁移只处理“旧默认且没有 profile 绑定”的场景。用户显式绑定到自定义 profile 的模型选择不能被覆盖。

### 4. HTTP 错误要区分用户文案和原始详情

供应商 403/500 的原始响应通常很长，不能直接塞进任务列表。更稳的结构是：

- `message`: 面向用户的短提示
- `code`: 可用于分类的错误码
- `details.originalError`: 原始响应，供详情 tooltip 或排查使用

对 reCAPTCHA/异常流量 403，统一成：

```text
供应商风控拦截：当前视频模型触发 reCAPTCHA/异常流量校验，请换用 Seedance/Veo 其他模型或稍后重试。
```

### 5. 流式截断读取错误响应

高并发文件处理服务里，错误响应也可能很大。读取 provider error 时只读取前 1000 字预览，避免把完整响应读入内存。

## 代码层面固化的规则

### 多图生成

- 多图规划任务必须带 JSON 输出约束。
- `parseComicScriptResponse` 前必须通过共享 JSON 提取器处理供应商 envelope。
- 解析失败的 UI 文案要包含“原因 + 响应预览”，不能只显示底层异常。
- 多图记录写入前要归一化旧默认图片模型。

### 模型默认值

- 默认图片模型统一由 `getDefaultImageModel()` 提供。
- 旧默认模型迁移要使用 migration flag，避免用户手动改回后被二次覆盖。
- 旧 `gpt-image-2-vip` 只有在无 profile 绑定时才视作历史默认。

### 供应商错误

- HTTP 错误进入任务队列前要提取用户可读 message。
- reCAPTCHA/`PUBLIC_ERROR_UNUSUAL_ACTIVITY` 要归类为 `PROVIDER_RECAPTCHA_BLOCKED`。
- 这类风控错误允许重试，不应被批量视频逻辑当成参数错误永久失败。
- 原始 provider JSON 放入 `details.originalError`，不要直接显示在列表主体。

## 代码落点

- `packages/drawnix/src/components/comic-creator/ComicCreator.tsx`

  - 多图规划任务透传 JSON 输出参数。
  - 默认文本/图片模型回退到稳定模型。
  - 旧多图模型选择自动迁移到新默认。

- `packages/drawnix/src/components/comic-creator/task-sync.ts`

  - 规划响应解析失败时生成可诊断错误。

- `packages/drawnix/src/components/comic-creator/storage.ts`

  - 加载/保存多图记录时迁移旧默认图片模型。

- `packages/drawnix/src/utils/llm-json-extractor.ts`

  - 支持 Google 和 OpenAI-compatible 的响应 envelope。

- `packages/drawnix/src/utils/settings-manager.ts`

  - 全局设置和默认 preset 迁移旧图片模型。

- `packages/drawnix/src/services/media-executor/fallback-executor.ts`

  - 文本生成非 2xx 时流式读取错误预览。
  - 透传 Google / OpenAI-compatible JSON 输出参数。

- `packages/drawnix/src/services/media-api/video-api.ts`

  - 识别 reCAPTCHA/异常流量 403，输出短中文错误和原始详情。

- `packages/drawnix/src/services/task-queue-service.ts`

  - 失败任务保留 `details.originalError`。

- `packages/drawnix/src/utils/batch-video-generation.ts`
  - reCAPTCHA 风控错误保持可重试。

## 检查清单

- 多图规划任务是否仍传递 JSON 输出约束。
- JSON 提取器是否覆盖新增供应商 envelope，而不是在业务层临时解析。
- 默认模型变更是否同时覆盖静态默认、全局设置和业务记录。
- 旧默认迁移是否有 migration flag，且不会覆盖 profile 绑定的用户选择。
- 任务列表是否只展示短错误，不直接展示 provider JSON。
- 原始 provider 错误是否仍可通过详情查看。
- 403 风控错误是否保持可重试。
- 错误响应读取是否有长度上限。

## 验证建议

```bash
pnpm --dir packages/drawnix exec vitest run \
  src/components/comic-creator/storage.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/utils/llm-json-extractor.test.ts \
  src/components/comic-creator/task-sync.test.ts \
  src/components/comic-creator/utils.test.ts \
  src/services/__tests__/media-api-routing.test.ts \
  src/utils/batch-video-generation.test.ts \
  --no-file-parallelism --maxWorkers=1

pnpm --dir packages/drawnix exec tsc --noEmit --pretty false
pnpm --dir packages/drawnix exec prettier --check \
  src/components/comic-creator/storage.ts \
  src/components/comic-creator/storage.test.ts \
  src/components/comic-creator/task-sync.ts \
  src/components/comic-creator/ComicCreator.tsx \
  src/utils/settings-manager.ts \
  src/utils/settings-types.ts \
  src/utils/llm-json-extractor.ts \
  src/utils/llm-json-extractor.test.ts \
  src/services/media-executor/fallback-executor.ts \
  src/services/media-api/video-api.ts \
  src/services/task-queue-service.ts \
  src/services/__tests__/media-api-routing.test.ts \
  src/utils/batch-video-generation.ts \
  src/utils/batch-video-generation.test.ts \
  src/constants/model-config.ts
git diff --check
```

## 提交备注模板

```text
问题描述:
- 多图生成规划响应在部分供应商 envelope 下无法提取 JSON，历史默认模型残留会继续触发 403/500。
- 视频任务遇到 Google reCAPTCHA 风控 403 时，任务列表直接展示大段原始 JSON。

修复思路:
- 多图规划请求透传 JSON 输出约束，增强共享 JSON 提取器。
- 迁移旧默认图片模型到 gpt-image-2，并覆盖全局设置和多图记录。
- 将供应商 HTTP 错误拆成用户短提示和 details.originalError，识别 reCAPTCHA 风控并保持可重试。

更新代码架构:
- 设置迁移使用 migration flag，避免二次覆盖用户选择。
- 多图记录归一化收敛到 storage 层。
- 视频提交错误归一化收敛到 media-api 层，任务队列只负责展示和持久化。
```
