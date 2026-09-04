# Change: 在当前 OpenTu 中运行生图巡检

## Why

- 现有外部巡检脚本通过独立 Playwright 浏览器运行，无法复用用户当前打开、已登录的 OpenTu，也会造成多个 Chrome 窗口和两套任务状态。
- 用户需要巡检任务真实进入当前 OpenTu 的统一任务队列，并在同一个 OpenTu 页面中查看图片、URL、尺寸校验和完整报表。
- 项目已有模型评测工作台、运行时模型发现、统一任务队列和图片适配器，可复用现有能力，避免继续维护一套浏览器自动化流程。

## What Changes

- 在左侧工具栏新增独立“生图巡检报表”入口，复用现有工具窗口系统，不新增独立浏览器或第二套 OpenTu 实例。
- 从当前 OpenTu 设置读取全部供应商分组，仅筛选指定的 GPT Image 2 与 Gemini 模型白名单，并生成原有比例、1K、2K、4K、HD 测试矩阵，其他模型一律跳过。
- 所有巡检用例由 Tuzi 服务端持久后台任务提交并执行；OpenTu 仅负责创建运行、轮询状态、查看报表和停止运行，关闭或刷新页面不会中断巡检。
- 提供独立“生图巡检报表”界面，展示实际图片、原始图片 URL、任务 ID、耗时、请求比例/档位、实际尺寸、校验状态及 URL 尺寸计算公式，并支持导出 XLSX、JSON。
- 支持 Tuzi 服务端每天 07:00 按中国法定工作日自动运行；法定节假日和普通周末跳过，调休补班日照常执行。OpenTu 页面未打开时仍正常执行，稍后打开页面可恢复查看同一运行。
- 停用并弃用现有会启动独立 Chrome 的外部定时巡检流程。

## Impact

- Affected specs: `toolbox`, `image-generation`
- Affected code: OpenTu 的 `packages/drawnix/src/components/model-benchmark`、`packages/drawnix/src/services`、`packages/drawnix/src/tools`、`packages/drawnix/src/components/toolbar`，以及 Tuzi API 的路由、控制器、服务、持久化模型与后台调度
- Storage: 服务端仅持久化巡检元数据和图片 URL，不复制或缓存大图二进制；结果按运行和用例分页读取
- Compatibility: 不改变普通图片生成、现有模型评测和任务队列执行行为
