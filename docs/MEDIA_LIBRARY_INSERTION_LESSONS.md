# 素材库插入画布经验总结

这份文档沉淀 2026-04-22 这轮“素材库点击插入无响应”的排查与修复经验，重点不是复盘某一个按钮，而是明确一条规则：

- “打开素材库浏览”
- “打开素材库并选择后插入画布”

这两个动作在产品语义和代码语义上都不能混用。

## 一、问题现象

用户在画布页通过左侧工具栏或快捷工具栏打开素材库后，点击“插入”没有插入到画布，也没有明显反馈。

表面看像是“插入逻辑失效”，但真实原因是两层问题叠加：

- 工具栏入口想打开的是 `SELECT` 模式素材库
- 实际打开的是全局默认 `BROWSE` 模式素材库
- 即使走到 `onSelect`，素材库内部也没有等待异步插入完成，失败和卡顿都被伪装成“没反应”

## 二、根因

### 1. 全局素材库默认是 `BROWSE`，但画布入口需要 `SELECT`

画布页工具栏和快捷工具栏并不总是打开自身维护的 `MediaLibraryModal`，当父层传入 `onOpenMediaLibrary` 时，会改为打开 `drawnix.tsx` 里统一管理的全局素材库。

而全局素材库原来只接收：

- `isOpen`
- `onClose`

没有接收：

- `mode`
- `filterType`
- `onSelect`
- `selectButtonText`

结果就是：

- 入口想要“插入画布”
- 实际打开成了“浏览素材”
- 用户看见的是素材库开了，但插入语义丢了

经验：

- “统一弹窗管理”不能只统一开关状态
- 还必须统一携带“打开语义”
- 否则很容易出现入口 A 和入口 B 打开的是同一个弹窗壳，但行为完全不一致

### 2. 异步选择动作不能先关窗再说

原来的 `MediaLibraryModal` 在双击素材或点击“使用”按钮时是这样执行的：

- `onSelect(asset)`
- `onClose()`

这里最大的问题是 `onSelect` 允许异步，但弹窗不等待结果。

后果：

- 插入慢时，用户看到弹窗先消失，但画布没变化
- 插入失败时，错误反馈晚于关窗，用户会误以为“没点上”
- 如果中途 pending，很容易被误判成点击失效

经验：

- 只要动作会改动画布、网络、缓存、解码资源，就应视为异步事务
- 弹窗不能在事务开始后立刻关闭
- 必须等待完成，再关闭或给失败反馈

## 三、这次修法

### 1. 给全局素材库增加“打开配置”

这次把全局素材库状态从单纯的 `boolean` 扩成了“开关 + 配置”：

- `mode`
- `filterType`
- `onSelect`
- `selectButtonText`

这样不同入口可以明确表达自己的意图：

- 缓存清理入口：`BROWSE`
- 画布插入入口：`SELECT + onSelect`

经验：

- 全局弹窗状态不要只存 `visible`
- 还要存“这个弹窗是为谁、以什么模式打开的”

### 2. 工具栏入口显式传入 `SELECT`

画布左侧工具栏和快捷工具栏现在打开素材库时，会显式传：

- `mode: SelectionMode.SELECT`
- `onSelect: handleInsertAsset`
- `selectButtonText: '插入'`

这样不会再依赖全局默认值。

经验：

- 入口的行为语义，必须在入口处声明
- 不能靠下游组件默认值“猜”

### 3. 素材库等待插入完成后再关闭

`MediaLibraryModal` 里的双击和“使用”按钮，现在改成：

- 设置 `isSelecting`
- `await onSelect(asset)`
- 成功后再 `onClose()`

同时：

- “插入”按钮显示 loading
- loading 时禁止重复点击
- 卸载后通过 `isMountedRef` 防止无意义的状态回写

经验：

- 交互上要把“正在插入”显式呈现出来
- 这不仅是体验问题，也是排障问题
- 用户可见的 loading，本质上是运行时可观测性的一部分

## 四、这次沉淀出的规则

