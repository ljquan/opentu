# 浏览器打开体验与内存优化：QA / 维护说明

## 2026-10-11 普通画布图片加载回退

用户反馈刷新后普通画布图片显示占位块，必须点击或等待可见性处理才加载。当前已恢复普通画布图片挂载即加载原始 URL/缓存的行为：不依赖 IntersectionObserver、不使用透明占位图，也不要求选择图片。工作流媒体按需读取、视频播放释放、Service Worker 缓存预算和 Tuzi 设置性能改动均保留。

本次自动验证：Drawnix 图片及相关 5 个测试文件共 43 项通过，Tuzi 同步、路由门控和鉴权 3 个测试文件共 30 项通过，合计 73 项。覆盖普通画布图片自动加载、缓存命中与失败回退、换源、视频封面、RetryImage、资源可见性、公共工具和 Tuzi 暂时失败/明确鉴权拒绝的兼容行为。Drawnix 类型检查和 `git diff --check` 通过。

macOS、现有依赖，自动测试使用模拟缓存、媒体和 Tuzi API，未读取真实账户或发起生成请求。复现命令：

```sh
cd packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config vitest.config.ts src/plugins/components/image.loading.test.tsx src/plugins/components/video.test.tsx src/components/retry-image.test.tsx src/contexts/AssetContext.result-visibility.test.tsx src/utils/__tests__/common.test.ts
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config vitest.config.ts src/services/__tests__/tuzi-session-provider-sync.test.ts src/services/__tests__/tuzi-managed-route-gate.test.ts src/services/__tests__/tuzi-token-auth.test.ts
cd ../..
npx tsc -p packages/drawnix/tsconfig.lib.json --noEmit
git diff --check
```

未执行浏览器页面测试、完整生产构建、真实内存采样、升级矩阵和生产部署验证。当前环境无 OpenSpec 可执行文件，`npx openspec validate optimize-browser-startup-memory --strict --no-interactive` 无法解析可执行程序，严格校验未完成。恢复自动加载会增加包含大量普通画布图片时的解码内存，这是为保证刷新后自动显示而接受的取舍。

本轮仅本地修改，未提交或推送；维护说明复用本文件，不另建 DOC。没有持久化格式、依赖或配置变更，不需要迁移或清空缓存。人工验收：刷新包含普通图片的旧画布，不点击图片即可自动显示，再验证换图、图片详情和导出。下文为此前性能优化的历史记录，其普通画布视口加载/预览和采样结果不代表回退后的行为与性能。

## PR 前最终验证

