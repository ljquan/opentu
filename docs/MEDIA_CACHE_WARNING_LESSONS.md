# 媒体缓存失败提示经验

## 背景

部分远程图片/视频资源可以被浏览器直接预览，但由于 CORS、opaque response、签名 URL、响应体不可读或存储异常，前端无法稳定写入浏览器缓存。此时如果原始链接带有效期，用户后续可能丢失素材。

## 经验

1. 判断应以缓存结果为准，而不是以模型、供应商或域名为准。

   - 同一类缓存失败可能发生在任意供应商。
   - 按模型名硬编码会误报，也会漏掉未来新增模型。

2. “可预览”不等于“已离线保存”。

   - `<img>` / `<video>` 能展示远程 URL，不代表 Cache Storage 或 IndexedDB 有可恢复副本。
   - UI 需要把“仍依赖原始链接”显性化。

3. 列表渲染阶段不能批量跨域探测。

   - 素材库和任务队列可能有大量媒体。
   - hover 提示和角标应基于已有缓存状态、缓存失败元数据或本地 Cache API 查询，不应为每个资源额外发起网络请求。

4. 缓存元数据和实际缓存体要分开判断。

   - IndexedDB 中存在任务元数据，不代表 Cache API 中存在响应体。
   - `isCached` 应同时确认元数据和实际缓存体，否则会给用户错误安全感。

5. 失败原因要短、稳定、可展示。

   - 用枚举记录机器可判断的原因，如 `cors_opaque`、`network_error`、`http_error`、`storage_error`、`cache_missing`。
   - 文案面向用户：资源未能缓存到浏览器，原始链接可能过期，请尽快下载保存。

6. 成功缓存优先级最高。
   - 一旦确认资源已写入浏览器缓存，就不应再显示“需下载”角标。
   - 避免把历史失败状态长期误导为当前风险。

7. 远程 URL 是结果数据源，缓存只是加速层。

   - `http(s)` 结果即使缓存成功，也应继续保留原始 URL。
   - Service Worker 可以用规范化后的原始 URL 命中 Cache Storage，不需要把任务结果或素材 URL 改成 `/__aitu_cache__/...`。
   - 只有 `data:` / 原始 base64 这类没有可重放 URL 的内容，才需要落到稳定虚拟路径。

8. 自动清缓存必须极度谨慎。

   - Cache Storage 里混有用户资产，不能因为一次 `Cache.put()` 失败就自动 LRU 清理、腾空间、重试。
   - 缓存写入失败时，应保留原 URL、记录 `cacheWarning`、让 UI 提醒用户下载，不应主动删除任何媒体缓存。
   - 只有程序崩溃、页面无法进入，并且明确判断清缓存能恢复入口时，才允许提供受控清缓存路径；优先要求用户确认，并尽量缩小清理范围。

9. 缩略图是兜底预览，不是原图存在证明。

   - `thumbnail=small` 命中只说明 `drawnix-images-thumb` 有预览图，不说明 `drawnix-images` 仍有原图响应体。
   - 原图缺失时不要自动删除缩略图；缩略图仍可帮助用户识别素材。
   - 但应标记原图缓存缺失，让“需下载”在首次发现风险时出现。

## 推荐做法

- 在缓存服务中标准化 `cacheWarning`，由失败路径生成。
- 在任务结果和素材对象中透传 `cacheWarning`。
- 素材库和任务队列只读取本地缓存状态与警告元数据展示角标。
- hover 只展示原因和下载建议，不做实时网络检测。
- 远程媒体缓存成功与否不改变结果 URL；只把缓存结果作为 SW/Cache API 的读取优化。
- 禁止把“缓存失败”作为自动清理用户媒体缓存的触发条件。

## 画布虚拟图片 URL 兜底经验

更新日期：2026-04-26

### 现象

复制图片粘贴到画布后，图片元素会短暂出现，然后变成加载失败状态，严重时还会被自动删除。

控制台现象通常是：

- `/asset-library/content-xxx.png` 的 `<img>` 加载失败
- 但通过页面侧 Cache API 可以读到对应 blob
- 说明资源并非没有缓存，而是虚拟 URL 的响应链路没有喂给 DOM 图片

### 根因

这类问题不要只按“缓存丢失”判断。实际可能是：

- 图片写入了 IndexedDB 元数据，但 Cache Storage 没有实际响应体
- 局域网 HTTP 页面没有 Service Worker、Cache Storage 或 `crypto.subtle`
- 当前页面没有被新版 Service Worker 接管，`/asset-library/...` 请求落到服务器并 404
- Service Worker 查询缓存 key 与页面写入 key 不一致
- DOM `<img>` 请求 `/asset-library/...` 失败，但应用代码直接 `getCachedBlob(url)` 能成功

如果图片组件在第一次 `onError` 时直接删除元素，就会把“可恢复的展示问题”误处理成“资源不存在”。

### 修复原则

1. 虚拟 URL 首次加载失败不能立即删除画布元素。

   - 先重试，最后再确认 Cache Storage 中是否确实没有 blob。
   - 只有确认资源不存在时，才允许删除元素。

2. 画布元素必须保存和渲染稳定虚拟 URL。

   - 本地图片粘贴后应写入 `/asset-library/content-...`。
   - 降级路径可以使用 `/__aitu_cache__/image/content-...`。
   - 不要把长期展示 `src` 改成 `blob:`，否则刷新、协作、恢复和清理逻辑都会失去稳定引用。

3. 修复点应落在 Cache Storage 与 Service Worker 的一致性上。

   - 写入缓存前统一规范化虚拟 URL key，剥离 `_retry`、`bypass_sw`、`thumbnail` 等控制参数。
   - SW 读取时同时兼容 pathname、去控制参数后的完整 URL、当前请求 URL。
   - 页面侧 `getCachedBlob` 也要按同一规则查询。

4. 无 Service Worker 时必须有 IndexedDB Blob 降级。

   - 内容哈希仍生成稳定 `/asset-library/content-<hash>.<ext>` URL。
   - `crypto.subtle` 不可用时使用兼容 SHA-256 实现，不能退回文件名或时间戳去重。
   - Cache Storage 不可用时，把媒体 Blob 写入 IndexedDB，并由统一缓存服务按稳定 URL 读取。
   - 元数据存在但 Blob 缺失时不能直接判定缓存可用，应继续验证实际内容。

5. `objectURL` 只能用于临时读尺寸或预览。

   - 使用后要立刻 `URL.revokeObjectURL`。
   - 可以作为当前 React 图片节点的渲染源，但不要作为画布图片元素的持久化 URL。
   - 换源时旧异步请求不能覆盖新图，旧 Object URL 必须释放。

6. 调试日志要及时撤掉。
   - 定位时可以临时记录 URL、元素 ID、blob size。
   - 修复完成后，正常恢复路径不应刷 `warn` 或 `info`。
   - 只保留真正不可恢复或会影响用户数据的异常日志。

### 经验规则

- “DOM 加载失败”不等于“缓存不存在”。
- “Cache 元数据存在”也不等于“Cache 响应体存在”。
- 画布素材展示要以“可恢复”为优先，避免误删用户内容。
- 优先修正 SW/Cache key；无 SW 的局域网环境则通过统一缓存服务临时解析 `blob:`，稳定虚拟 URL 保持不变。