### 规则 1：弹窗统一管理时，必须保留入口语义

不要只抽象：

- `openXxxModal()`

要抽象成：

- `openXxxModal(config)`

至少要能带：

- 模式
- 回调
- 文案
- 筛选条件

### 规则 2：`BROWSE` 和 `SELECT` 是两种产品态，不是一个小参数

`BROWSE` 表示：

- 查看
- 管理
- 下载
- 删除

`SELECT` 表示：

- 选中后回传
- 触发上游业务动作
- 按上游场景展示按钮文案

经验：

- 如果一个组件同时承载两种态，就必须在类型和状态上明确区分
- 不能让调用方靠“有没有按钮”去推断当前模式

### 规则 3：任何“选择后执行动作”的弹窗，都要把异步状态做完整

至少包含：

- loading
- 防重复提交
- 成功后关闭
- 失败时保留现场

不要做成：

- 点一下就关
- 剩下靠日志和运气

### 规则 4：统一弹窗很方便，但默认值很危险

这次问题本质上就是：

- 统一弹窗没错
- 但把行为寄托在默认值上，导致入口语义丢失

经验：

- 越是“被多个入口复用”的弹窗，越不能依赖默认行为
- 默认值只能兜底，不能承载主流程

## 五、建议后续继续保持

- 新增全局弹窗时，优先设计 `open(config)` 而不是 `setVisible(true)`
- 只要弹窗里的主按钮会触发异步副作用，就必须带 loading
- 当一个入口的目标是“插入到画布”，要从入口到弹窗都显式传递这层语义，不要中途丢失
- 如果未来再拆工具栏或迁移弹窗管理层，优先回归测试“入口模式是否正确透传”

## 六、涉及文件

- `packages/drawnix/src/drawnix.tsx`
- `packages/drawnix/src/components/startup/DrawnixDeferredFeatures.tsx`
- `packages/drawnix/src/components/toolbar/creation-toolbar.tsx`
- `packages/drawnix/src/components/toolbar/quick-creation-toolbar/quick-creation-toolbar.tsx`
- `packages/drawnix/src/components/media-library/MediaLibraryModal.tsx`
- `packages/drawnix/src/components/media-library/MediaLibraryInspector.tsx`
- `packages/drawnix/src/components/toolbar/toolbar.types.ts`
- `packages/drawnix/src/types/asset.types.ts`

## 七、一句话结论

素材库“能打开”不等于“能插入”。  
对画布入口来说，真正重要的是：入口语义要带到弹窗里，异步插入要被用户看见。🎯

## 本地图片导入公共链路

本地图片可以从文件选择、拖拽、粘贴和素材库四个入口进入画布。这些入口必须复用同一套类型识别、内容存储和插入语义，不能各自维护 MIME 白名单或临时 URL。

- `File.type` 为空或不可靠时，按文件扩展名识别常见图片格式。
- 图片内容按 SHA-256 生成稳定 `/asset-library/content-<hash>.<ext>` URL，避免同名文件冲突和错误复用。
- 文件读取、哈希、缓存和插入按需执行；批量文件顺序处理，避免并发解码造成内存峰值。
- 画布元素保存稳定虚拟 URL，当前页面需要的 `blob:` 只作为临时渲染源。
- 文件选择、拖拽、粘贴和素材库插入完成后，都应能刷新、重载并继续显示。

缓存与局域网降级细节见：

- [媒体缓存失败提示经验](./MEDIA_CACHE_WARNING_LESSONS.md)
- [Retry Image Component Lessons](./RETRY_IMAGE_COMPONENT_LESSONS.md)

## 八、画布多文件拖拽插入经验

更新日期：2026-04-27

### 1. 问题现象

用户希望一次拖多个图片/视频进入画布。第一轮修复后，多文件可以插入，但当原画布内容很多、画布很大时，拖入完成后视口会偏移，新增内容不在当前可见区域。

这类问题表面是“插入位置不对”，本质是两个坐标系统同时变化：

