# Node 20 CI 基线测试修复与验证

日期：2026-10-25。关联 PR：#318，目标分支 `develop`。

## 问题与边界

远程 CI 在 `drawnix:test` 报告 54 个用例失败，以及 `ai-analyze` 套件因 mock 缺少导出无法加载。用 Node 20 在隔离的 `origin/develop`（`68f2ca1b`）快照和 PR 提交 `3ca800b5` 对比运行，54 个失败用例名称与远程逐项一致，两边结果相同。

第一阶段修复测试数据、mock、存储隔离及运行环境，不改生产模型配置、输入解析逻辑、生成接口、加密实现或部署配置。后续用户授权继续修复完整 GitHub CI，新增的 lint、入口和共享库配置变动见文末。两阶段均不增加依赖、不调用真实供应商，没有删除或新增跳过失败用例，没有放宽全局超时或屏蔽未处理异常。

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

## 第一阶段发现的后续 CI 与部署问题

- 执行 `nx affected -t lint --exclude=drawnix --base=origin/develop --verbose`，`web-e2e:lint` 无错误，`web:lint` 仍失败：713 errors / 915 warnings。范围含生成的 `public/sw.js`、第三方压缩脚本、静态调试页的环境配置和既有应用/SW 源码、Nx 模块边界问题。本次没有修改这些文件或关闭规则，不能报告完整 CI 已通过。
- Netlify 项目的部署记录为 `skipped: true`，没有运行构建；持续跳过的后台原因仍需所属团队管理员检查。测试修复不能恢复 Netlify 构建开关或授予项目权限。
- 未执行本地页面点击、视觉回归或 E2E，未做 Windows、真实供应商或生产部署验证。PR 自动触发的远程检查需单独读取状态。

## 复核与回滚

### 2026-10-25 功能回归复核

- 比较 `3ca800b5..HEAD`：CI 修复未改生产业务代码。整个 PR 的生产改动仍只在关联线插件、图片工具栏设置组件和对应样式；输入解析、视频绑定、偏好、工作区、导出和加密等关键实现与 `origin/develop` 内容哈希一致。
- 测试 Blob helper 仅被测试文件引用，在 Web bundle stats 中未发现该模块；没有修改 package/锁文件、测试配置或增加 skip/异常屏蔽。
- Node 20：25 个功能路径测试文件 `498/498` 通过，覆盖关联线、工具栏/更多菜单、引用与生图、Tuzi 图片请求及视频路由、工作区、备份、导出和账户组件。
- Node 26：完整 Drawnix 回归 `3726` 通过、`0` 失败、保留原有 `2` 跳过，退出码 `0`。测试进程使用 `NODE_OPTIONS=--no-experimental-webstorage`，由 jsdom 提供浏览器存储环境，不改变运行中的浏览器服务。
- Node 26 首轮发现 `data/image.test.ts` 的 Blob 字节断言直接调用 jsdom 未提供的 arrayBuffer；在未修改 develop 快照复现同一失败。仅补充测试读取字节时的 FileReader 兼容路径，保留原始 PNG 字节断言；图片加载实现未改。
- 图片缓存/插入测试在 Node 20、Node 26 分别 `12/12` 通过。覆盖本地缓存、原图解码失败回退、HTTP 错误、空内容、超时和临时 Blob URL 释放。
- 本轮没有执行页面点击或视觉验收。不能将上述测试视为所有供应商、Windows 或生产环境的完整验收；任务进行中手动删线后可能由原建线流程补线的已知边界仍保留。

本轮提交只影响测试文件与测试 helper。回滚这些提交即可恢复原测试设置，不需要迁移用户数据、清理配置、调整密钥或重启生产服务。原有交接文档中的早期测试数字属于当时快照，当前全量结果以本文件为准。

### 2026-10-25 远程路由测试超时复核

- GitHub Actions `40156487377`（提交 `453a8caa`）实际结果：3725 个用例通过、1 个失败、2 个原有跳过。唯一失败为 300 模型路由比较：逐项参考解析耗时约 32900ms，批量解析约 124ms，触发单例 30000ms 上限。此前本地通过不能视为远程 CI 已修复。
- 将参考比较拆为 0–99、100–199、200–299 三个独立用例。每例保留完整 300 模型目录并执行完整 300 模型批量解析；三例合计逐项比较全部 300 个结果，继续检查目录读取一次、账户读取两次和全部结果的凭据绑定。没有抽样、跳过或增加超时，不修改生产路由实现。
- Node 20 目标路由测试 `7/7` 通过；对应 ESLint、Prettier 通过。
- Node 20 在 `packages/drawnix` 执行 `node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2`：330 个文件通过、1 个原有跳过文件；3728 个用例通过、0 失败、2 个原有跳过；退出码 `0`，耗时 81.17 秒。相较此前增加的两个用例来自比较分组。
- 此次仅改测试和本 QA，生产构建输入未变。完整远程 CI、Web lint 和 Netlify 部署状态仍需分别核实，不据此宣布通过。

### 2026-10-25 完整 CI lint 修复