交付记录：官方草稿 PR [#300](https://github.com/ljquan/opentu/pull/300)，源 `dev/browser-startup-memory`，目标 `develop`，实现 `ad95668c`、QA `7d64d3d4`。已推送至官方功能分支；origin 为独立仓库，跨仓库创建失败后改用已有官方写权限创建同仓库 PR。未合并、未部署，远程检查与预览不等于生产兼容验收。

提交目标为官方 `ljquan/opentu` 的 `develop`，当前分支 `dev/browser-startup-memory`。已提交实现 `ad95668c` 后显式 fetch/merge，官方仍为 `df1715ab`（1.1.25），无新增冲突。此前同步时两个中英文 pending-test 文档冲突已同时保留双方记录；图片工作台自动合并保留上游参考图导入保护和本地按需媒体读取。下文各批状态与数量为历史记录，本节为最终交付依据。

- 主应用受影响的 13 个测试文件：114 项通过。
- 工作流完整配置：47 个文件，515 项通过、1 项失败。失败为 GPT Image `background=transparent` 参数校验，在隔离的官方 `df1715ab` 原始代码、同一依赖中重跑同一测试可复现；不是合并或本次媒体优化引入。隔离测试初次缺子项目依赖，补齐软链接后才获得有效复现证据。
- ReactBoard 9 项、Service Worker 31 项通过。新增媒体编辑器测试的 3 个空回调已改为 `vi.fn()`，对应 2 项测试和 lint 复查通过。
- Drawnix/ReactBoard 类型检查、完整 Web 构建（Web 类型检查、应用与 SW）、`validate-startup-bundle.js`、OpenSpec 严格校验、差异检查通过。
- `check:cycles` 返回失败：2 组运行时循环；`check:cycles:types` 返回失败：3 组含类型循环。两者输出均与隔离的官方原版完全一致，没有新增循环。
- 完整变更文件 lint 未全通过。3 个新增测试空回调错误已修复；剩余为既有代码错误与 Nx 模块边界限制。隔离官方 lint 的 Nx 规则因无缓存项目图而跳过，不能按总数认定全部规则通过。保留的既有告警/错误不夹带无关重构。

命令及环境：macOS、现有 Node/pnpm 依赖，主应用/工作流测试命令使用 `NODE_OPTIONS=--no-experimental-webstorage`；模拟媒体、IndexedDB 和 API，不执行付费生成或读取真实账户。

```sh
cd packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config vitest.config.ts src/components/retry-image.test.tsx src/contexts/AssetContext.result-visibility.test.tsx src/hooks/use-canvas-image-preview.test.tsx src/hooks/use-media-visibility.test.tsx src/plugins/components/image.loading.test.tsx src/plugins/components/video.test.tsx src/services/__tests__/workspace-cache.test.ts src/services/__tests__/tuzi-session-provider-sync.test.ts src/services/__tests__/tuzi-managed-route-gate.test.ts src/services/__tests__/tuzi-token-auth.test.ts src/stores/asset-map-store.test.ts src/utils/__tests__/common.test.ts src/hooks/__tests__/useTaskStorage-image-recovery.test.ts
cd ../..
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts
npx vitest run --config packages/react-board/vite.config.ts
npx vitest run apps/web/src/sw/*.spec.ts
npx tsc -p packages/drawnix/tsconfig.lib.json --noEmit
npx tsc -p packages/react-board/tsconfig.lib.json --noEmit
NX_DAEMON=false npx nx run web:build
node scripts/validate-startup-bundle.js
node scripts/check-cycles.js
node scripts/check-cycles.js --include-types
```

QA 与维护说明已按现有目录更新，DOC 内容合并在本文件及本地 Tuzi 入口说明；CHANGELOG、TODO 与中英文待验收已同步。无新增依赖、数据库 schema、配置变量或迁移步骤；需按原版本流程部署完整应用与匹配 SW，回滚保留已有原媒体，不清空用户存储。旧字符串 URL 兼容池未完全迁移、资产分页未实施、完整升级/离线/回滚验收未完成，因此提交草稿 PR，不将局部合成样本或本地测试作为生产发布通过证据。远程 CI/部署状态以 PR 实际检查为准。

## 审查修复后的状态

本轮在 `dev/browser-startup-memory` 本地修复审查发现的兼容问题，没有提交、推送、PR 或部署；按当前规则不执行新的页面测试。以下结果为当前修复的自动化证据，后文各批数量是历史记录。

- 视频封面点击后独立记录激活加载状态，离屏期间保留待播放；暂停、结束、加载失败或播放拒绝后可释放。真实卸载时清理播放器和自有 URL，StrictMode 重挂载恢复 source。
- 本地 Tuzi 返回可用的 ready 上下文，标签页凭据与退出/替换隔离；成功核验可复用，暂时性失败保留分组并允许相同已验证配置重试，明确鉴权拒绝不会使用旧配置。
- 原图导出/下载的缓存读取与解码失败有明确回退或错误，历史图片/音视频在任务持久化前恢复；仍有效的裁剪/转换 Blob 输入优先，失效或空 URL 按 storageKey 回退，不把有效编辑图覆盖为存储原图。3D 视口变化保留已解析图片源。
- 预览拥有自己的租用；音频图标和仅自定义封面的视频卡不读无用原媒体。租用换源、重新激活、失效和迟到读取不会返回已撤销 URL；写入快照与串行删除保护自动清理期间的新上传。
- 图片缩略图保持串行和原超时，前台上传优先于排队的历史补图；不可抢占已经开始的补图。导入、WebDAV 同步仅存文件时不创建无人消费的原媒体/预览 URL，默认返回 URL 的既有接口仍可用。
- SW 图片完成去重支持已知 sw-image-size；旧静态缓存定时清理失败会继续重试，Worker 重启后新导航也重新检查，其他旧页面存在时保留缓存。
- 保存失败的画板保留唯一脏数据，成功重试、重载或删除解除保护。仍未保存的数据可超出三画板冷缓存目标，不以淘汰造成数据丢失。

验证结果：主应用影响范围最终 114 项通过（视频共 17 项）；工作流 508 项通过、1 项原有 GPT Image transparent 参数失败；SW 31 项通过。Web/Drawnix 类型检查、生产应用/SW 构建、启动产物边界、OpenSpec 严格校验和差异检查通过。视频 ref 类型在最终构建发现并修正后重新验证；不得使用修正前的构建失败记录作为通过证据。

宿主全量使用 `NODE_OPTIONS=--no-experimental-webstorage` 并排除工作流 Web/Agent 子项目：3079 项通过、57 项失败、1 项跳过、1 条未处理异常。相同原始版本、相同依赖与命令为 3009 项通过、81 项失败、1 项跳过、相同未处理异常；逐条失败名称比较没有新增失败。未带环境选项且混用子项目配置的首次宽范围运行失败，不能用于宣称全量通过。工作区 ESLint 原版 4 个错误已复现，本轮修改涉及的保存方法将 let 改为 const 后剩 3 个原有错误；其他本轮实现无新增 lint 错误，保留既有警告。

可复现命令（仓库根目录，主应用命令注明工作目录）：

```sh
npx vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts
npx vitest run apps/web/src/sw/*.spec.ts
cd packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config vitest.config.ts --exclude 'src/workflow-mode/web/**' --exclude 'src/workflow-mode/canvas-agent/**'
```

完整升级、离线/CDN 故障、回滚及真实内存验收未完成，OpenSpec 已取消对应完成勾选。`StoredMediaUrls` 兼容池仍保护旧 API/历史/撤销保存的字符串 URL，旧版本直到显式删除仍可能占用内存；其完整迁移待完成，租用缓存预算不覆盖此池。媒体探测并发保持已确认的 1，不采用 OCR 建议增加并发，以免改变已确认预算。相关待验收与 TODO/CHANGELOG 已更新，使用/维护说明集中在本文件，不另建 DOC。

OCR 本次源审查仅 46 个文件完成、5 个文件响应或路径解析失败，不能宣称全文件 OCR 通过。修复基于逐项代码复核和实际回归；未重新请求供应商审查、真实生成或生产发布。

## 范围与状态

基于官方 develop `647e378d`（1.1.23），本地分支 `dev/browser-startup-memory`。用户授权开发后实施第一批可独立验证的优化；没有改数据库/媒体存储格式、应用升级协议、生成请求或历史数据。本批没有提交、推送或部署。

已实现：

- 普通画布图片进入视口及外扩 200px 区域后加载；离屏 2 秒用共享透明像素替换显示 source 并释放自有缓存 URL，保留 img DOM 和原图标识，选中的图片、3D 图片及遗留音频卡片保持可用。观察固定几何的 foreignObject，避免占位图改变可见区判断。IntersectionObserver 不支持时沿用原加载方式。
- 复用已存在的 large 400px 预览。显示长边乘缩放、DPR 不超过 400px 的已缓存 PNG/JPEG 可用预览；SVG、GIF、WebP/未知格式及 3D 图片继续使用原图。缓存读取失败/缺预览回退原图；只读取预览 Blob，不读取原图 body 来生成预览。预览读取最多并行 2 个，并发同源去重，离屏/换源后旧读不会创建 URL。
- `RetryImage` 默认异步解码，调用方明确传入的 decoding 仍保留。没有缩小或覆盖原媒体。
- 画布导出在克隆 DOM 前为离屏/预览图准备原始 source，优先从持久化缓存读取，支持过期远程链接已有缓存的情况。临时切为 eager 并等待原图 decode，避免引擎复制占位图的计算尺寸；导出结束或失败恢复显示 source 与 loading，最后一个并发导出结束才释放临时原图 URL。不改图片元素的 URL、尺寸、任务 ID 或提示词。
- 素材 Provider 初始化不自动扫描全库。独立 Markdown/卡片素材引用订阅会按需触发原加载流程，打开素材库仍调用原加载接口；初始化中到来的请求被保留。现有去重/内部结果隐藏规则保持。
- 普通视频有既有 poster 时先显示封面，点击后加载播放；无 poster 维持原视频路径，增加 preload=metadata，关闭/换源时暂停并释放 src 和自有 fallback URL。用户明确播放的视频离屏仍保留，暂停后可回收；音频播放实现不变。
- ReactBoard 卸载调用 ListRender.destroy，沿已有 generator 清理独立 React root；StrictMode 重挂载可重新初始化。
- 工作流各页面按路由 lazy 加载，布局保留、页面加载显示状态，深链接、路由参数、返回/前进和导航 state 保持。
- SW 视频运行时 Blob 缓存每次命中前及插入/恢复后检查 64MiB 总字节、10 条与 5 分钟 TTL。只移除内存 Map 引用，不删 Cache Storage/IndexedDB；正在响应的消费者已持有的 Blob 可继续使用。媒体 key、Range 响应实现与升级流程不变。

## 已执行命令

环境：macOS，pnpm 10.21.0、Node 26 系列，Vitest/JSDOM，构造媒体与缓存，无真实供应商调用。

```sh
cd packages/drawnix
pnpm exec vitest run --config vitest.config.ts \
  src/hooks/use-canvas-image-preview.test.tsx \
  src/hooks/use-media-visibility.test.tsx \
  src/plugins/components/image.loading.test.tsx \
  src/plugins/components/video.test.tsx \
  src/components/retry-image.test.tsx \
  src/stores/asset-map-store.test.ts \
  src/contexts/AssetContext.result-visibility.test.tsx \
  src/utils/__tests__/common.test.ts \
  src/utils/__tests__/image-3d-transform.test.ts \
  src/hooks/__tests__/useTaskStorage-image-recovery.test.ts \
  src/hooks/__tests__/useTaskExecutor-image-recovery.test.ts
```

主应用最终 104 项通过。初次组合回归中 `useTaskStorage-image-recovery` 的 24 项失败：已有 mock 没有导出 APP_DB_NAME，导入实际 recovery 模块时失败。用 `git archive HEAD` 的独立临时代码和相同依赖重新执行，复现 24 项相同失败；相关实现文件与 HEAD 无差异。只将测试 mock 改为部分模拟，保留真实导出常量，未改恢复实现；修补后 24 项通过。

```sh
pnpm exec vitest run --config packages/react-board/vite.config.ts \
  packages/react-board/src/board.spec.tsx
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts \
  packages/drawnix/src/workflow-mode/web/tests/native-router.test.tsx \
  packages/drawnix/src/workflow-mode/web/tests/native-version.test.tsx \
  packages/drawnix/src/workflow-mode/web/tests/native-storage.test.ts \
  packages/drawnix/src/workflow-mode/web/tests/native-task-recovery.test.ts
pnpm exec vitest run apps/web/src/sw/video-memory-cache.spec.ts \
  apps/web/src/sw/app-shell-routing.spec.ts
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
pnpm exec tsc -p packages/react-board/tsconfig.lib.json --noEmit
NX_DAEMON=false pnpm exec nx run web:build
node scripts/validate-startup-bundle.js
git diff --check
```

ReactBoard 9 项通过；工作流路由/版本/存储/恢复 27 项通过；SW 视频预算及壳层路由 9 项通过。共 149 项相关测试通过。新增模块 ESLint 无错误；包含 RetryImage 的最终文件检查有 1 个原有 `@nx/enforce-module-boundaries` 错误和 34 条 any、非空断言、emoji、effect 等警告，对修改前 RetryImage 源码执行同一检查复现该错误，不能称全量 lint 通过。已有 Node 26 localStorage/IndexedDB 测试环境日志、JSDOM 媒体原生方法未实现提示、Sass 弃用及混合静态/动态导入、大 chunk 构建警告独立于本批功能断言。

构建曾在新增清理回调的类型推断上失败，已明确标注 `() => void`，本次引入错误已修复；最终构建及类型结果见收尾段。应用+SW 构建包含 Web 类型检查，不执行版本升级脚本或修改版本号。

## 功能与数据兼容覆盖

| 场景 | 实际自动验证 |
| --- | --- |
| 离屏图进入/退出、短暂平移 | 组件及 hook 验证延迟释放、取消旧 timer、重新读取原 source |
| 不支持 IntersectionObserver | 保持原媒体渲染，测试通过 |
| PNG/JPEG 预览缺失或缓存失败 | 回退原图；不读取原图 body，测试通过 |
| 动画/SVG/外部签名 URL | 不改 URL，不使用扁平预览，测试通过 |
| 并发预览读取与换源/离屏 | 限制读取并发，同源去重；释放后不创建/复用旧 URL，测试通过 |
| 预览损坏及无 SW 的离屏缓存 | 损坏预览立即回退原图；离屏即使 SW 不可用也不提前读取原 Blob，进入视口后原缓存回退继续可用 |
| 离屏/低清图导出、缓存原图 | 使用原图/原缓存，显示 source 恢复，失败与并发导出引用保护，测试通过 |
| 既有视频及封面、缓存失败 | 点击封面加载，无封面 metadata 路径；原缓存 fallback/失败/重试/换源/卸载回归通过 |
| 正在播放的视频离屏 | 保持原播放器，暂停后回收，测试通过 |
| 旧卡片素材引用 | loader 支持先订阅后 Provider 初始化；重复 Provider 清理不覆盖新 loader；旧结果可见性规则通过 |
| 画布关闭及 StrictMode | destroy 和重新初始化计数、历史/viewport 原测试通过 |
| 工作流深链接及导航 | lazy 页面完成后路由参数、state 与 history 保持，测试通过 |
| 旧配置/媒体及未知结果恢复 | 原版本/存储/任务恢复测试通过，未改变持久化 schema 或生成参数 |
| SW 预算、TTL、活跃 Blob | 插入预算和过期清理、10 条 cap、正在持有的 Blob 未失效；原壳层路由测试通过 |

上述图片导出测试以 JSDOM 和模拟 toImage 验证源选择/恢复，不能代替真实 SVG/canvas 导出像素验收。没有读取用户真实数据或凭据。

## 本批限制与下一阶段

- 未执行浏览器页面测试、真实 startup trace/heap、移动端/Safari 视觉及视频解码验收；没有测得或承诺内存降低百分比。当前只能确认代码级减少非必要原媒体请求/启动扫描，以及资源清理/预算逻辑。
- 未执行两版本实际部署、多标签页旧 chunk 晚加载、更新中断/CDN 缺资源、离线升级和回滚页面验收。既有升级 waiting、静态资源版本与固定媒体缓存命名未变；“升级完全兼容”仍未获得实际证据，不能作为完整发布验收。
- 没有改工作流原媒体全量 hydrate、全项目 Zustand 持久化、Blob URL 消费者所有权、已完成图片 Response 缓存及监控释放器。没有给仍被节点 state 持有的工作流 blob URL 直接加 LRU，避免错误 revoke。
- 素材库仍沿用完整元数据加载接口，本批只延后启动扫描；有素材引用的项目仍会触发扫描，分页/按 ID 读取留到后续。
- 没有生成新的 512/1024 预览，没有扁平化 WebP/GIF/SVG；有 3D 或大尺寸图时仍读原图，实际节省量取决于画布内容。
- 临时导出会读取并解码所需原图，峰值可能增加；只在明确导出时发生，不算首屏加载优化失败。浏览器自身解码缓存的回收时间由浏览器决定，替换 source 不代表 RSS 立即下降。预算指编码 Blob 大小，不是浏览器总内存。

下一阶段先在用户允许的页面性能范围内测量，再实现工作流资源按需恢复/租用和更细资产读取。存储拆分需独立迁移兼容方案。本文件同时记录 QA 和维护方式，不另建 DOC 文件。

## 人工验收与回滚

打开包含大量图片的旧画布，平移/缩放、选择图片及查看详情；图片重新进入视口应恢复。用 PNG/JPEG、GIF、SVG、WebP 和缓存离线媒体分别检查，尤其验证整画布和选中区域导出原图清晰且无离屏缺图。播放视频后移出视口确认继续播放，暂停/关闭后再打开；检查帧选择、PPT、3D 和后台音频。含 asset:// 引用的旧文本卡片和 Markdown 编辑器仍应展示素材。

升级验收按方案 design.md 第 9 节矩阵进行；未完成前不宣称可发布。本批没有持久化格式变化，回退本批代码即可恢复原加载策略，原媒体/任务/配置仍在；回滚后应再验相同旧数据。

## 第三批收尾

第三批补齐了工作流媒体租用、按需 hydrate、历史缩略图可见性、活动播放节点保留、SW 完成图片预算、静态缓存旧标签保护和工作区未保存保护。持久化格式、storageKey、任务 ID、原图和撤销数据未改变。

新增代码验证：工作流 499 项通过、1 项失败；失败为 `native-local-models.test.ts` 的 GPT Image `background=transparent` 既有模型参数校验问题，已在原始 `647e378d` 版本复现。主应用 106 项、ReactBoard 9 项、SW 15 项通过。Drawnix/Web/ReactBoard 类型检查、应用+SW 构建和 `validate-startup-bundle.js` 通过；实现相关 ESLint 无错误，保留既有 hook/非空断言警告。

合成生产构建浏览器采样（Chrome、1280x720、同一 IndexedDB 样本，3 轮）显示：基线 24 张已解码图片、10,616,832 解码像素；优化版 13 张、5,750,784 像素，所有可见图片无坏图。优化版页面堆使用约 28.9MB，进程 RSS 约 1.0GB；基线堆约 30.0MB，进程 RSS 约 1.36GB。RSS 受浏览器共享进程、缓存和采样顺序影响，只作为该合成样本的观察值，不能外推到所有设备。首轮可操作时间未改善，后续应继续以 trace 定位启动 JS/页面初始化瓶颈。

升级兼容测试在独立 localhost 服务完成：旧 1.1.22 页面打开项目并看到 4 张可见图，候选 1.1.23 SW 在未提交前保留旧静态缓存，旧 chunk 在清理等待后仍返回 200。COMMIT_UPGRADE 后的完整离线 CDN 缺失和回滚页面交互仍未获得通过证据，因此不能宣称升级矩阵完整通过。应用未提交、推送、部署或创建 PR。

## 最终收尾

主应用 104、ReactBoard 9、工作流 27、SW 9，共 149 项相关测试通过。Drawnix 和 ReactBoard 类型检查通过，Web 完整构建（含 Web 类型检查、应用和 SW）通过；最后的图片 DOM/解码兼容调整后重新执行 Drawnix 类型检查、相关测试及应用打包，通过。最终产物 `validate-startup-bundle.js` 校验通过，无 chunk cycle；OpenSpec 严格校验与差异检查通过。

本地 7204 已存在的监听进程 cwd 为本项目 apps/web，保持该服务未重启；首页 HTTP 200。这是服务可访问检查，不是页面交互/像素/内存或升级验收。没有提交、推送、远程 CI 或部署验证。本文件同时提供 QA 与使用/维护边界。

## 第二批：工作流媒体读取和临时资源清理

继续开发后，保持第一批未提交改动，在同一 `dev/browser-startup-memory` 上增加以下实现。未修改 localforage 数据库/表名、原文件格式、节点 storageKey、生成任务 ID、应用/SW 升级协议。

### 实现与兼容边界

- 新增 `StoredMediaUrls`，供工作流图片、预览与音视频服务复用。相同 key 的并发解析只读取一次、创建一个 URL；覆盖、取消缓存或删除后旧请求不覆盖当前版本，也不迟到创建孤立 URL。
- 旧节点和撤销/历史仍直接持有 URL 字符串，因此覆盖时将旧 URL 纳入可追踪版本，保持有效；显式删除时回收这个 key 的全部版本。此处没有实现消费者租用或冷 URL LRU，旧版本可以继续占用内存，不能宣称 URL 缓存已经有界。
- 图片元数据解码最多并行 2 个，排队上传取消时立即离队；本地探测保留原 10 秒超时。远程下载及远程 URL 兼容回退仍使用原超时，不调整付费请求并发/超时。
- 图片元数据探测在成功、失败、超时或取消后清空 src、事件与 abort 监听；FileReader 转 data URL 保持取消语义，取消不会回退存储继续处理。
- 图片 API 输入只有 storageKey 而无显式 dataUrl 时直接读取 Blob 并转 data URL，不为一次 API 引用额外创建常驻 URL。显式裁剪/转换后的 dataUrl 优先保留；过期的上一会话 blob URL 只有在读取失败且有 storageKey 时回退持久化原文件，不修改原记录。
- 所有预览生成走同一串行队列，同 key 缺预览读取/补图去重，覆盖/删除标记旧工作失效；预览存储写入按 key 排序，已取消的任务不重新生成已删预览。异步预览通知失败不导致成功保存的原图被误删除。
- 缩略图解码、绘制和 WebP 编码完成或失败后 finally 关闭 ImageBitmap、清空 canvas 尺寸。整个可选预览处理起点 10 秒，超时返回无预览并释放队列；无法取消的迟到 bitmap 到达后关闭。原媒体仍可使用，不把预览失败当生成失败。
- 音视频元数据探测串行、preload=metadata，10 秒仍未得到元数据则返回原有默认尺寸或未知时长并清理播放器；不删除已存媒体，不将未知元数据当 API 失败。播放器 pause/remove src/load 释放只用于临时探测器，不影响用户的播放元素。
- 自动 unused 清理额外保护 image/video 生成日志引用及正在上传/覆盖写入的资源。并发写同 key 使用活动计数；没有扩大持久化删除范围。真正确认不再引用并删除的媒体统一释放其运行时 URL，修复原 cleanup 只删磁盘条目的遗漏。

### 本次验证

新增 3 个资源测试文件共 27 项全部通过：URL 生命周期 6、thumbnail 5、存储与取消 16。测试覆盖并发读取、当前版本保护、迟到失败/完成、删除、保留旧版本、显式删除全部版本、解码和编码异常/超时、API 引用原数据和显式变换数据、读取取消、preview 去重与删除竞争、上传保护、探测清理和历史引用。

```sh
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts \
  packages/drawnix/src/workflow-mode/web/tests/native-stored-media-urls.test.ts \
  packages/drawnix/src/workflow-mode/web/tests/native-resource-thumbnail.test.ts \
  packages/drawnix/src/workflow-mode/web/tests/native-resource-storage.test.ts
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
NX_DAEMON=false pnpm exec nx run web:build
node scripts/validate-startup-bundle.js
```

最终工作流全量 40 个测试文件：483 项通过、1 项失败，共 484 项。失败为 `native-local-models.test.ts` 中 GPT Image 设置 `background=transparent` 被现有模型参数验证拒绝。用第一批前 `git archive HEAD` 的原版本在独立临时目录、相同依赖执行该测试，复现相同失败（89 项通过、1 项失败）。该问题相关实现和测试与 HEAD 无差异，本次不夹带修复，不能宣称全量测试通过。

Drawnix 类型检查通过；本批 4 个实现模块 ESLint 无错误、7 条非空断言警告。本批没有重复运行无新变化的第一批全部测试；工作流全量回归覆盖路由、版本、存储、任务恢复、工作台和模型接口。最终应用/SW 构建及启动边界结果在以下收尾记录更新。

### 第二批历史记录（已由第三批补齐）

节点、会话和资产恢复的全量原媒体 hydrate、全局 URL 租用与字节预算、仅可见媒体恢复和内存监控冷缓存释放器已在第三批补齐；全项目持久化拆分按测量结果暂不实施。

未执行浏览器启动 trace/heap、媒体实际解码及内存下降测量；未执行旧项目真实编辑/撤销/导出、双标签同步和版本升级/回滚页面验收。测试使用模拟存储/媒体事件和合成 Blob，没有真实生成请求、用户凭据或数据。

按原格式写入，回退本批实现仍可读取这些文件及节点；回滚仍需按方案第 9 节实际数据验证。新 timeout 限制只影响可选预览和临时媒体探测，超时回退无预览或未知元数据，不裁剪历史和原文件。

第二批最终 Web 构建通过，包含 Web 类型检查、应用与 SW 构建；Drawnix 类型检查通过，最终启动边界校验通过，OpenSpec 严格校验和差异检查通过。本地 7204 首页 HTTP 200，未进行页面交互/视觉/内存验收。尚未提交、推送或部署。