- Drop 事件发生时，鼠标位置来自屏幕/DOM 坐标。
- Plait 插入元素后，画布 `viewBox` 可能因为内容边界扩大而重算。
- 如果只在插入前计算一次 `toViewBoxPoint`，插入后 DOM scroll 和 viewport origination 可能不再对应，用户就会被带到别的位置。

### 2. 设计原则

1. 批量拖拽不是把 `files[0]` 改成循环这么简单。
   - 图片、视频、音频要走各自已有插入链路。
   - 单张图片拖到 mind node 时，应保留“替换节点图片”的旧语义。
   - 多文件拖拽时，不应让多个文件抢同一个节点，应统一按坐标插入画布。

2. 大文件批量处理要顺序执行。
   - 不要对多个视频同时 `Promise.all` 存储、解码或读元数据。
   - 图片加载、视频缓存、音频封面读取都可能触发大内存占用。
   - 高并发文件处理场景下，宁可略慢，也要避免内存峰值和交换分区压力。

3. 本地视频类型要同时看 MIME 和扩展名。
   - macOS/浏览器可能把 `.mov` 标成 `video/quicktime`。
   - 有些拖入来源可能不给 `file.type`。
   - 类型兜底应集中在 `data/blob.ts`，不要让各入口各写一份扩展名判断。

4. 批量插入后要锚定拖放点。
   - 记录 drop 时鼠标下的画布坐标 `point`。
   - 同时记录鼠标在 board 容器内的屏幕偏移 `activePoint`。
   - 插入完成并等待 Plait 完成一轮/两轮渲染后，用 `BoardTransforms.updateViewport` 恢复：

```typescript
const origination: [number, number] = [
  point[0] - activePoint[0] / zoom,
  point[1] - activePoint[1] / zoom,
];
BoardTransforms.updateViewport(board, origination, zoom);
```

这样无论 `viewBox` 怎么重算，用户鼠标落下的画布点都会回到原来的屏幕位置，新增内容仍在可见区域。

### 3. 实现要点

- `with-image.tsx` 的 drop 入口应先把 `FileList` 过滤成结构化的 `DroppedMediaFile[]`，而不是在循环里散落判断。
- 批量坐标使用固定网格偏移，避免所有文件堆在同一点。
- 视频文件先进入 `assetStorageService`，再复用 `insertVideoFromUrl`，不要新增一套视频元素结构。
- 当浏览器没有提供正确 MIME 时，可通过 `file.slice(0, file.size, resolvedMimeType)` 生成带类型的 Blob，保证 Cache Storage 元数据和 Response header 正确。
- 图片插入函数可增加 `skipScroll` 参数，批量拖拽由上层统一控制视口，避免每张图自己滚动。
- 视口恢复应使用 `updateViewport` 一步设置 `origination + zoom`，不要拆成滚动 DOM 或 `updateZoom + moveToCenter`。

### 4. 验证建议

1. 精确单测：

```bash
pnpm --dir packages/drawnix exec vitest run src/data/blob.test.ts
```

2. 类型检查：

```bash
pnpm nx run drawnix:typecheck
```

3. 手动回归：

- 大画布、已有大量元素、滚动到远离原点的位置。
- 一次拖入 2 张以上图片，新增内容应出现在 drop 点附近且可见。
- 一次拖入图片 + `.mov` / `.mp4` 视频，视频应进入画布并保留可播放语义。
- 单张图片拖到 mind node 上，仍应替换该节点图片。

### 5. 涉及文件

- `packages/drawnix/src/plugins/with-image.tsx`
- `packages/drawnix/src/data/blob.ts`
- `packages/drawnix/src/data/image.ts`
- `packages/drawnix/src/data/video.ts`
- `packages/drawnix/src/services/asset-storage-service.ts`
- `packages/drawnix/src/constants/ASSET_CONSTANTS.ts`

### 6. 一句话结论

画布文件拖拽要同时处理“文件批量语义”和“视口锚定语义”。
能插入多个文件只是第一步，真正稳定的体验是：插入完成后，用户仍然停在自己放手的位置。📍