- 远程 `40157239312`（`e04bd459`）的测试/构建步骤及包体检查成功，后续 lint 失败；路由比较的远程超时已消除。该运行未执行后续启动、冒烟和视觉步骤，不代表主检查通过。
- Web lint 排除生成的 SW 和两个第三方分发脚本，保留应用、SW 与自维护调试源码检查。调试脚本声明浏览器 ES2020 环境及只读 JSZip；全局调用显式使用 window/globalThis，存储不可用的 catch 保留解释。
- 将现有共享备份目录声明为独立 Nx 库，消除 drawnix 反向依赖 web 的项目环。两份 JS 及两份声明与 develop 字节相同；库构建产物也与源文件字节相同，调试页相对模块 URL 不变。
- Web 改用纯类型/枚举和 security 窄入口，analytics 从启动 runtime 导出，保留编辑器及视频处理的延迟加载。模块边界规则保留，只为明确可提前加载的 runtime、核心类型/枚举、security 三个入口配置混合加载例外；调试页仅允许两个必要的相对 ESM 模块路径。
- SW 去掉仅重新抛出同一异常的外层 try/catch，保留内部超时、缓存与失败处理；预热循环改用等价的 for (;;) 写法。应用只移除两个可推导的 boolean 类型注解。
- TypeScript 别名变更使共享库也进入 affected 检查，发现 react-board/react-text 的 lint 将各自 node_modules 纳入；显式排除依赖目录。utils 两个测试文件用 vi.fn() 替换空函数，保留原断言。
- Web TypeScript 通过，备份与知识库目标测试 `8/8` 通过；直接 Web ESLint 为 `0 errors / 171 warnings`。
- 项目要求的运行时与含类型循环检查仍失败。与隔离 develop 快照比较，两份完整诊断分别逐字一致：运行时为 2 个既有环；未扩大修复无关业务环。基线的 tsconfig 尾逗号仅在隔离快照移除后运行检查；当前 tsconfig 亦使用有效 JSON。
- DOC：在 `CODING_STANDARDS.md` 记录 lint 范围、共享库构建、入口例外及别名维护。无依赖、环境变量、协议、存储格式或部署顺序变化。
- 完整 Node 20 `nx affected -t test build --base=origin/develop --verbose`：退出码 `0`，6 个项目、9 个任务成功，2 个任务命中缓存；包含 Drawnix `3728` 通过、`2` 原有跳过、组件库测试和应用/SW 构建。目标 Drawnix ESLint 通过，保留 4 个既有 any 警告。
- 与 CI 相同的 `nx affected -t lint --exclude=drawnix --base=origin/develop --verbose`：6 个项目成功，退出码 `0`，保留既有警告；没有关闭规则或新增全项目排除。
- 并行构建曾触发 10MiB 图片测试的字符串构造/编码超时；改用同样大小、同样字节的 Uint8Array 和 Node Buffer 生成预期值，保留真实 File/Blob、FileReader 路径和完整 base64 比较，没有缩小素材、跳过断言或增加超时。
- 增加 Web Vitest 配置，将已有 10 个文件的 `54` 个用例接入 Nx/CI。独立运行通过，覆盖画板同步/待写持久化、SW 图片/视频响应、缓存保留、缩略图清理屏障；其中 App 原有占位用例不作为页面功能验证证据。utils 修改涉及的 `25/25` 用例通过。
- 生产构建后执行 `node scripts/validate-startup-bundle.js` 和 `node node_modules/size-limit/bin.js` 均退出 `0`：入口无分块循环、全部大小预算通过。包体检查使用工具自带的 headless 运行器，不等同于产品页面验收。
- 本地不运行页面点击或视觉回归；远程主检查中的冒烟和视觉测试仍需最新提交的实际结果。Windows、真实供应商和生产部署未验证，Netlify 管理权限的外部阻塞保持独立。
- Web 测试接入后的最终复核：相同 `nx affected -t test build --base=origin/develop --verbose` 退出 `0`，6 个项目、10 个任务成功，4 个任务命中缓存；包含新增 `web:test` 的 `54/54`。最终 lint 和构建后的启动/包体检查再次通过。显式 fetch/merge 后 develop 仍为 `68f2ca1b`，无冲突。

### 远程大 Blob 断言超时修复

- `40158526195`（`e2767192`）中 Web `54/54`、路由分组比较与构建通过；Drawnix 为 `3727` 通过、`1` 失败、`2` 原有跳过。唯一测试失败为本地图片压缩分支 `5039ms` 超过 `5000ms`；缓存图片压缩分支也耗时 `4521ms`。独立的构建报告上传遇到 GitHub `CreateArtifact ETIMEDOUT`，不是产品构建错误。
- 计时对比确认，主要耗时来自 `toHaveBeenCalledWith` 对 10MiB File/Blob 参数的匹配。改为严格检查原对象身份、参数 `5` 和恰好调用一次；不再要求通用参数匹配器遍历大对象。保留真实 File/Blob、原图完整 base64、压缩后数据、边界大小和异步交互路径，未放宽超时。
- 目标测试 `20/20` 通过；本地两个压缩分支约 `108ms`、`16ms`，原参数匹配分别约 `927ms`、`821ms`。保留原有部分 mock，没有用替代实现绕开产品路径。
- 本轮仅修改测试断言及 QA，生产构建输入不变；没有忽略构建报告上传错误，最新远程主检查仍需实际结果确认。
