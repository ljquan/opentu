# Node 20 CI 基线测试修复与验证

日期：2026-10-25。关联 PR：#318，目标分支 `develop`。

## 问题与边界

远程 CI 在 `drawnix:test` 报告 54 个用例失败，以及 `ai-analyze` 套件因 mock 缺少导出无法加载。用 Node 20 在隔离的 `origin/develop`（`68f2ca1b`）快照和 PR 提交 `3ca800b5` 对比运行，54 个失败用例名称与远程逐项一致，两边结果相同。

本次修复测试数据、mock、存储隔离及运行环境，不改生产模型配置、输入解析逻辑、生成接口、加密实现或部署配置，不增加依赖，不调用真实供应商。没有删除或新增跳过失败用例，没有放宽全局超时或屏蔽未处理异常。

## 实现与验收

| 范围 | 修复及保留的验收 |
| --- | --- |
| AI 输入解析 | 选择器通过 options 传入模型、尺寸、数量和时长；旧 `#模型`、`-参数`、`+数量` 作为正文保留，不推断模型身份。保留默认值、文字/图片、显式类型及参数组合检查 |
| Agent | settings 和模型配置使用部分 mock，保留真实模块其他导出，继续覆盖可信画布引用快照及动态步骤传递 |
| 工作区 | 使用已有 fake-indexeddb，在每例前清空存储并重载服务缓存，验证名称为空、长度、同级重名和跨目录兼容行为 |
| 图片/音频导出及媒体路由 | 共享测试 helper 返回 jsdom Blob，避免 Node Response 与浏览器 FileReader/FormData 混用；缓存响应支持 clone。ZIP 断言检查音频实际字节内容，继续验证断网读取缓存 |
| 备份加密 | 纯加密测试在 node 环境使用真实 WebCrypto，保留错误密码拒绝、正确密码还原和密文不包含敏感原文的检查 |
| 提示词历史 | mock 实际使用的 message-plugin 封装，保留复制、保存、删除等行为断言 |
| 视频参数 | 按现行配置检查 Sora web 10 秒、Seedance 2.5 分辨率及旧偏好拆分；对应历史基线差异已在 `qa-top50-media-model-parameters.md` 记录，不改模型能力 |
| 音乐存储及工作流模块 | 补齐 KV mock 的可用性接口，避免无关 benchmark 初始化产生未处理拒绝；按实际媒体执行入口隔离构造测试的依赖 |
| Tuzi 账户组件测试 | 组件在模块收集阶段导入，避免首例承担整个组件依赖加载后超时、迟到渲染污染下一例；保留原有账户交互测试 |

## 环境与实际命令

本地 macOS，Node `20.20.2`、pnpm `10.21.0`、Vitest `3.2.4`。远程 CI 使用 Ubuntu 和 Node 20，操作系统证据独立。

在仓库根目录使用 Node 20 运行 Nx；在 `packages/drawnix` 运行以下全量测试：

```bash
node ../../node_modules/vitest/vitest.mjs run
```

- 最终全量结果：330 个测试文件通过、1 个原有跳过文件；3726 个用例通过、0 失败、2 个原有跳过；退出码 `0`，无 Vitest 未处理异常。
- Drawnix TypeScript：`pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 通过。
- 改动代码目标 ESLint：通过；保留视频配置测试和账户组件测试中的既有非空断言/any 警告。
- 新 helper 及本次重新排版文件的 Prettier、`git diff --check`：通过。其余历史长文件仅局部修改，不批量格式化。
- Node 20 执行 `nx affected -t build --base=origin/develop --verbose`：退出码 `0`，2 个受影响项目及 3 个依赖任务成功，部分未变化依赖命中缓存。utils、react-text、react-board、Drawnix、Web 类型检查、应用与 SW 构建均完成；生产构建仍有大包体、静态/动态混合导入等警告。

全量运行中同时发现并修复 KV mock 的未处理异常及首例模块加载超时；没有把 JSON 报告的“断言通过”误报为进程成功。最终结果以默认 reporter 的退出码 `0` 为准。

## 仍未解决的 CI 与部署问题

- 执行 `nx affected -t lint --exclude=drawnix --base=origin/develop --verbose`，`web-e2e:lint` 无错误，`web:lint` 仍失败：713 errors / 915 warnings。范围含生成的 `public/sw.js`、第三方压缩脚本、静态调试页的环境配置和既有应用/SW 源码、Nx 模块边界问题。本次没有修改这些文件或关闭规则，不能报告完整 CI 已通过。
- Netlify 项目的部署记录为 `skipped: true`，没有运行构建；持续跳过的后台原因仍需所属团队管理员检查。测试修复不能恢复 Netlify 构建开关或授予项目权限。
- 未执行本地页面点击、视觉回归或 E2E，未做 Windows、真实供应商或生产部署验证。PR 自动触发的远程检查需单独读取状态。

## 复核与回滚

本轮提交只影响测试文件与测试 helper。回滚这些提交即可恢复原测试设置，不需要迁移用户数据、清理配置、调整密钥或重启生产服务。原有交接文档中的早期测试数字属于当时快照，当前全量结果以本文件为准。
