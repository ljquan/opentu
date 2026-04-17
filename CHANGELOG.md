## 0.6.28 (2026-04-15)

### 🚀 Features

- 引入音频卡片自适应尺寸及多工具窗口支持 ([92b47af9](https://github.com/ljquan/aitu/commit/92b47af9))
- 完善音频结果缓存并接入 MV 分镜任务 ([b108089d](https://github.com/ljquan/aitu/commit/b108089d))
- 爆款MV生成器增强 — 历史跳转、帧传递、音频驱动分镜 ([c29f4a81](https://github.com/ljquan/aitu/commit/c29f4a81))

### 🩹 Fixes

- 修复任务工作流同步幽灵日志刷屏 ([492ca8bf](https://github.com/ljquan/aitu/commit/492ca8bf))
- 区分 sw-debug llmapi 的音频与歌词生成 ([7421d206](https://github.com/ljquan/aitu/commit/7421d206))
- 补齐 sw-debug 的 llmapi JSON 结果展示 ([4a411bc6](https://github.com/ljquan/aitu/commit/4a411bc6))
- 修复 suno 多音频重复与时长错误 ([093cdf54](https://github.com/ljquan/aitu/commit/093cdf54))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.27 (2026-04-15)

### 🚀 Features

- 基于 pricing endpoints 推断 provider bindings ([1a161276](https://github.com/ljquan/aitu/commit/1a161276))
- 统一爆款音乐续写与 infill 能力 ([458375c0](https://github.com/ljquan/aitu/commit/458375c0))
- 优化爆款音乐生成工具流程与体验 ([ae2f0e12](https://github.com/ljquan/aitu/commit/ae2f0e12))
- 支持工具默认窗口行为并修复音乐任务卡片异常 ([788cbe04](https://github.com/ljquan/aitu/commit/788cbe04))

### 🩹 Fixes

- 首屏异步预热价格并补全 LLM 原始响应日志 ([4aa69578](https://github.com/ljquan/aitu/commit/4aa69578))
- 清理任务列表批量索引误渲染 0 ([211cb525](https://github.com/ljquan/aitu/commit/211cb525))
- 补齐 suno 续写所需 task_id ([703812e4](https://github.com/ljquan/aitu/commit/703812e4))
- 保留爆款音乐创作描述并上移错误提示 ([f3dce84e](https://github.com/ljquan/aitu/commit/f3dce84e))
- 优化音乐分析历史标题并隐藏续写入口 ([cd9b213d](https://github.com/ljquan/aitu/commit/cd9b213d))

### 🔧 Chores

- refactor: 统一 LLM 调用日志，所有大模型调用自动记录到 sw-debug LLM API 面板 ([7313b52f](https://github.com/ljquan/aitu/commit/7313b52f))
- style: 优化音乐分析器已生成片段布局 ([616b4633](https://github.com/ljquan/aitu/commit/616b4633))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.26 (2026-04-14)

### 🚀 Features

- 新增爆款音乐生成工具 ([9e5bd769](https://github.com/ljquan/aitu/commit/9e5bd769))
- 历史关联任务展开、生成回填、风格传递与脚本版本优化 ([d914bc12](https://github.com/ljquan/aitu/commit/d914bc12))
- 支持工具弹窗多窗口实例 ([247a9ff2](https://github.com/ljquan/aitu/commit/247a9ff2))
- 脚本版本管理，支持多版本切换 ([790e8272](https://github.com/ljquan/aitu/commit/790e8272))
- 优化视频分析与脚本改编交互 ([bc82abc6](https://github.com/ljquan/aitu/commit/bc82abc6))
- 视频分析任务接入队列并优化结果插入 ([0cfcb25c](https://github.com/ljquan/aitu/commit/0cfcb25c))
- 上传视频分析后自动提取首帧图片 ([c50dec54](https://github.com/ljquan/aitu/commit/c50dec54))

### 🩹 Fixes

- 修复音乐分析器兼容性并完善工作流展示 ([6cde07e0](https://github.com/ljquan/aitu/commit/6cde07e0))
- 统一持久化删除的二次确认 ([c717d30f](https://github.com/ljquan/aitu/commit/c717d30f))
- 统一确认弹窗与媒体预览提示词交互 ([4b007267](https://github.com/ljquan/aitu/commit/4b007267))
- 批量生成使用每个镜头独立的 batchId ([f593eef3](https://github.com/ljquan/aitu/commit/f593eef3))
- 修复 Markdown 卡片初始化阶段的 Milkdown editorView 异常 ([8badb0c7](https://github.com/ljquan/aitu/commit/8badb0c7))
- 在爆款视频分析页提示 gemini-mix 分组 ([55815a81](https://github.com/ljquan/aitu/commit/55815a81))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.25 (2026-04-14)

### 🩹 Fixes

- 修正视频分析中内联数据的MIME类型 ([55e6b903](https://github.com/ljquan/aitu/commit/55e6b903))
- 防止生成任务重复调用大模型 API ([f381d800](https://github.com/ljquan/aitu/commit/f381d800))
- 统一主应用和 sw-debug 的备份恢复核心逻辑 ([3c359631](https://github.com/ljquan/aitu/commit/3c359631))

### 🔧 Chores

- 更新应用版本并移除AI视频调试代码 ([9628c9ad](https://github.com/ljquan/aitu/commit/9628c9ad))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.24 (2026-04-13)

### 🩹 Fixes

- 收口 AI 视频弹窗受控模型同步环 ([6c1b074e](https://github.com/ljquan/aitu/commit/6c1b074e))
- 移除视频尺寸 Select 以绕开 TDesign Option 更新环 ([40d2a72c](https://github.com/ljquan/aitu/commit/40d2a72c))
- 补充 AI 视频弹窗调试标记并稳定图片标签依赖 ([33d9420e](https://github.com/ljquan/aitu/commit/33d9420e))

### 🔧 Chores

- 补充 AI 视频弹窗关键状态链路调试日志 ([316e3555](https://github.com/ljquan/aitu/commit/316e3555))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.23 (2026-04-13)

### 🩹 Fixes

- 收口 iframe 下 AI 视频弹窗的剩余更新环 ([58bfc2a0](https://github.com/ljquan/aitu/commit/58bfc2a0))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.22 (2026-04-13)

### 🩹 Fixes

- 收口 AI 视频弹窗参数回写循环 ([6baf3e06](https://github.com/ljquan/aitu/commit/6baf3e06))

### 🔧 Chores

- 更新应用版本至0.6.21并刷新构建时间 ([252a203b](https://github.com/ljquan/aitu/commit/252a203b))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.21 (2026-04-13)

### 🚀 Features

- 知识库素材嵌入 — Milkdown 自定义节点插件 ([fec0e2a9](https://github.com/ljquan/aitu/commit/fec0e2a9))

### 🩹 Fixes

- 修复媒体库弹窗条件渲染和音频封面URL处理 ([d13e108b](https://github.com/ljquan/aitu/commit/d13e108b))
- 收口关闭态工具箱与素材库弹窗挂载，修复用户页 Hook 崩溃 ([45bfddb3](https://github.com/ljquan/aitu/commit/45bfddb3))
- iframe 环境下打开 AI 图片生成弹窗 Maximum update depth exceeded ([8c5a11fc](https://github.com/ljquan/aitu/commit/8c5a11fc))
- 避免 Milkdown 在 editorView 缺失时读取 markdown ([0d04c261](https://github.com/ljquan/aitu/commit/0d04c261))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.20 (2026-04-13)

### 🚀 Features

- 模型测试性价比评分 + 选择器收藏/淘汰标记 ([e3b694ac](https://github.com/ljquan/aitu/commit/e3b694ac))

### 🩹 Fixes

- 统一音频下载封面写入逻辑 ([97ab456a](https://github.com/ljquan/aitu/commit/97ab456a))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.19 (2026-04-12)

### 🚀 Features

- 增强错误处理与iframe测试支持 ([f4682ff8](https://github.com/ljquan/aitu/commit/f4682ff8))
- 音乐播放器支持知识库语音快捷操作 ([e53e6846](https://github.com/ljquan/aitu/commit/e53e6846))
- 右键菜单动态展示模型描述和文档链接 ([563376e1](https://github.com/ljquan/aitu/commit/563376e1))
- 集成供应商模型价格信息展示 ([8c011dbd](https://github.com/ljquan/aitu/commit/8c011dbd))
- 优化画布 Markdown 卡片与知识库联动 ([c04b9efd](https://github.com/ljquan/aitu/commit/c04b9efd))
- 增加内置模型推荐分并统一排序 ([bb65488e](https://github.com/ljquan/aitu/commit/bb65488e))
- 多选框增加全选/清除，修复测试本组模型数不一致 ([2ede78a7](https://github.com/ljquan/aitu/commit/2ede78a7))
- 更新默认模型至 Gemini 3.1 Pro Preview 并改进模型基准测试 ([3cce05df](https://github.com/ljquan/aitu/commit/3cce05df))
- 模型测试历史会话增加搜索与模态筛选 ([522b6c5d](https://github.com/ljquan/aitu/commit/522b6c5d))

### 🩹 Fixes

- 防白屏 — 全局错误边界 + 统一错误恢复 UI + 日志导出 ([6be795c9](https://github.com/ljquan/aitu/commit/6be795c9))
- 统一播放器速率控制并隔离播放缓存音频 ([5334ca60](https://github.com/ljquan/aitu/commit/5334ca60))
- 收敛 AI 媒体缓存语义与远程缓存去重 ([a35370f8](https://github.com/ljquan/aitu/commit/a35370f8))
- 补齐任务队列归档提示与历史数量 ([e8fb08d7](https://github.com/ljquan/aitu/commit/e8fb08d7))
- override TDesign Tooltip default max-width to display larger video ([1c9c73c5](https://github.com/ljquan/aitu/commit/1c9c73c5))
- 修复GitHub同步上下文未提供时的错误处理 ([eaf6a41d](https://github.com/ljquan/aitu/commit/eaf6a41d))

### 🔧 Chores

- style: 提升右键菜单 disabled 项可读性 ([91add984](https://github.com/ljquan/aitu/commit/91add984))
- style: fix config dashboard layout responsiveness in narrow container ([cf92bb0f](https://github.com/ljquan/aitu/commit/cf92bb0f))
- style: optimize model benchmark layout for smaller screens ([b5e36a01](https://github.com/ljquan/aitu/commit/b5e36a01))
- style: increase API Key tooltip width for better video visibility ([6688fb4c](https://github.com/ljquan/aitu/commit/6688fb4c))
- style: optimize settings layout and model selection UI ([b99baa5b](https://github.com/ljquan/aitu/commit/b99baa5b))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.18 (2026-04-11)

### 🚀 Features

- 历史版本路径支持 + 未知元素类型容错 ([48a78cd4](https://github.com/ljquan/aitu/commit/48a78cd4))
- 优化模型批测入口与模型结果导出 ([358e44ae](https://github.com/ljquan/aitu/commit/358e44ae))
- 生成步骤交互优化 + 字段精简 ([c576d987](https://github.com/ljquan/aitu/commit/c576d987))
- refine model benchmark batch selection ([e18ff27e](https://github.com/ljquan/aitu/commit/e18ff27e))
- add model benchmark workbench ([d7b695b6](https://github.com/ljquan/aitu/commit/d7b695b6))
- 视频上传预览 + 生成页重新分析 + UI 优化 ([5323a31d](https://github.com/ljquan/aitu/commit/5323a31d))
- 脚本表单优化 + 生成链路增强 ([79ec5d77](https://github.com/ljquan/aitu/commit/79ec5d77))
- 长视频分段拼接全套优化 ([002dc30d](https://github.com/ljquan/aitu/commit/002dc30d))
- AI 文本生成结果统一以 Markdown Card 方式插入画布 ([c97fca2a](https://github.com/ljquan/aitu/commit/c97fca2a))
- 新增视频分析工具 + 重构 MCP 队列逻辑为公共模块 ([ac0f7331](https://github.com/ljquan/aitu/commit/ac0f7331))

### 🩹 Fixes

- 补齐推荐模型选择与默认分组去重 ([1a496766](https://github.com/ljquan/aitu/commit/1a496766))
- 收敛模型测试弹窗启动与状态同步 ([0529b331](https://github.com/ljquan/aitu/commit/0529b331))
- 设置弹窗单模型测试带入当前模型 ([9aa52c23](https://github.com/ljquan/aitu/commit/9aa52c23))
- 修复设置弹窗激活后仍被测试弹窗遮挡 ([99d0d0d4](https://github.com/ljquan/aitu/commit/99d0d0d4))
- 修复多窗口最新激活未置顶 ([1f956f2d](https://github.com/ljquan/aitu/commit/1f956f2d))
- ensure rawData is persisted and improve JSON display styling ([2aa967af](https://github.com/ljquan/aitu/commit/2aa967af))
- 修复 generateContent 路由与超时问题 ([7299a706](https://github.com/ljquan/aitu/commit/7299a706))
- 收紧 API key 错误判定，避免误开设置面板 ([21fffaa4](https://github.com/ljquan/aitu/commit/21fffaa4))
- 修复 AI 文本插入为普通文本 + Card 换行丢失 + 选中带标题 ([8479ac79](https://github.com/ljquan/aitu/commit/8479ac79))
- 修复模型搜索供应商展示与中文输入误选 ([2412e404](https://github.com/ljquan/aitu/commit/2412e404))
- 保留远程媒体原始 URL 语义 ([8f9f828f](https://github.com/ljquan/aitu/commit/8f9f828f))
- 深度用户页面加载内存溢出优化 ([71a0dfe2](https://github.com/ljquan/aitu/commit/71a0dfe2))

### 🔧 Chores

- refactor(winbox): 统一窗口 z-index 管理，修复多窗口遮挡与测试弹窗状态问题 ([6ec47b57](https://github.com/ljquan/aitu/commit/6ec47b57))
- style(model-benchmark): comprehensive UI/UX beautification and functional refinement ([2fe7bb15](https://github.com/ljquan/aitu/commit/2fe7bb15))
- docs: 补充 AI 文本插入必须传 label 走 Card 的编码规则 ([69bce1a9](https://github.com/ljquan/aitu/commit/69bce1a9))
- 添加搜索 ([fe650d69](https://github.com/ljquan/aitu/commit/fe650d69))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.17 (2026-04-09)

### 🚀 Features

- 优化音乐播放器布局与队列体验 ([4a76a43d](https://github.com/ljquan/aitu/commit/4a76a43d))
- 统一音乐播放器，始终显示播放列表标签栏，新增"全部语音"标签 ([a66e6d81](https://github.com/ljquan/aitu/commit/a66e6d81))
- 增加 TTS 播报设置入口 ([bd77e254](https://github.com/ljquan/aitu/commit/bd77e254))
- add canvas text read-aloud ([63c30e48](https://github.com/ljquan/aitu/commit/63c30e48))
- route audio entries into music player playback ([e8b9c4ff](https://github.com/ljquan/aitu/commit/e8b9c4ff))
- 增加音频播放列表与收藏能力 ([f8179794](https://github.com/ljquan/aitu/commit/f8179794))
- 素材库支持音频展示、缓存与拖拽插入 ([8c5a7e51](https://github.com/ljquan/aitu/commit/8c5a7e51))

### 🩹 Fixes

- 保持画布朗读在播放器切换时不中断 ([13b98cca](https://github.com/ljquan/aitu/commit/13b98cca))
- 音乐播放器时间展示回退\n\n问题描述：音乐播放器列表在拿不到音频时长时展示 --:--，无法向用户提供有效时间信息。\n修复思路：新增统一时间副标题格式化，优先展示解析/已有时长，缺失时回退展示素材生成时间。\n更新代码架构：在 MusicPlayerTool 收敛音频时间展示策略，并为素材列表补充元数据时长解析链路。 ([204da5a4](https://github.com/ljquan/aitu/commit/204da5a4))
- 修复音乐播放器最小化误触发底层播放控件\n\n问题描述:\n- 点击音乐播放器右上角最小化按钮时，事件会继续落到底层画布播放控件\n- 导致播放器最小化的同时误触发暂停/播放，交互结果与用户预期不一致\n\n修复思路:\n- 在最小化按钮上阻止 pointer/click 事件冒泡与默认行为\n- 使用 requestAnimationFrame 延后一帧执行最小化，避免同一点击链路被底层控件消费\n\n更新代码架构:\n- 收敛到音乐播放器工具内部按钮事件处理，不改播放服务与队列模型\n- 维持现有播放器/画布控件职责边界，仅修复 UI 事件穿透问题 ([6ab178e1](https://github.com/ljquan/aitu/commit/6ab178e1))
- 为无标题 markdown 卡片显示默认标题 ([6f96cfec](https://github.com/ljquan/aitu/commit/6f96cfec))
- markdown 元素按文本参与提示词 ([32a17163](https://github.com/ljquan/aitu/commit/32a17163))
- 保持 Agent 分类切模型不降级为文本 ([2fbe82de](https://github.com/ljquan/aitu/commit/2fbe82de))
- 优化设置弹窗小屏适配 ([39eeb5ba](https://github.com/ljquan/aitu/commit/39eeb5ba))
- unify canvas audio queue playback ([a0839a10](https://github.com/ljquan/aitu/commit/a0839a10))
- allow create menu on system playlist tabs ([b4837565](https://github.com/ljquan/aitu/commit/b4837565))
- unify playlist interactions and duration display ([f61bf142](https://github.com/ljquan/aitu/commit/f61bf142))
- dedupe local canvas files and media library ([ac6181d2](https://github.com/ljquan/aitu/commit/ac6181d2))
- 过滤辅助缓存条目避免封面图显示为独立素材 ([43bb958b](https://github.com/ljquan/aitu/commit/43bb958b))
- 修复本地拖入音频的标题和封面显示 ([9e7776ba](https://github.com/ljquan/aitu/commit/9e7776ba))
- 修复音频素材详情面板展示问题 ([e4a545a4](https://github.com/ljquan/aitu/commit/e4a545a4))
- 修复 Suno 参数下拉框不显示及版本默认值问题 ([2b658c37](https://github.com/ljquan/aitu/commit/2b658c37))

### 🔧 Chores

- refactor: 调整知识库工具分类 ([81e64fc8](https://github.com/ljquan/aitu/commit/81e64fc8))
- refactor(context-menu): 统一右键菜单公共组件 ([65739440](https://github.com/ljquan/aitu/commit/65739440))
- refactor: unify audio playlist tags ([babb531a](https://github.com/ljquan/aitu/commit/babb531a))
- refactor: unify audio track list and context menu ([0f544aae](https://github.com/ljquan/aitu/commit/0f544aae))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.16 (2026-04-08)

### 🩹 Fixes

- 修复 Suno 默认动作与 release 卡死问题 ([9d216539](https://github.com/ljquan/aitu/commit/9d216539))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.15 (2026-04-08)

### 🚀 Features

- 优化播放器定位、高度、拖拽和垂直布局 ([78038789](https://github.com/ljquan/aitu/commit/78038789))
- 完善音频预览与下载体验 ([d3f5a1d5](https://github.com/ljquan/aitu/commit/d3f5a1d5))
- sort models by freshness and persist model-scoped generation preferences ([98ad2a06](https://github.com/ljquan/aitu/commit/98ad2a06))
- add provider config shortcut ([14901355](https://github.com/ljquan/aitu/commit/14901355))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.14 (2026-04-08)

### 🚀 Features

- 支持 Suno 歌词任务与厂商识别能力 ([d3223043](https://github.com/ljquan/aitu/commit/d3223043))
- 恢复被误删掉代码 ([9166971c](https://github.com/ljquan/aitu/commit/9166971c))
- 恢复被误删掉代码 ([82134958](https://github.com/ljquan/aitu/commit/82134958))
- 优化代码 ([4ebfdf60](https://github.com/ljquan/aitu/commit/4ebfdf60))
- 优化代码 ([7f71ea6c](https://github.com/ljquan/aitu/commit/7f71ea6c))
- 新增模型 ([d8cf2816](https://github.com/ljquan/aitu/commit/d8cf2816))
- 优化导出 ([ea50f410](https://github.com/ljquan/aitu/commit/ea50f410))
- 增加 Stitch 设计工作流资产与规范 ([5d2c139b](https://github.com/ljquan/aitu/commit/5d2c139b))
- 增加画布音频节点与播放能力 ([6bf9d299](https://github.com/ljquan/aitu/commit/6bf9d299))
- 接入音频生成任务与工作流链路 ([9fe365ab](https://github.com/ljquan/aitu/commit/9fe365ab))
- 增加音频模态与 Suno 路由基础 ([d3d94f4c](https://github.com/ljquan/aitu/commit/d3d94f4c))
- 增加 Kling 参数适配 ([539a2827](https://github.com/ljquan/aitu/commit/539a2827))
- 增加 Kling 能力路由 ([03f2fec2](https://github.com/ljquan/aitu/commit/03f2fec2))
- 优化至形状可导出 ([210c68b9](https://github.com/ljquan/aitu/commit/210c68b9))
- 优化至适配画笔 ([a946b42f](https://github.com/ljquan/aitu/commit/a946b42f))
- 优化移动端设置与供应商配置体验 ([868f1fee](https://github.com/ljquan/aitu/commit/868f1fee))
- 增强文本多模态识图与供应商模型路由体验 ([ad47afef](https://github.com/ljquan/aitu/commit/ad47afef))
- 完善多供应商模型协议路由与 Sora 视频适配 ([5c217bd2](https://github.com/ljquan/aitu/commit/5c217bd2))
- 优化模型选择器供应商与厂商分层展示 ([f43a9e4d](https://github.com/ljquan/aitu/commit/f43a9e4d))
- 优化设置页模型发现与配置体验 ([868b0d45](https://github.com/ljquan/aitu/commit/868b0d45))
- 重构设置页并修复配置持久化 ([f7962788](https://github.com/ljquan/aitu/commit/f7962788))

### 🩹 Fixes

- persist dropdown selections and correct type fallback ([1d868c5e](https://github.com/ljquan/aitu/commit/1d868c5e))
- 修复 web 端音频任务类型检查失败 ([74e80377](https://github.com/ljquan/aitu/commit/74e80377))
- 优化音频节点内容布局与信息层级 ([526cd0ce](https://github.com/ljquan/aitu/commit/526cd0ce))
- 优化移动端音频播放器并恢复桌面端展示 ([ab75d70a](https://github.com/ljquan/aitu/commit/ab75d70a))
- 补充媒体任务兼容与路由回归 ([e09750e1](https://github.com/ljquan/aitu/commit/e09750e1))
- 完善音频入口与任务展示体验 ([10dc0abd](https://github.com/ljquan/aitu/commit/10dc0abd))
- 优化 Kling 参数展示 ([b7ad05d4](https://github.com/ljquan/aitu/commit/b7ad05d4))

### 🔧 Chores

- bump version to 0.6.13 ([1a3d4deb](https://github.com/ljquan/aitu/commit/1a3d4deb))
- bump version to 0.6.12 ([ecaf487e](https://github.com/ljquan/aitu/commit/ecaf487e))
- checkpoint current local changes ([fe2bdb7e](https://github.com/ljquan/aitu/commit/fe2bdb7e))
- 优化弹窗 ([16563720](https://github.com/ljquan/aitu/commit/16563720))
- featL：优化导出 ([8e78c7ff](https://github.com/ljquan/aitu/commit/8e78c7ff))
- 实现多供应商模型配置与按模型来源路由 ([979ff59d](https://github.com/ljquan/aitu/commit/979ff59d))
- 实现模型获取与按需添加流程 ([7d5f9ab8](https://github.com/ljquan/aitu/commit/7d5f9ab8))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liangyufeng <l.yfeng@qq.com>

## 0.6.12 (2026-03-31)

### 🚀 Features

- 隐藏原生滚动条 ([15e61dcb](https://github.com/ljquan/aitu/commit/15e61dcb))
- 重建多供应商模型路由与移动端配置体验 ([78de2528](https://github.com/ljquan/aitu/commit/78de2528))

### 🩹 Fixes

- 修复多供应商分支构建类型错误 ([541000cc](https://github.com/ljquan/aitu/commit/541000cc))
- 修复缩略图地址钩子语法错误 ([c8883799](https://github.com/ljquan/aitu/commit/c8883799))
- update app version to 0.6.11 and adjust build time ([8d8ad46a](https://github.com/ljquan/aitu/commit/8d8ad46a))

### ❤️  Thank You

- liangyufeng <l.yfeng@qq.com>
- gongchengtu <1817063960@qq.com>
- liquid <ljquan@qq.com>

## 0.6.11 (2026-03-18)

### 🔧 Chores

- 更新应用版本至0.6.10并修正调整大小句柄常量 ([4bf18818](https://github.com/ljquan/aitu/commit/4bf18818))
- fixed: 兼容base64图片返回 ([94d4a81c](https://github.com/ljquan/aitu/commit/94d4a81c))
- fixed:修复部署失败 ([9ecdebcc](https://github.com/ljquan/aitu/commit/9ecdebcc))
- fixed:修复素材库删除的bug ([6ac4bf95](https://github.com/ljquan/aitu/commit/6ac4bf95))
- fixed:修复素材库删除的bug ([c93d449e](https://github.com/ljquan/aitu/commit/c93d449e))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liangyufeng <l.yfeng@qq.com>

## 0.6.10 (2026-03-16)

### 🚀 Features

- 修改部署失败的问题 ([23533dd2](https://github.com/ljquan/aitu/commit/23533dd2))
- 添加导出ppt的功能 ([08e4fd52](https://github.com/ljquan/aitu/commit/08e4fd52))
- 持久化 AI 生成参数偏好 ([dbf42e78](https://github.com/ljquan/aitu/commit/dbf42e78))
- 添加页面刷新后视频任务恢复和工作流同步机制 ([8daecd7b](https://github.com/ljquan/aitu/commit/8daecd7b))
- 优化画布上插入内容让其可滚动 ([76024c85](https://github.com/ljquan/aitu/commit/76024c85))
- 优化agent回答文本框 ([d706c6ed](https://github.com/ljquan/aitu/commit/d706c6ed))
- 优化知识库对话ai回答内容将其渲染为对应的markdown格式&优化skill生成的内容让外层文本框高度自适应内容高度 ([cb76e4df](https://github.com/ljquan/aitu/commit/cb76e4df))

### 🩹 Fixes

- 修复切换画板时刷新页面丢失当前画板的问题 ([c164a1dc](https://github.com/ljquan/aitu/commit/c164a1dc))

### 🔧 Chores

- 更新构建时间戳 ([431af243](https://github.com/ljquan/aitu/commit/431af243))
- feat：优化文本框高度 ([435cc865](https://github.com/ljquan/aitu/commit/435cc865))

### ❤️  Thank You

- liangyufeng <l.yfeng@qq.com>
- gongchengtu <1817063960@qq.com>
- liquid <ljquan@qq.com>

## 0.6.9 (2026-03-08)

### 🚀 Features

- 添加页面刷新后恢复视频任务轮询的功能 ([d434c165](https://github.com/ljquan/aitu/commit/d434c165))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.6.8 (2026-03-07)

### 🚀 Features

- add backup restoration functionality with automatic chunking support ([7d76899a](https://github.com/ljquan/aitu/commit/7d76899a))
- 支持剪贴板图片粘贴 ([367830ca](https://github.com/ljquan/aitu/commit/367830ca))
- 优化缩放累计误差 ([f5330602](https://github.com/ljquan/aitu/commit/f5330602))
- 优化多行输入取消聚焦会换行的问题 ([4ab79120](https://github.com/ljquan/aitu/commit/4ab79120))
- 新增插入画布开关 ([60f6c041](https://github.com/ljquan/aitu/commit/60f6c041))
- 优化 ([1630ecbf](https://github.com/ljquan/aitu/commit/1630ecbf))

### 🩹 Fixes

- 修复批量生图模型尺寸失效 ([eee26c35](https://github.com/ljquan/aitu/commit/eee26c35))
- 仅为 gemini-3.1-flash-image-preview 开放新增比例并按模型过滤尺寸选项 ([4b3600d7](https://github.com/ljquan/aitu/commit/4b3600d7))
- update app version to 0.6.7 and adjust build time in version.json; refactor WeakRef usage in tracking.types.ts ([ad9d7769](https://github.com/ljquan/aitu/commit/ad9d7769))

### 🔧 Chores

- feat：优化缩放文本框&实现点击输入 ([4ac4244e](https://github.com/ljquan/aitu/commit/4ac4244e))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liangyufeng <l.yfeng@qq.com>

## 0.6.7 (2026-03-04)

### 🚀 Features

- 添加图层 ([74fc6e51](https://github.com/ljquan/aitu/commit/74fc6e51))
- 优化Service Worker激活和CDN策略 ([e8ec6272](https://github.com/ljquan/aitu/commit/e8ec6272))
- 引入baoyu-skill ([5b04670b](https://github.com/ljquan/aitu/commit/5b04670b))

### 🔧 Chores

- 更新版本至0.6.6并调整CDN优先级 ([21a5d6ff](https://github.com/ljquan/aitu/commit/21a5d6ff))
- bump version to 0.6.6 ([95f54096](https://github.com/ljquan/aitu/commit/95f54096))
- bump version to 0.6.5 ([c8c22e00](https://github.com/ljquan/aitu/commit/c8c22e00))
- bump version to 0.6.4 ([42f24424](https://github.com/ljquan/aitu/commit/42f24424))
- bump version to 0.6.3 ([28217b94](https://github.com/ljquan/aitu/commit/28217b94))
- refactor: replace video with tutorial link in settings dialog and auth components ([94675952](https://github.com/ljquan/aitu/commit/94675952))
- 优化 ([60a5d1d4](https://github.com/ljquan/aitu/commit/60a5d1d4))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liangyufeng <l.yfeng@qq.com>
- liquidliang <ljquan@qq.com>

## 0.6.6 (2026-02-28)

### 🔧 Chores

- bump version to 0.6.5 ([c8c22e00](https://github.com/ljquan/aitu/commit/c8c22e00))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.6.5 (2026-02-28)

### 🚀 Features

- 优化Service Worker激活和CDN策略 ([e8ec6272](https://github.com/ljquan/aitu/commit/e8ec6272))

### 🔧 Chores

- bump version to 0.6.4 ([42f24424](https://github.com/ljquan/aitu/commit/42f24424))
- 优化 ([60a5d1d4](https://github.com/ljquan/aitu/commit/60a5d1d4))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.6.4 (2026-02-28)

### 🚀 Features

- 优化Service Worker激活和CDN策略 ([e8ec6272](https://github.com/ljquan/aitu/commit/e8ec6272))
- 引入baoyu-skill ([5b04670b](https://github.com/ljquan/aitu/commit/5b04670b))

### 🩹 Fixes

- 修复 GitHub Actions CI 配置以支持 pnpm ([582b46cc](https://github.com/ljquan/aitu/commit/582b46cc))

### 🔧 Chores

- bump version to 0.6.3 ([28217b94](https://github.com/ljquan/aitu/commit/28217b94))
- 多文件禁用缓存确保版本与日志数据实时更新 ([099d8807](https://github.com/ljquan/aitu/commit/099d8807))
- 升级版本至0.6.2并更新构建时间与版本信息 ([f3b13616](https://github.com/ljquan/aitu/commit/f3b13616))
- 优化 ([60a5d1d4](https://github.com/ljquan/aitu/commit/60a5d1d4))
- refactor: 模型命名重构与功能增强 ([1bd8048a](https://github.com/ljquan/aitu/commit/1bd8048a))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.6.3 (2026-02-28)

### 🚀 Features

- 引入baoyu-skill ([5b04670b](https://github.com/ljquan/aitu/commit/5b04670b))
- 重构版本相关菜单与页面，优化样式与交互体验 ([e40635b9](https://github.com/ljquan/aitu/commit/e40635b9))
- 升级版本至0.6.1，优化部署与生成流程，集成多模型适配器 ([784c58a8](https://github.com/ljquan/aitu/commit/784c58a8))

### 🩹 Fixes

- 修复 GitHub Actions CI 配置以支持 pnpm ([582b46cc](https://github.com/ljquan/aitu/commit/582b46cc))

### 🔧 Chores

- 多文件禁用缓存确保版本与日志数据实时更新 ([099d8807](https://github.com/ljquan/aitu/commit/099d8807))
- 升级版本至0.6.2并更新构建时间与版本信息 ([f3b13616](https://github.com/ljquan/aitu/commit/f3b13616))
- bump version to 0.6.2 ([499797ca](https://github.com/ljquan/aitu/commit/499797ca))
- refactor: 模型命名重构与功能增强 ([1bd8048a](https://github.com/ljquan/aitu/commit/1bd8048a))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.6.2 (2026-02-27)

### 🚀 Features

- 重构版本相关菜单与页面，优化样式与交互体验 ([e40635b9](https://github.com/ljquan/aitu/commit/e40635b9))
- 升级版本至0.6.1，优化部署与生成流程，集成多模型适配器 ([784c58a8](https://github.com/ljquan/aitu/commit/784c58a8))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.6.1 (2026-02-26)

### 🚀 Features

- 为 ImageGenerationParams 新增 params 字段支持模型特定参数 ([ac10ed55](https://github.com/ljquan/aitu/commit/ac10ed55))
- 版本日志菜单 + CHANGELOG.md 自动同步到 changelog.json ([51bb033e](https://github.com/ljquan/aitu/commit/51bb033e))
- 新增多个系统技能常量定义 ([f30c3ab6](https://github.com/ljquan/aitu/commit/f30c3ab6))
- 支持双击卡片打开知识库并关联笔记 ([8301bce3](https://github.com/ljquan/aitu/commit/8301bce3))
- 为卡片元素添加复制文本功能 ([f1a06a9a](https://github.com/ljquan/aitu/commit/f1a06a9a))
- 实现 Markdown 粘贴和知识库集成的 Card 标签贴元素 ([7b590d30](https://github.com/ljquan/aitu/commit/7b590d30))
- 统一系统与自定义Skill执行路径并支持角色扮演模式 ([58204689](https://github.com/ljquan/aitu/commit/58204689))
- 新增Skill工作流DSL解析与知识库集成 ([f0df843c](https://github.com/ljquan/aitu/commit/f0df843c))
- 新增知识提取与同步功能 ([093dd25d](https://github.com/ljquan/aitu/commit/093dd25d))
- 完整支持多图生成结果的存储、展示与预览 ([2e5df25b](https://github.com/ljquan/aitu/commit/2e5df25b))
- 集成 Seedream 5.0 并优化模型适配器匹配机制 ([cc4232fd](https://github.com/ljquan/aitu/commit/cc4232fd))
- 优化模型参数处理与自定义参数透传链路 ([3eceb994](https://github.com/ljquan/aitu/commit/3eceb994))
- 集成即梦（Seedream + Seedance）模型，修复自定义参数透传链路 ([31f857bb](https://github.com/ljquan/aitu/commit/31f857bb))
- 升级 ([d8eb1502](https://github.com/ljquan/aitu/commit/d8eb1502))
- 添加模型选择器厂商分类（VendorTabPanel 左右分栏布局） ([55a18a84](https://github.com/ljquan/aitu/commit/55a18a84))
- 添加 Flux 图片生成适配器，重构 adapter 路由与回调传递 ([f6b1670e](https://github.com/ljquan/aitu/commit/f6b1670e))
- 集成 Milkdown Markdown 编辑器并优化幻灯片播放 ([9e66bf4c](https://github.com/ljquan/aitu/commit/9e66bf4c))
- 接入 Midjourney 图片模型适配 ([62266a31](https://github.com/ljquan/aitu/commit/62266a31))
- 接入Kling视频模型适配 ([a9c0eade](https://github.com/ljquan/aitu/commit/a9c0eade))

### 🩹 Fixes

- 修复视频时长解析空值NaN并同步版本与更新说明 ([e1e4137c](https://github.com/ljquan/aitu/commit/e1e4137c))
- 移除视频创作技能 ([33fe21bc](https://github.com/ljquan/aitu/commit/33fe21bc))
- 修复卡片标题重复显示和交互事件问题 ([f7409839](https://github.com/ljquan/aitu/commit/f7409839))
- 修复删除上传图片后 hover 预览大图未消失的问题 ([f9e3ee4f](https://github.com/ljquan/aitu/commit/f9e3ee4f))
- 修复 Seedream 5.0 lite 模型 ID、3K 比例参数及底部输入栏参数丢失问题 ([98912c16](https://github.com/ljquan/aitu/commit/98912c16))
- 修复上下文菜单z-index硬编码问题 ([3373b168](https://github.com/ljquan/aitu/commit/3373b168))
- 提高上下文菜单的z-index以解决遮挡问题 ([853f7868](https://github.com/ljquan/aitu/commit/853f7868))
- 修复外部签名 URL 的 CORS 和参数破坏问题 ([e0491e50](https://github.com/ljquan/aitu/commit/e0491e50))
- 修复签名 URL（TOS）因 Referer 校验导致缩略图/插入/下载 403 ([262eea92](https://github.com/ljquan/aitu/commit/262eea92))

### 🔧 Chores

- update build artifacts for version 0.5.95 ([ef974603](https://github.com/ljquan/aitu/commit/ef974603))
- bump version to 0.5.95 ([1a7a018f](https://github.com/ljquan/aitu/commit/1a7a018f))
- refactor(web): 优化类型定义和构建配置 refactor(sw): 增强类型安全处理 refactor(dawnix): 完善类型导入和配置 ([84285d9e](https://github.com/ljquan/aitu/commit/84285d9e))
- docs: 新增知识库、命令面板和任务队列文档并更新相关内容 ([4b3aedf8](https://github.com/ljquan/aitu/commit/4b3aedf8))
- docs(settings): 在API Key说明中添加演示视频链接 ([d4e24da5](https://github.com/ljquan/aitu/commit/d4e24da5))
- refactor(knowledge-base): 统一默认目录并简化目录类型映射 ([bf7a367d](https://github.com/ljquan/aitu/commit/bf7a367d))
- docs: 更新 CLAUDE.md 反映多模型适配器架构 ([4bbebd99](https://github.com/ljquan/aitu/commit/4bbebd99))
- Fix seedream adapter routing and dropdown layout ([f4bb5a74](https://github.com/ljquan/aitu/commit/f4bb5a74))
- fixed:修复ppt新加的内容在上方的问题 ([f4e345f7](https://github.com/ljquan/aitu/commit/f4e345f7))
- 知识库 ([5b8f2bdb](https://github.com/ljquan/aitu/commit/5b8f2bdb))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liangyufeng <l.yfeng@qq.com>
- liquid <ljquan@qq.com>

## 0.5.95 (2026-02-12)

### 🚀 Features

- 完整支持多图生成结果的存储、展示与预览 ([2e5df25b](https://github.com/ljquan/aitu/commit/2e5df25b))
- 集成 Seedream 5.0 并优化模型适配器匹配机制 ([cc4232fd](https://github.com/ljquan/aitu/commit/cc4232fd))
- 优化模型参数处理与自定义参数透传链路 ([3eceb994](https://github.com/ljquan/aitu/commit/3eceb994))
- 集成即梦（Seedream + Seedance）模型，修复自定义参数透传链路 ([31f857bb](https://github.com/ljquan/aitu/commit/31f857bb))
- 升级 ([d8eb1502](https://github.com/ljquan/aitu/commit/d8eb1502))
- 优化PPT相关能力 ([7f592465](https://github.com/ljquan/aitu/commit/7f592465))
- 添加模型选择器厂商分类（VendorTabPanel 左右分栏布局） ([55a18a84](https://github.com/ljquan/aitu/commit/55a18a84))
- 添加 Flux 图片生成适配器，重构 adapter 路由与回调传递 ([f6b1670e](https://github.com/ljquan/aitu/commit/f6b1670e))
- 添加套索选择工具及工具栏/命令面板集成 ([0d5e1d82](https://github.com/ljquan/aitu/commit/0d5e1d82))
- 添加 Frame 和幻灯片播放功能 ([c9859671](https://github.com/ljquan/aitu/commit/c9859671))
- implement new canvas features and command palette ([47dfcf12](https://github.com/ljquan/aitu/commit/47dfcf12))
- enhance logging and error handling in WorkflowEngine ([5074339b](https://github.com/ljquan/aitu/commit/5074339b))
- improve fallback engine handling and logging in workflow submission service ([88a7199e](https://github.com/ljquan/aitu/commit/88a7199e))
- add batch clear failed tasks button in generation task list ([e303baf8](https://github.com/ljquan/aitu/commit/e303baf8))
- enhance logging and error handling in AI analysis and agent execution ([cc03ce1c](https://github.com/ljquan/aitu/commit/cc03ce1c))
- enhance session replay management and error handling ([8a190371](https://github.com/ljquan/aitu/commit/8a190371))
- improve Service Worker channel validation for streaming API calls ([8f81e6ef](https://github.com/ljquan/aitu/commit/8f81e6ef))
- unify Service Worker availability checks and enforce main thread executor in fallback scenarios ([e27d14e0](https://github.com/ljquan/aitu/commit/e27d14e0))
- enhance workflow submission and error handling ([3365fdfc](https://github.com/ljquan/aitu/commit/3365fdfc))
- optimize analytics reporting and payload management ([fef7bf06](https://github.com/ljquan/aitu/commit/fef7bf06))
- add custom tools sync and prevent remote task resumption ([f296875d](https://github.com/ljquan/aitu/commit/f296875d))
- implement workflow handler initialization from IndexedDB ([943419ec](https://github.com/ljquan/aitu/commit/943419ec))
- enhance error handling and logging in Service Worker and task management ([167a559a](https://github.com/ljquan/aitu/commit/167a559a))
- implement video model adapters and enhance video generation ([982313f3](https://github.com/ljquan/aitu/commit/982313f3))
- enhance SW task queue service with fallback mechanisms and canvas operation handling ([390bb155](https://github.com/ljquan/aitu/commit/390bb155))
- add base64 image preview functionality ([fba4fe7f](https://github.com/ljquan/aitu/commit/fba4fe7f))
- 接入 Midjourney 图片模型适配 ([62266a31](https://github.com/ljquan/aitu/commit/62266a31))
- implement image fitting utility and enhance video processing ([25746d6b](https://github.com/ljquan/aitu/commit/25746d6b))
- enhance analytics and reporting functionality ([30a9bbfd](https://github.com/ljquan/aitu/commit/30a9bbfd))
- enhance video handling and task queue management ([4757a0d4](https://github.com/ljquan/aitu/commit/4757a0d4))
- 接入Kling视频模型适配 ([a9c0eade](https://github.com/ljquan/aitu/commit/a9c0eade))
- add master badge and enhance Gist handling ([1dc71a99](https://github.com/ljquan/aitu/commit/1dc71a99))
- implement failed URL caching for external image requests ([4376be0c](https://github.com/ljquan/aitu/commit/4376be0c))
- integrate fake-indexeddb and refactor media executor ([dae0bb8a](https://github.com/ljquan/aitu/commit/dae0bb8a))
- implement unified media execution and workflow enhancements ([900db04d](https://github.com/ljquan/aitu/commit/900db04d))
- add Gist management panel and enhance sync logging ([061423a9](https://github.com/ljquan/aitu/commit/061423a9))
- implement soft delete and data recovery features ([3a93bf08](https://github.com/ljquan/aitu/commit/3a93bf08))
- 任务队列同步下载远程数据时双向合并 ([27064a50](https://github.com/ljquan/aitu/commit/27064a50))
- implement deletion sync with recycle bin ([a36176ba](https://github.com/ljquan/aitu/commit/a36176ba))
- implement data encryption and synchronization enhancements ([c0518af5](https://github.com/ljquan/aitu/commit/c0518af5))
- enhance thumbnail request handling with parameter prioritization ([8b0b95bf](https://github.com/ljquan/aitu/commit/8b0b95bf))
- support opening tools via URL parameter and display tool icons in window title ([9abfb3f3](https://github.com/ljquan/aitu/commit/9abfb3f3))
- enhance board ID management via URL parameters and improve user interaction ([738f8b9b](https://github.com/ljquan/aitu/commit/738f8b9b))
- 改进工作流恢复机制和错误处理 ([d27939f8](https://github.com/ljquan/aitu/commit/d27939f8))
- move ai_analyze to SW and improve debug panel logging ([50c94058](https://github.com/ljquan/aitu/commit/50c94058))
- implement LLM API log selection and batch actions ([070801ca](https://github.com/ljquan/aitu/commit/070801ca))

### 🩹 Fixes

- 修复外部签名 URL 的 CORS 和参数破坏问题 ([e0491e50](https://github.com/ljquan/aitu/commit/e0491e50))
- 修复签名 URL（TOS）因 Referer 校验导致缩略图/插入/下载 403 ([262eea92](https://github.com/ljquan/aitu/commit/262eea92))
- 修复tab 同步问题 ([7c390191](https://github.com/ljquan/aitu/commit/7c390191))
- 视频任务状态 ([ea3c2ccc](https://github.com/ljquan/aitu/commit/ea3c2ccc))
- update DelegatedOperation type usage in workflow submission service ([ac40be77](https://github.com/ljquan/aitu/commit/ac40be77))
- guard video model config lookups ([16473751](https://github.com/ljquan/aitu/commit/16473751))
- 降级模式图片/视频带参考图与 1MB 限制 ([66db4935](https://github.com/ljquan/aitu/commit/66db4935))
- 修复视频 API 请求格式错误 ([0262697f](https://github.com/ljquan/aitu/commit/0262697f))
- add missing apiKey to videoConfig in SW initialization ([a1971c4e](https://github.com/ljquan/aitu/commit/a1971c4e))
- enhance workflow submission with timeout and retry logic ([84e9436c](https://github.com/ljquan/aitu/commit/84e9436c))
- enhance manifest decryption error handling ([163bcee1](https://github.com/ljquan/aitu/commit/163bcee1))
- initialize session model from global settings ([24ec69fa](https://github.com/ljquan/aitu/commit/24ec69fa))

### 🔧 Chores

- bump version to 0.5.94 ([4a96c339](https://github.com/ljquan/aitu/commit/4a96c339))
- bump version to 0.5.93 ([3f6e583c](https://github.com/ljquan/aitu/commit/3f6e583c))
- bump version to 0.5.92 ([c32b257c](https://github.com/ljquan/aitu/commit/c32b257c))
- bump version to 0.5.91 ([13442303](https://github.com/ljquan/aitu/commit/13442303))
- bump version to 0.5.90 ([773cdb08](https://github.com/ljquan/aitu/commit/773cdb08))
- 更新应用版本至 0.5.89 ([8ff11e56](https://github.com/ljquan/aitu/commit/8ff11e56))
- bump version to 0.5.89 ([85635880](https://github.com/ljquan/aitu/commit/85635880))
- update version to 0.5.88 and improve task storage handling ([1adae49f](https://github.com/ljquan/aitu/commit/1adae49f))
- bump version to 0.5.88 ([af685dde](https://github.com/ljquan/aitu/commit/af685dde))
- bump version to 0.5.87 ([de16ae04](https://github.com/ljquan/aitu/commit/de16ae04))
- bump version to 0.5.86 ([2394021b](https://github.com/ljquan/aitu/commit/2394021b))
- bump version to 0.5.85 ([8e45567e](https://github.com/ljquan/aitu/commit/8e45567e))
- bump version to 0.5.84 ([1aea9496](https://github.com/ljquan/aitu/commit/1aea9496))
- bump version to 0.5.83 ([322118fb](https://github.com/ljquan/aitu/commit/322118fb))
- bump version to 0.5.82 ([692f0eff](https://github.com/ljquan/aitu/commit/692f0eff))
- update version to 0.5.82 and adjust build time ([87a5198d](https://github.com/ljquan/aitu/commit/87a5198d))
- bump version to 0.5.81 ([3ab8846d](https://github.com/ljquan/aitu/commit/3ab8846d))
- update app version to 0.5.80 and adjust build time ([dbdb729b](https://github.com/ljquan/aitu/commit/dbdb729b))
- bump version to 0.5.80 ([e8b67aee](https://github.com/ljquan/aitu/commit/e8b67aee))
- bump version to 0.5.79 ([b175bfaf](https://github.com/ljquan/aitu/commit/b175bfaf))
- update postmessage-duplex dependency to version 1.2.0 ([2bea89d7](https://github.com/ljquan/aitu/commit/2bea89d7))
- enhance project configuration and task management ([643e69fa](https://github.com/ljquan/aitu/commit/643e69fa))
- update app version to 0.5.78 and adjust styles for mobile badge display ([afaf093b](https://github.com/ljquan/aitu/commit/afaf093b))
- bump version to 0.5.78 ([b0f3df9e](https://github.com/ljquan/aitu/commit/b0f3df9e))
- update version to 0.5.77 and adjust build time ([f11329fe](https://github.com/ljquan/aitu/commit/f11329fe))
- bump version to 0.5.77 ([e158b459](https://github.com/ljquan/aitu/commit/e158b459))
- bump version to 0.5.76 ([22ef45ad](https://github.com/ljquan/aitu/commit/22ef45ad))
- bump version to 0.5.75 ([4a0e9128](https://github.com/ljquan/aitu/commit/4a0e9128))
- update version to 0.5.74 and adjust build time ([c7eb7979](https://github.com/ljquan/aitu/commit/c7eb7979))
- bump version to 0.5.74 ([1fc59675](https://github.com/ljquan/aitu/commit/1fc59675))
- update version to 0.5.73 and improve task loading logic ([99b268e6](https://github.com/ljquan/aitu/commit/99b268e6))
- bump version to 0.5.73 ([06a61e81](https://github.com/ljquan/aitu/commit/06a61e81))
- update version to 0.5.72 and enhance LLM API logging ([3cdc13ea](https://github.com/ljquan/aitu/commit/3cdc13ea))
- bump version to 0.5.72 ([df013d28](https://github.com/ljquan/aitu/commit/df013d28))
- update app version to 0.5.71 and adjust build time ([504fee1c](https://github.com/ljquan/aitu/commit/504fee1c))
- bump version to 0.5.71 ([65d6716c](https://github.com/ljquan/aitu/commit/65d6716c))
- bump version to 0.5.70 ([9847d773](https://github.com/ljquan/aitu/commit/9847d773))
- update build time and refactor imports for consistency ([036cce52](https://github.com/ljquan/aitu/commit/036cce52))
- update app version to 0.5.69 and adjust build time in version.json ([af1fb113](https://github.com/ljquan/aitu/commit/af1fb113))
- bump version to 0.5.69 ([f51c14c0](https://github.com/ljquan/aitu/commit/f51c14c0))
- bump version to 0.5.68 ([49329c41](https://github.com/ljquan/aitu/commit/49329c41))
- update app version to 0.5.67 and adjust build time ([fedfebd4](https://github.com/ljquan/aitu/commit/fedfebd4))
- bump version to 0.5.67 ([70486b77](https://github.com/ljquan/aitu/commit/70486b77))
- bump version to 0.5.66 ([d0eafd68](https://github.com/ljquan/aitu/commit/d0eafd68))
- clean up debug console logs and fix winbox icon handling ([21a66663](https://github.com/ljquan/aitu/commit/21a66663))
- update version and build time, refine toolbar styles, and ensure consistent type exports ([4b3a7842](https://github.com/ljquan/aitu/commit/4b3a7842))
- update app version to 0.5.64 and adjust build time ([1772d5cd](https://github.com/ljquan/aitu/commit/1772d5cd))
- bump version to 0.5.64 ([c820a822](https://github.com/ljquan/aitu/commit/c820a822))
- docs: 更新 CLAUDE.md 反映多模型适配器架构 ([4bbebd99](https://github.com/ljquan/aitu/commit/4bbebd99))
- Fix seedream adapter routing and dropdown layout ([f4bb5a74](https://github.com/ljquan/aitu/commit/f4bb5a74))
- fixed:修复ppt新加的内容在上方的问题 ([f4e345f7](https://github.com/ljquan/aitu/commit/f4e345f7))
- ppt ([98a60a56](https://github.com/ljquan/aitu/commit/98a60a56))
- fix：任务状态不同步 ([8689c846](https://github.com/ljquan/aitu/commit/8689c846))
- docs(claude): 添加新规则 - RxJS事件对象引用导致React.memo失效、API错误字段类型安全 ([d553d884](https://github.com/ljquan/aitu/commit/d553d884))
- docs(claude): 添加新规则 - 数值范围转换规则、列表索引ID追踪 ([fbb91726](https://github.com/ljquan/aitu/commit/fbb91726))
- refactor: remove unused SW RPC methods and optimize communication ([e36bbc76](https://github.com/ljquan/aitu/commit/e36bbc76))
- docs(claude): 添加新规则 - 编程式选中元素需用 addSelectionWithTemporaryElements 触发渲染 ([a2b0cd01](https://github.com/ljquan/aitu/commit/a2b0cd01))
- docs(claude): 添加新规则 - 自定义 Plait 组件 onContextChanged 必须处理 viewport 变化 ([bfad96d5](https://github.com/ljquan/aitu/commit/bfad96d5))
- docs(claude): 更新规则 - 全屏展示画布局部内容改用 viewport+隐藏UI+蒙层挖洞方案 ([e09e0e80](https://github.com/ljquan/aitu/commit/e09e0e80))
- docs(claude): 添加新规则 - 全屏展示画布局部内容用 toImage 截图独立渲染 ([649c02bf](https://github.com/ljquan/aitu/commit/649c02bf))
- docs(claude): 添加新规则 - Plait Board Viewport 缩放+平移用 updateViewport 一步完成 ([643cc38d](https://github.com/ljquan/aitu/commit/643cc38d))
- fixed:本次修改解决了ai生成图片中点击提示的下拉框手机端溢出问题&agent生成长方形图片容器溢出问题 ([64c4da2d](https://github.com/ljquan/aitu/commit/64c4da2d))
- docs(claude): 添加新规则 - 模块迁移接口完整性 ([afb95640](https://github.com/ljquan/aitu/commit/afb95640))
- docs: 添加编码规则 - 统计上报旁路化 ([133b6a72](https://github.com/ljquan/aitu/commit/133b6a72))
- docs: update localhost port references from 4200 to 7200 ([5a10c4c4](https://github.com/ljquan/aitu/commit/5a10c4c4))
- docs: 添加编码规则 - 配置同步到 IndexedDB 供 SW 读取 ([db99fb6d](https://github.com/ljquan/aitu/commit/db99fb6d))
- docs: 添加编码规则 - 枚举不能使用 import type 导入 ([26360e85](https://github.com/ljquan/aitu/commit/26360e85))
- 简化方案 ([12525090](https://github.com/ljquan/aitu/commit/12525090))
- refactor: simplify architecture by removing DDD layers and unifying types ([ad341a4f](https://github.com/ljquan/aitu/commit/ad341a4f))
- docs: 添加配置对象深拷贝规则 ([0002654a](https://github.com/ljquan/aitu/commit/0002654a))
- perf: 优化同步上传性能，避免 UI 阻塞 ([cbe11e08](https://github.com/ljquan/aitu/commit/cbe11e08))
- docs: 添加 LLM API 日志记录异步任务 remoteId 规则 ([708131f7](https://github.com/ljquan/aitu/commit/708131f7))
- docs: 添加编码规则 - SW 初始化统一入口 ([f13f809a](https://github.com/ljquan/aitu/commit/f13f809a))
- docs: 添加编码规则 - 模块循环依赖处理 ([e6a39db6](https://github.com/ljquan/aitu/commit/e6a39db6))
- docs: 添加降级模式任务执行规则 ([e0f459a6](https://github.com/ljquan/aitu/commit/e0f459a6))
- refactor: 清理调试日志和未使用代码 ([066eb12d](https://github.com/ljquan/aitu/commit/066eb12d))
- docs: 更新工具函数规则 - 添加新模块和避免不必要包装 ([8dfcf4a3](https://github.com/ljquan/aitu/commit/8dfcf4a3))
- docs: 添加编码规则 - 降级路径功能一致性 ([5c86d02b](https://github.com/ljquan/aitu/commit/5c86d02b))
- docs: 添加 LLM 响应格式兼容性和工作流状态同步规则 ([3d844c42](https://github.com/ljquan/aitu/commit/3d844c42))
- docs: 添加编码规则 - IndexedDB 直接读取和 RPC 超时处理 ([10f953f7](https://github.com/ljquan/aitu/commit/10f953f7))
- docs: 添加同步数据格式一致性规则 ([ebb412d1](https://github.com/ljquan/aitu/commit/ebb412d1))
- docs: 添加同步模块日志规范 ([97332dc7](https://github.com/ljquan/aitu/commit/97332dc7))
- docs(claude): 添加新规则 - GitHub Gist API 批量上传大小限制 ([4e2741c9](https://github.com/ljquan/aitu/commit/4e2741c9))
- docs: 添加异步操作和事件订阅相关规则 ([a95ddd20](https://github.com/ljquan/aitu/commit/a95ddd20))
- docs: 添加 CSS 变量优先级和弹出菜单截断规则 ([8ecc8e75](https://github.com/ljquan/aitu/commit/8ecc8e75))
- docs: 添加数据安全保护编码规则 ([8a955248](https://github.com/ljquan/aitu/commit/8a955248))
- docs: 添加 SW 任务持久化规则和敏感 ID 脱敏说明 ([da0c37e1](https://github.com/ljquan/aitu/commit/da0c37e1))
- refactor(task-queue): deduplicate completed tasks and improve preview handling ([5a3b4a95](https://github.com/ljquan/aitu/commit/5a3b4a95))
- docs: 添加 SW 重发 Tool Request 延迟规则 ([fbfd0f13](https://github.com/ljquan/aitu/commit/fbfd0f13))
- docs: 更新 postmessage-duplex 规则 (v1.1.0) ([a91afda0](https://github.com/ljquan/aitu/commit/a91afda0))
- docs: 添加 postmessage-duplex 消息大小限制规则 ([597181eb](https://github.com/ljquan/aitu/commit/597181eb))
- docs: 添加 postmessage-duplex publish 模式规则 ([cac87cf4](https://github.com/ljquan/aitu/commit/cac87cf4))
- docs: 添加 postmessage-duplex 库使用规范 ([cacf6b43](https://github.com/ljquan/aitu/commit/cacf6b43))

### ❤️  Thank You

- gongchengtu <1817063960@qq.com>
- liangyufeng <l.yfeng@qq.com>
- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.94 (2026-02-09)

### 🚀 Features

- 优化PPT相关能力 ([7f592465](https://github.com/ljquan/aitu/commit/7f592465))
- 添加套索选择工具及工具栏/命令面板集成 ([0d5e1d82](https://github.com/ljquan/aitu/commit/0d5e1d82))
- 添加 Frame 和幻灯片播放功能 ([c9859671](https://github.com/ljquan/aitu/commit/c9859671))
- implement new canvas features and command palette ([47dfcf12](https://github.com/ljquan/aitu/commit/47dfcf12))
- enhance logging and error handling in WorkflowEngine ([5074339b](https://github.com/ljquan/aitu/commit/5074339b))
- improve fallback engine handling and logging in workflow submission service ([88a7199e](https://github.com/ljquan/aitu/commit/88a7199e))
- add batch clear failed tasks button in generation task list ([e303baf8](https://github.com/ljquan/aitu/commit/e303baf8))
- enhance logging and error handling in AI analysis and agent execution ([cc03ce1c](https://github.com/ljquan/aitu/commit/cc03ce1c))
- enhance session replay management and error handling ([8a190371](https://github.com/ljquan/aitu/commit/8a190371))
- improve Service Worker channel validation for streaming API calls ([8f81e6ef](https://github.com/ljquan/aitu/commit/8f81e6ef))
- unify Service Worker availability checks and enforce main thread executor in fallback scenarios ([e27d14e0](https://github.com/ljquan/aitu/commit/e27d14e0))
- enhance workflow submission and error handling ([3365fdfc](https://github.com/ljquan/aitu/commit/3365fdfc))
- optimize analytics reporting and payload management ([fef7bf06](https://github.com/ljquan/aitu/commit/fef7bf06))

### 🩹 Fixes

- 修复tab 同步问题 ([7c390191](https://github.com/ljquan/aitu/commit/7c390191))
- 视频任务状态 ([ea3c2ccc](https://github.com/ljquan/aitu/commit/ea3c2ccc))
- update DelegatedOperation type usage in workflow submission service ([ac40be77](https://github.com/ljquan/aitu/commit/ac40be77))
- guard video model config lookups ([16473751](https://github.com/ljquan/aitu/commit/16473751))
- 降级模式图片/视频带参考图与 1MB 限制 ([66db4935](https://github.com/ljquan/aitu/commit/66db4935))
- 修复视频 API 请求格式错误 ([0262697f](https://github.com/ljquan/aitu/commit/0262697f))

### 🔧 Chores

- bump version to 0.5.93 ([3f6e583c](https://github.com/ljquan/aitu/commit/3f6e583c))
- bump version to 0.5.92 ([c32b257c](https://github.com/ljquan/aitu/commit/c32b257c))
- bump version to 0.5.91 ([13442303](https://github.com/ljquan/aitu/commit/13442303))
- bump version to 0.5.90 ([773cdb08](https://github.com/ljquan/aitu/commit/773cdb08))
- 更新应用版本至 0.5.89 ([8ff11e56](https://github.com/ljquan/aitu/commit/8ff11e56))
- bump version to 0.5.89 ([85635880](https://github.com/ljquan/aitu/commit/85635880))
- update version to 0.5.88 and improve task storage handling ([1adae49f](https://github.com/ljquan/aitu/commit/1adae49f))
- bump version to 0.5.88 ([af685dde](https://github.com/ljquan/aitu/commit/af685dde))
- bump version to 0.5.87 ([de16ae04](https://github.com/ljquan/aitu/commit/de16ae04))
- bump version to 0.5.86 ([2394021b](https://github.com/ljquan/aitu/commit/2394021b))
- bump version to 0.5.85 ([8e45567e](https://github.com/ljquan/aitu/commit/8e45567e))
- bump version to 0.5.84 ([1aea9496](https://github.com/ljquan/aitu/commit/1aea9496))
- bump version to 0.5.83 ([322118fb](https://github.com/ljquan/aitu/commit/322118fb))
- bump version to 0.5.82 ([692f0eff](https://github.com/ljquan/aitu/commit/692f0eff))
- update version to 0.5.82 and adjust build time ([87a5198d](https://github.com/ljquan/aitu/commit/87a5198d))
- bump version to 0.5.81 ([3ab8846d](https://github.com/ljquan/aitu/commit/3ab8846d))
- update app version to 0.5.80 and adjust build time ([dbdb729b](https://github.com/ljquan/aitu/commit/dbdb729b))
- bump version to 0.5.80 ([e8b67aee](https://github.com/ljquan/aitu/commit/e8b67aee))
- bump version to 0.5.79 ([b175bfaf](https://github.com/ljquan/aitu/commit/b175bfaf))
- update postmessage-duplex dependency to version 1.2.0 ([2bea89d7](https://github.com/ljquan/aitu/commit/2bea89d7))
- enhance project configuration and task management ([643e69fa](https://github.com/ljquan/aitu/commit/643e69fa))
- update app version to 0.5.78 and adjust styles for mobile badge display ([afaf093b](https://github.com/ljquan/aitu/commit/afaf093b))
- ppt ([98a60a56](https://github.com/ljquan/aitu/commit/98a60a56))
- fix：任务状态不同步 ([8689c846](https://github.com/ljquan/aitu/commit/8689c846))
- docs(claude): 添加新规则 - RxJS事件对象引用导致React.memo失效、API错误字段类型安全 ([d553d884](https://github.com/ljquan/aitu/commit/d553d884))
- docs(claude): 添加新规则 - 数值范围转换规则、列表索引ID追踪 ([fbb91726](https://github.com/ljquan/aitu/commit/fbb91726))
- refactor: remove unused SW RPC methods and optimize communication ([e36bbc76](https://github.com/ljquan/aitu/commit/e36bbc76))
- docs(claude): 添加新规则 - 编程式选中元素需用 addSelectionWithTemporaryElements 触发渲染 ([a2b0cd01](https://github.com/ljquan/aitu/commit/a2b0cd01))
- docs(claude): 添加新规则 - 自定义 Plait 组件 onContextChanged 必须处理 viewport 变化 ([bfad96d5](https://github.com/ljquan/aitu/commit/bfad96d5))
- docs(claude): 更新规则 - 全屏展示画布局部内容改用 viewport+隐藏UI+蒙层挖洞方案 ([e09e0e80](https://github.com/ljquan/aitu/commit/e09e0e80))
- docs(claude): 添加新规则 - 全屏展示画布局部内容用 toImage 截图独立渲染 ([649c02bf](https://github.com/ljquan/aitu/commit/649c02bf))
- docs(claude): 添加新规则 - Plait Board Viewport 缩放+平移用 updateViewport 一步完成 ([643cc38d](https://github.com/ljquan/aitu/commit/643cc38d))
- fixed:本次修改解决了ai生成图片中点击提示的下拉框手机端溢出问题&agent生成长方形图片容器溢出问题 ([64c4da2d](https://github.com/ljquan/aitu/commit/64c4da2d))
- docs(claude): 添加新规则 - 模块迁移接口完整性 ([afb95640](https://github.com/ljquan/aitu/commit/afb95640))
- docs: 添加编码规则 - 统计上报旁路化 ([133b6a72](https://github.com/ljquan/aitu/commit/133b6a72))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>
- liangyufeng <l.yfeng@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.91 (2026-02-08)

### 🩹 Fixes

- 视频任务状态 ([ea3c2ccc](https://github.com/ljquan/aitu/commit/ea3c2ccc))

### 🔧 Chores

- docs(claude): 添加新规则 - 数值范围转换规则、列表索引ID追踪 ([fbb91726](https://github.com/ljquan/aitu/commit/fbb91726))
- refactor: remove unused SW RPC methods and optimize communication ([e36bbc76](https://github.com/ljquan/aitu/commit/e36bbc76))
- fixed:本次修改解决了ai生成图片中点击提示的下拉框手机端溢出问题&agent生成长方形图片容器溢出问题 ([64c4da2d](https://github.com/ljquan/aitu/commit/64c4da2d))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liangyufeng <l.yfeng@qq.com>

## 0.5.90 (2026-02-08)

### 🚀 Features

- 添加套索选择工具及工具栏/命令面板集成 ([0d5e1d82](https://github.com/ljquan/aitu/commit/0d5e1d82))

### 🔧 Chores

- 更新应用版本至 0.5.89 ([8ff11e56](https://github.com/ljquan/aitu/commit/8ff11e56))
- docs(claude): 添加新规则 - 编程式选中元素需用 addSelectionWithTemporaryElements 触发渲染 ([a2b0cd01](https://github.com/ljquan/aitu/commit/a2b0cd01))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.89 (2026-02-08)

### 🚀 Features

- 添加 Frame 和幻灯片播放功能 ([c9859671](https://github.com/ljquan/aitu/commit/c9859671))
- implement new canvas features and command palette ([47dfcf12](https://github.com/ljquan/aitu/commit/47dfcf12))

### 🔧 Chores

- update version to 0.5.88 and improve task storage handling ([1adae49f](https://github.com/ljquan/aitu/commit/1adae49f))
- docs(claude): 添加新规则 - 自定义 Plait 组件 onContextChanged 必须处理 viewport 变化 ([bfad96d5](https://github.com/ljquan/aitu/commit/bfad96d5))
- docs(claude): 更新规则 - 全屏展示画布局部内容改用 viewport+隐藏UI+蒙层挖洞方案 ([e09e0e80](https://github.com/ljquan/aitu/commit/e09e0e80))
- docs(claude): 添加新规则 - 全屏展示画布局部内容用 toImage 截图独立渲染 ([649c02bf](https://github.com/ljquan/aitu/commit/649c02bf))
- docs(claude): 添加新规则 - Plait Board Viewport 缩放+平移用 updateViewport 一步完成 ([643cc38d](https://github.com/ljquan/aitu/commit/643cc38d))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.87 (2026-02-07)

### 🚀 Features

- enhance logging and error handling in WorkflowEngine ([5074339b](https://github.com/ljquan/aitu/commit/5074339b))

### 🔧 Chores

- bump version to 0.5.86 ([2394021b](https://github.com/ljquan/aitu/commit/2394021b))
- bump version to 0.5.85 ([8e45567e](https://github.com/ljquan/aitu/commit/8e45567e))
- bump version to 0.5.84 ([1aea9496](https://github.com/ljquan/aitu/commit/1aea9496))
- docs(claude): 添加新规则 - 模块迁移接口完整性 ([afb95640](https://github.com/ljquan/aitu/commit/afb95640))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.86 (2026-02-07)

### 🚀 Features

- improve fallback engine handling and logging in workflow submission service ([88a7199e](https://github.com/ljquan/aitu/commit/88a7199e))

### 🩹 Fixes

- update DelegatedOperation type usage in workflow submission service ([ac40be77](https://github.com/ljquan/aitu/commit/ac40be77))

### 🔧 Chores

- bump version to 0.5.85 ([694d1ca6](https://github.com/ljquan/aitu/commit/694d1ca6))
- bump version to 0.5.84 ([9e307468](https://github.com/ljquan/aitu/commit/9e307468))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.85 (2026-02-07)

### 🚀 Features

- add batch clear failed tasks button in generation task list ([e303baf8](https://github.com/ljquan/aitu/commit/e303baf8))

### 🩹 Fixes

- guard video model config lookups ([16473751](https://github.com/ljquan/aitu/commit/16473751))
- 修复视频 API 请求格式错误 ([0262697f](https://github.com/ljquan/aitu/commit/0262697f))

### 🔧 Chores

- bump version to 0.5.84 ([fd194ee7](https://github.com/ljquan/aitu/commit/fd194ee7))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liangyufeng <l.yfeng@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.84 (2026-02-07)

### 🔧 Chores

- update version to 0.5.82 and adjust build time ([87a5198d](https://github.com/ljquan/aitu/commit/87a5198d))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.83 (2026-02-07)

### 🚀 Features

- enhance logging and error handling in AI analysis and agent execution ([cc03ce1c](https://github.com/ljquan/aitu/commit/cc03ce1c))

### 🔧 Chores

- bump version to 0.5.82 ([692f0eff](https://github.com/ljquan/aitu/commit/692f0eff))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.82 (2026-02-07)

### 🚀 Features

- enhance session replay management and error handling ([8a190371](https://github.com/ljquan/aitu/commit/8a190371))
- improve Service Worker channel validation for streaming API calls ([8f81e6ef](https://github.com/ljquan/aitu/commit/8f81e6ef))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.81 (2026-02-07)

### 🚀 Features

- unify Service Worker availability checks and enforce main thread executor in fallback scenarios ([e27d14e0](https://github.com/ljquan/aitu/commit/e27d14e0))
- enhance workflow submission and error handling ([3365fdfc](https://github.com/ljquan/aitu/commit/3365fdfc))

### 🔧 Chores

- update app version to 0.5.80 and adjust build time ([dbdb729b](https://github.com/ljquan/aitu/commit/dbdb729b))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.79 (2026-02-06)

### 🚀 Features

- optimize analytics reporting and payload management ([fef7bf06](https://github.com/ljquan/aitu/commit/fef7bf06))
- add custom tools sync and prevent remote task resumption ([f296875d](https://github.com/ljquan/aitu/commit/f296875d))
- implement workflow handler initialization from IndexedDB ([943419ec](https://github.com/ljquan/aitu/commit/943419ec))
- enhance error handling and logging in Service Worker and task management ([167a559a](https://github.com/ljquan/aitu/commit/167a559a))
- implement video model adapters and enhance video generation ([982313f3](https://github.com/ljquan/aitu/commit/982313f3))
- enhance SW task queue service with fallback mechanisms and canvas operation handling ([390bb155](https://github.com/ljquan/aitu/commit/390bb155))
- add base64 image preview functionality ([fba4fe7f](https://github.com/ljquan/aitu/commit/fba4fe7f))
- implement image fitting utility and enhance video processing ([25746d6b](https://github.com/ljquan/aitu/commit/25746d6b))

### 🩹 Fixes

- 降级模式图片/视频带参考图与 1MB 限制 ([66db4935](https://github.com/ljquan/aitu/commit/66db4935))
- add missing apiKey to videoConfig in SW initialization ([a1971c4e](https://github.com/ljquan/aitu/commit/a1971c4e))

### 🔧 Chores

- update postmessage-duplex dependency to version 1.2.0 ([2bea89d7](https://github.com/ljquan/aitu/commit/2bea89d7))
- enhance project configuration and task management ([643e69fa](https://github.com/ljquan/aitu/commit/643e69fa))
- update app version to 0.5.78 and adjust styles for mobile badge display ([afaf093b](https://github.com/ljquan/aitu/commit/afaf093b))
- bump version to 0.5.78 ([b0f3df9e](https://github.com/ljquan/aitu/commit/b0f3df9e))
- update version to 0.5.77 and adjust build time ([f11329fe](https://github.com/ljquan/aitu/commit/f11329fe))
- bump version to 0.5.77 ([e158b459](https://github.com/ljquan/aitu/commit/e158b459))
- bump version to 0.5.76 ([22ef45ad](https://github.com/ljquan/aitu/commit/22ef45ad))
- bump version to 0.5.75 ([4a0e9128](https://github.com/ljquan/aitu/commit/4a0e9128))
- update version to 0.5.74 and adjust build time ([c7eb7979](https://github.com/ljquan/aitu/commit/c7eb7979))
- bump version to 0.5.74 ([1fc59675](https://github.com/ljquan/aitu/commit/1fc59675))
- update version to 0.5.73 and improve task loading logic ([99b268e6](https://github.com/ljquan/aitu/commit/99b268e6))
- bump version to 0.5.73 ([06a61e81](https://github.com/ljquan/aitu/commit/06a61e81))
- update version to 0.5.72 and enhance LLM API logging ([3cdc13ea](https://github.com/ljquan/aitu/commit/3cdc13ea))
- bump version to 0.5.72 ([df013d28](https://github.com/ljquan/aitu/commit/df013d28))
- update app version to 0.5.71 and adjust build time ([504fee1c](https://github.com/ljquan/aitu/commit/504fee1c))
- docs: 添加编码规则 - 统计上报旁路化 ([133b6a72](https://github.com/ljquan/aitu/commit/133b6a72))
- docs: update localhost port references from 4200 to 7200 ([5a10c4c4](https://github.com/ljquan/aitu/commit/5a10c4c4))
- docs: 添加编码规则 - 配置同步到 IndexedDB 供 SW 读取 ([db99fb6d](https://github.com/ljquan/aitu/commit/db99fb6d))
- docs: 添加编码规则 - 枚举不能使用 import type 导入 ([26360e85](https://github.com/ljquan/aitu/commit/26360e85))
- 简化方案 ([12525090](https://github.com/ljquan/aitu/commit/12525090))
- refactor: simplify architecture by removing DDD layers and unifying types ([ad341a4f](https://github.com/ljquan/aitu/commit/ad341a4f))
- docs: 添加配置对象深拷贝规则 ([0002654a](https://github.com/ljquan/aitu/commit/0002654a))
- perf: 优化同步上传性能，避免 UI 阻塞 ([cbe11e08](https://github.com/ljquan/aitu/commit/cbe11e08))
- docs: 添加 LLM API 日志记录异步任务 remoteId 规则 ([708131f7](https://github.com/ljquan/aitu/commit/708131f7))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.78 (2026-02-06)

### 🚀 Features

- add custom tools sync and prevent remote task resumption ([f296875](https://github.com/ljquan/aitu/commit/f296875))
- implement workflow handler initialization from IndexedDB ([943419e](https://github.com/ljquan/aitu/commit/943419e))
- enhance error handling and logging in Service Worker and task management ([167a559](https://github.com/ljquan/aitu/commit/167a559))
- implement video model adapters and enhance video generation ([982313f](https://github.com/ljquan/aitu/commit/982313f))
- enhance SW task queue service with fallback mechanisms and canvas operation handling ([390bb15](https://github.com/ljquan/aitu/commit/390bb15))
- add base64 image preview functionality ([fba4fe7](https://github.com/ljquan/aitu/commit/fba4fe7))

### 🩹 Fixes

- add missing apiKey to videoConfig in SW initialization ([a1971c4](https://github.com/ljquan/aitu/commit/a1971c4))

### 🔧 Chores

- update version to 0.5.77 and adjust build time ([f11329f](https://github.com/ljquan/aitu/commit/f11329f))
- bump version to 0.5.77 ([e158b45](https://github.com/ljquan/aitu/commit/e158b45))
- bump version to 0.5.76 ([22ef45a](https://github.com/ljquan/aitu/commit/22ef45a))
- bump version to 0.5.75 ([4a0e912](https://github.com/ljquan/aitu/commit/4a0e912))
- update version to 0.5.74 and adjust build time ([c7eb797](https://github.com/ljquan/aitu/commit/c7eb797))
- docs: update localhost port references from 4200 to 7200 ([5a10c4c](https://github.com/ljquan/aitu/commit/5a10c4c))
- docs: 添加编码规则 - 配置同步到 IndexedDB 供 SW 读取 ([db99fb6](https://github.com/ljquan/aitu/commit/db99fb6))
- docs: 添加编码规则 - 枚举不能使用 import type 导入 ([26360e8](https://github.com/ljquan/aitu/commit/26360e8))
- 简化方案 ([1252509](https://github.com/ljquan/aitu/commit/1252509))
- refactor: simplify architecture by removing DDD layers and unifying types ([ad341a4](https://github.com/ljquan/aitu/commit/ad341a4))
- docs: 添加配置对象深拷贝规则 ([0002654](https://github.com/ljquan/aitu/commit/0002654))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.76 (2026-02-05)

### 🚀 Features

- add base64 image preview functionality ([fba4fe7](https://github.com/ljquan/aitu/commit/fba4fe7))

### 🔧 Chores

- docs: 添加配置对象深拷贝规则 ([0002654](https://github.com/ljquan/aitu/commit/0002654))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.75 (2026-02-05)

### 🚀 Features

- implement image fitting utility and enhance video processing ([25746d6](https://github.com/ljquan/aitu/commit/25746d6))
- enhance analytics and reporting functionality ([30a9bbf](https://github.com/ljquan/aitu/commit/30a9bbf))
- enhance video handling and task queue management ([4757a0d](https://github.com/ljquan/aitu/commit/4757a0d))
- add master badge and enhance Gist handling ([1dc71a9](https://github.com/ljquan/aitu/commit/1dc71a9))
- implement failed URL caching for external image requests ([4376be0](https://github.com/ljquan/aitu/commit/4376be0))
- integrate fake-indexeddb and refactor media executor ([dae0bb8](https://github.com/ljquan/aitu/commit/dae0bb8))
- implement unified media execution and workflow enhancements ([900db04](https://github.com/ljquan/aitu/commit/900db04))
- add Gist management panel and enhance sync logging ([061423a](https://github.com/ljquan/aitu/commit/061423a))
- implement soft delete and data recovery features ([3a93bf0](https://github.com/ljquan/aitu/commit/3a93bf0))
- 任务队列同步下载远程数据时双向合并 ([27064a5](https://github.com/ljquan/aitu/commit/27064a5))
- implement deletion sync with recycle bin ([a36176b](https://github.com/ljquan/aitu/commit/a36176b))
- implement data encryption and synchronization enhancements ([c0518af](https://github.com/ljquan/aitu/commit/c0518af))
- enhance thumbnail request handling with parameter prioritization ([8b0b95b](https://github.com/ljquan/aitu/commit/8b0b95b))
- support opening tools via URL parameter and display tool icons in window title ([9abfb3f](https://github.com/ljquan/aitu/commit/9abfb3f))
- enhance board ID management via URL parameters and improve user interaction ([738f8b9](https://github.com/ljquan/aitu/commit/738f8b9))
- 改进工作流恢复机制和错误处理 ([d27939f](https://github.com/ljquan/aitu/commit/d27939f))
- move ai_analyze to SW and improve debug panel logging ([50c9405](https://github.com/ljquan/aitu/commit/50c9405))
- implement LLM API log selection and batch actions ([070801c](https://github.com/ljquan/aitu/commit/070801c))

### 🩹 Fixes

- enhance workflow submission with timeout and retry logic ([84e9436](https://github.com/ljquan/aitu/commit/84e9436))
- enhance manifest decryption error handling ([163bcee](https://github.com/ljquan/aitu/commit/163bcee))
- initialize session model from global settings ([24ec69f](https://github.com/ljquan/aitu/commit/24ec69f))

### 🔧 Chores

- update version to 0.5.74 and adjust build time ([c7eb797](https://github.com/ljquan/aitu/commit/c7eb797))
- bump version to 0.5.74 ([1fc5967](https://github.com/ljquan/aitu/commit/1fc5967))
- update version to 0.5.73 and improve task loading logic ([99b268e](https://github.com/ljquan/aitu/commit/99b268e))
- bump version to 0.5.73 ([06a61e8](https://github.com/ljquan/aitu/commit/06a61e8))
- update version to 0.5.72 and enhance LLM API logging ([3cdc13e](https://github.com/ljquan/aitu/commit/3cdc13e))
- bump version to 0.5.72 ([df013d2](https://github.com/ljquan/aitu/commit/df013d2))
- update app version to 0.5.71 and adjust build time ([504fee1](https://github.com/ljquan/aitu/commit/504fee1))
- bump version to 0.5.71 ([65d6716](https://github.com/ljquan/aitu/commit/65d6716))
- bump version to 0.5.70 ([9847d77](https://github.com/ljquan/aitu/commit/9847d77))
- update build time and refactor imports for consistency ([036cce5](https://github.com/ljquan/aitu/commit/036cce5))
- update app version to 0.5.69 and adjust build time in version.json ([af1fb11](https://github.com/ljquan/aitu/commit/af1fb11))
- bump version to 0.5.69 ([f51c14c](https://github.com/ljquan/aitu/commit/f51c14c))
- bump version to 0.5.68 ([49329c4](https://github.com/ljquan/aitu/commit/49329c4))
- update app version to 0.5.67 and adjust build time ([fedfebd](https://github.com/ljquan/aitu/commit/fedfebd))
- bump version to 0.5.67 ([70486b7](https://github.com/ljquan/aitu/commit/70486b7))
- bump version to 0.5.66 ([d0eafd6](https://github.com/ljquan/aitu/commit/d0eafd6))
- clean up debug console logs and fix winbox icon handling ([21a6666](https://github.com/ljquan/aitu/commit/21a6666))
- update version and build time, refine toolbar styles, and ensure consistent type exports ([4b3a784](https://github.com/ljquan/aitu/commit/4b3a784))
- update app version to 0.5.64 and adjust build time ([1772d5c](https://github.com/ljquan/aitu/commit/1772d5c))
- perf: 优化同步上传性能，避免 UI 阻塞 ([cbe11e0](https://github.com/ljquan/aitu/commit/cbe11e0))
- docs: 添加 LLM API 日志记录异步任务 remoteId 规则 ([708131f](https://github.com/ljquan/aitu/commit/708131f))
- docs: 添加编码规则 - SW 初始化统一入口 ([f13f809](https://github.com/ljquan/aitu/commit/f13f809))
- docs: 添加编码规则 - 模块循环依赖处理 ([e6a39db](https://github.com/ljquan/aitu/commit/e6a39db))
- docs: 添加降级模式任务执行规则 ([e0f459a](https://github.com/ljquan/aitu/commit/e0f459a))
- refactor: 清理调试日志和未使用代码 ([066eb12](https://github.com/ljquan/aitu/commit/066eb12))
- docs: 更新工具函数规则 - 添加新模块和避免不必要包装 ([8dfcf4a](https://github.com/ljquan/aitu/commit/8dfcf4a))
- docs: 添加编码规则 - 降级路径功能一致性 ([5c86d02](https://github.com/ljquan/aitu/commit/5c86d02))
- docs: 添加 LLM 响应格式兼容性和工作流状态同步规则 ([3d844c4](https://github.com/ljquan/aitu/commit/3d844c4))
- docs: 添加编码规则 - IndexedDB 直接读取和 RPC 超时处理 ([10f953f](https://github.com/ljquan/aitu/commit/10f953f))
- docs: 添加同步数据格式一致性规则 ([ebb412d](https://github.com/ljquan/aitu/commit/ebb412d))
- docs: 添加同步模块日志规范 ([97332dc](https://github.com/ljquan/aitu/commit/97332dc))
- docs(claude): 添加新规则 - GitHub Gist API 批量上传大小限制 ([4e2741c](https://github.com/ljquan/aitu/commit/4e2741c))
- docs: 添加异步操作和事件订阅相关规则 ([a95ddd2](https://github.com/ljquan/aitu/commit/a95ddd2))
- docs: 添加 CSS 变量优先级和弹出菜单截断规则 ([8ecc8e7](https://github.com/ljquan/aitu/commit/8ecc8e7))
- docs: 添加数据安全保护编码规则 ([8a95524](https://github.com/ljquan/aitu/commit/8a95524))
- docs: 添加 SW 任务持久化规则和敏感 ID 脱敏说明 ([da0c37e](https://github.com/ljquan/aitu/commit/da0c37e))
- refactor(task-queue): deduplicate completed tasks and improve preview handling ([5a3b4a9](https://github.com/ljquan/aitu/commit/5a3b4a9))
- docs: 添加 SW 重发 Tool Request 延迟规则 ([fbfd0f1](https://github.com/ljquan/aitu/commit/fbfd0f1))
- docs: 更新 postmessage-duplex 规则 (v1.1.0) ([a91afda](https://github.com/ljquan/aitu/commit/a91afda))
- docs: 添加 postmessage-duplex 消息大小限制规则 ([597181e](https://github.com/ljquan/aitu/commit/597181e))
- docs: 添加 postmessage-duplex publish 模式规则 ([cac87cf](https://github.com/ljquan/aitu/commit/cac87cf))
- docs: 添加 postmessage-duplex 库使用规范 ([cacf6b4](https://github.com/ljquan/aitu/commit/cacf6b4))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.74 (2026-02-05)

### 🔧 Chores

- update version to 0.5.73 and improve task loading logic ([99b268e](https://github.com/ljquan/aitu/commit/99b268e))
- perf: 优化同步上传性能，避免 UI 阻塞 ([cbe11e0](https://github.com/ljquan/aitu/commit/cbe11e0))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.73 (2026-02-05)

### 🚀 Features

- implement image fitting utility and enhance video processing ([25746d6](https://github.com/ljquan/aitu/commit/25746d6))

### 🔧 Chores

- update version to 0.5.72 and enhance LLM API logging ([3cdc13e](https://github.com/ljquan/aitu/commit/3cdc13e))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.72 (2026-02-05)

### 🚀 Features

- enhance analytics and reporting functionality ([30a9bbf](https://github.com/ljquan/aitu/commit/30a9bbf))
- enhance video handling and task queue management ([4757a0d](https://github.com/ljquan/aitu/commit/4757a0d))
- add master badge and enhance Gist handling ([1dc71a9](https://github.com/ljquan/aitu/commit/1dc71a9))
- implement failed URL caching for external image requests ([4376be0](https://github.com/ljquan/aitu/commit/4376be0))

### 🔧 Chores

- update app version to 0.5.71 and adjust build time ([504fee1](https://github.com/ljquan/aitu/commit/504fee1))
- bump version to 0.5.71 ([65d6716](https://github.com/ljquan/aitu/commit/65d6716))
- docs: 添加 LLM API 日志记录异步任务 remoteId 规则 ([708131f](https://github.com/ljquan/aitu/commit/708131f))
- docs: 添加编码规则 - SW 初始化统一入口 ([f13f809](https://github.com/ljquan/aitu/commit/f13f809))
- docs: 添加编码规则 - 模块循环依赖处理 ([e6a39db](https://github.com/ljquan/aitu/commit/e6a39db))
- docs: 添加降级模式任务执行规则 ([e0f459a](https://github.com/ljquan/aitu/commit/e0f459a))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.71 (2026-02-05)

### 🚀 Features

- enhance analytics and reporting functionality ([30a9bbfd](https://github.com/ljquan/aitu/commit/30a9bbfd))
- enhance video handling and task queue management ([4757a0d4](https://github.com/ljquan/aitu/commit/4757a0d4))
- add master badge and enhance Gist handling ([1dc71a99](https://github.com/ljquan/aitu/commit/1dc71a99))
- implement failed URL caching for external image requests ([4376be0c](https://github.com/ljquan/aitu/commit/4376be0c))
- integrate fake-indexeddb and refactor media executor ([dae0bb8a](https://github.com/ljquan/aitu/commit/dae0bb8a))
- implement unified media execution and workflow enhancements ([900db04d](https://github.com/ljquan/aitu/commit/900db04d))
- add Gist management panel and enhance sync logging ([061423a9](https://github.com/ljquan/aitu/commit/061423a9))

### 🩹 Fixes

- enhance workflow submission with timeout and retry logic ([84e9436c](https://github.com/ljquan/aitu/commit/84e9436c))

### 🔧 Chores

- bump version to 0.5.70 ([9847d773](https://github.com/ljquan/aitu/commit/9847d773))
- update build time and refactor imports for consistency ([036cce52](https://github.com/ljquan/aitu/commit/036cce52))
- update app version to 0.5.69 and adjust build time in version.json ([af1fb113](https://github.com/ljquan/aitu/commit/af1fb113))
- bump version to 0.5.69 ([f51c14c0](https://github.com/ljquan/aitu/commit/f51c14c0))
- docs: 添加编码规则 - SW 初始化统一入口 ([f13f809a](https://github.com/ljquan/aitu/commit/f13f809a))
- docs: 添加编码规则 - 模块循环依赖处理 ([e6a39db6](https://github.com/ljquan/aitu/commit/e6a39db6))
- docs: 添加降级模式任务执行规则 ([e0f459a6](https://github.com/ljquan/aitu/commit/e0f459a6))
- refactor: 清理调试日志和未使用代码 ([066eb12d](https://github.com/ljquan/aitu/commit/066eb12d))
- docs: 更新工具函数规则 - 添加新模块和避免不必要包装 ([8dfcf4a3](https://github.com/ljquan/aitu/commit/8dfcf4a3))
- docs: 添加编码规则 - 降级路径功能一致性 ([5c86d02b](https://github.com/ljquan/aitu/commit/5c86d02b))
- docs: 添加 LLM 响应格式兼容性和工作流状态同步规则 ([3d844c42](https://github.com/ljquan/aitu/commit/3d844c42))
- docs: 添加编码规则 - IndexedDB 直接读取和 RPC 超时处理 ([10f953f7](https://github.com/ljquan/aitu/commit/10f953f7))
- docs: 添加同步数据格式一致性规则 ([ebb412d1](https://github.com/ljquan/aitu/commit/ebb412d1))
- docs: 添加同步模块日志规范 ([97332dc7](https://github.com/ljquan/aitu/commit/97332dc7))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.70 (2026-02-04)

### 🚀 Features

- integrate fake-indexeddb and refactor media executor ([dae0bb8](https://github.com/ljquan/aitu/commit/dae0bb8))

### 🔧 Chores

- update build time and refactor imports for consistency ([036cce5](https://github.com/ljquan/aitu/commit/036cce5))
- update app version to 0.5.69 and adjust build time in version.json ([af1fb11](https://github.com/ljquan/aitu/commit/af1fb11))
- refactor: 清理调试日志和未使用代码 ([066eb12](https://github.com/ljquan/aitu/commit/066eb12))
- docs: 更新工具函数规则 - 添加新模块和避免不必要包装 ([8dfcf4a](https://github.com/ljquan/aitu/commit/8dfcf4a))
- docs: 添加编码规则 - 降级路径功能一致性 ([5c86d02](https://github.com/ljquan/aitu/commit/5c86d02))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.69 (2026-02-04)

### 🚀 Features

- implement unified media execution and workflow enhancements ([900db04](https://github.com/ljquan/aitu/commit/900db04))
- add Gist management panel and enhance sync logging ([061423a](https://github.com/ljquan/aitu/commit/061423a))
- implement soft delete and data recovery features ([3a93bf0](https://github.com/ljquan/aitu/commit/3a93bf0))
- 任务队列同步下载远程数据时双向合并 ([27064a5](https://github.com/ljquan/aitu/commit/27064a5))
- implement deletion sync with recycle bin ([a36176b](https://github.com/ljquan/aitu/commit/a36176b))
- implement data encryption and synchronization enhancements ([c0518af](https://github.com/ljquan/aitu/commit/c0518af))
- enhance thumbnail request handling with parameter prioritization ([8b0b95b](https://github.com/ljquan/aitu/commit/8b0b95b))
- support opening tools via URL parameter and display tool icons in window title ([9abfb3f](https://github.com/ljquan/aitu/commit/9abfb3f))
- enhance board ID management via URL parameters and improve user interaction ([738f8b9](https://github.com/ljquan/aitu/commit/738f8b9))
- 改进工作流恢复机制和错误处理 ([d27939f](https://github.com/ljquan/aitu/commit/d27939f))
- move ai_analyze to SW and improve debug panel logging ([50c9405](https://github.com/ljquan/aitu/commit/50c9405))
- implement LLM API log selection and batch actions ([070801c](https://github.com/ljquan/aitu/commit/070801c))
- support async models with size and references ([e85dda8](https://github.com/ljquan/aitu/commit/e85dda8))
- implement auto-compression for 10-25MB images ([c26cbec](https://github.com/ljquan/aitu/commit/c26cbec))

### 🩹 Fixes

- enhance workflow submission with timeout and retry logic ([84e9436](https://github.com/ljquan/aitu/commit/84e9436))
- enhance manifest decryption error handling ([163bcee](https://github.com/ljquan/aitu/commit/163bcee))
- initialize session model from global settings ([24ec69f](https://github.com/ljquan/aitu/commit/24ec69f))

### 🔧 Chores

- bump version to 0.5.68 ([49329c4](https://github.com/ljquan/aitu/commit/49329c4))
- update app version to 0.5.67 and adjust build time ([fedfebd](https://github.com/ljquan/aitu/commit/fedfebd))
- bump version to 0.5.67 ([70486b7](https://github.com/ljquan/aitu/commit/70486b7))
- bump version to 0.5.66 ([d0eafd6](https://github.com/ljquan/aitu/commit/d0eafd6))
- clean up debug console logs and fix winbox icon handling ([21a6666](https://github.com/ljquan/aitu/commit/21a6666))
- update version and build time, refine toolbar styles, and ensure consistent type exports ([4b3a784](https://github.com/ljquan/aitu/commit/4b3a784))
- update app version to 0.5.64 and adjust build time ([1772d5c](https://github.com/ljquan/aitu/commit/1772d5c))
- bump version to 0.5.64 ([c820a82](https://github.com/ljquan/aitu/commit/c820a82))
- update release script and bump app version to 0.5.63 ([8b36e88](https://github.com/ljquan/aitu/commit/8b36e88))
- docs: 添加 LLM 响应格式兼容性和工作流状态同步规则 ([3d844c4](https://github.com/ljquan/aitu/commit/3d844c4))
- docs: 添加编码规则 - IndexedDB 直接读取和 RPC 超时处理 ([10f953f](https://github.com/ljquan/aitu/commit/10f953f))
- docs: 添加同步数据格式一致性规则 ([ebb412d](https://github.com/ljquan/aitu/commit/ebb412d))
- docs: 添加同步模块日志规范 ([97332dc](https://github.com/ljquan/aitu/commit/97332dc))
- docs(claude): 添加新规则 - GitHub Gist API 批量上传大小限制 ([4e2741c](https://github.com/ljquan/aitu/commit/4e2741c))
- docs: 添加异步操作和事件订阅相关规则 ([a95ddd2](https://github.com/ljquan/aitu/commit/a95ddd2))
- docs: 添加 CSS 变量优先级和弹出菜单截断规则 ([8ecc8e7](https://github.com/ljquan/aitu/commit/8ecc8e7))
- docs: 添加数据安全保护编码规则 ([8a95524](https://github.com/ljquan/aitu/commit/8a95524))
- docs: 添加 SW 任务持久化规则和敏感 ID 脱敏说明 ([da0c37e](https://github.com/ljquan/aitu/commit/da0c37e))
- refactor(task-queue): deduplicate completed tasks and improve preview handling ([5a3b4a9](https://github.com/ljquan/aitu/commit/5a3b4a9))
- docs: 添加 SW 重发 Tool Request 延迟规则 ([fbfd0f1](https://github.com/ljquan/aitu/commit/fbfd0f1))
- docs: 更新 postmessage-duplex 规则 (v1.1.0) ([a91afda](https://github.com/ljquan/aitu/commit/a91afda))
- docs: 添加 postmessage-duplex 消息大小限制规则 ([597181e](https://github.com/ljquan/aitu/commit/597181e))
- docs: 添加 postmessage-duplex publish 模式规则 ([cac87cf](https://github.com/ljquan/aitu/commit/cac87cf))
- docs: 添加 postmessage-duplex 库使用规范 ([cacf6b4](https://github.com/ljquan/aitu/commit/cacf6b4))
- refactor: rename project from Aitu to Opentu ([a4ca6ca](https://github.com/ljquan/aitu/commit/a4ca6ca))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- mengxiangtu <changesydneyai@gmail.com>

## 0.5.68 (2026-02-02)

### 🩹 Fixes

- enhance manifest decryption error handling ([163bcee](https://github.com/ljquan/aitu/commit/163bcee))

### 🔧 Chores

- update app version to 0.5.67 and adjust build time ([fedfebd](https://github.com/ljquan/aitu/commit/fedfebd))
- docs(claude): 添加新规则 - GitHub Gist API 批量上传大小限制 ([4e2741c](https://github.com/ljquan/aitu/commit/4e2741c))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.67 (2026-02-02)

### 🚀 Features

- implement soft delete and data recovery features ([3a93bf0](https://github.com/ljquan/aitu/commit/3a93bf0))
- 任务队列同步下载远程数据时双向合并 ([27064a5](https://github.com/ljquan/aitu/commit/27064a5))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.64 (2026-01-30)

### 🚀 Features

- support async models with size and references ([e85dda8](https://github.com/ljquan/aitu/commit/e85dda8))
- implement auto-compression for 10-25MB images ([c26cbec](https://github.com/ljquan/aitu/commit/c26cbec))
- 添加"不再提示"按钮到灵感创意板块 ([17b926a](https://github.com/ljquan/aitu/commit/17b926a))
- 添加重命名验证功能，禁止同级重名 ([a69c57a](https://github.com/ljquan/aitu/commit/a69c57a))
- 完成 AI 输入栏和 ChatDrawer 完整测试体系 ([1c3fa39](https://github.com/ljquan/aitu/commit/1c3fa39))
- 完成所有核心功能 Manual GIF 录制体系 ([d60c4a4](https://github.com/ljquan/aitu/commit/d60c4a4))

### 🔧 Chores

- update release script and bump app version to 0.5.63 ([8b36e88](https://github.com/ljquan/aitu/commit/8b36e88))
- bump version to 0.5.63 ([52f4493](https://github.com/ljquan/aitu/commit/52f4493))
- update app version to 0.5.62 and adjust build time in version.json ([147815c](https://github.com/ljquan/aitu/commit/147815c))
- bump version to 0.5.62 ([15c42c6](https://github.com/ljquan/aitu/commit/15c42c6))
- update version to 0.5.61 and enhance batch processing logic in image and video generation ([243725e](https://github.com/ljquan/aitu/commit/243725e))
- refactor: rename project from Aitu to Opentu ([a4ca6ca](https://github.com/ljquan/aitu/commit/a4ca6ca))
- refactor: 迁移通用工具函数到 @aitu/utils 并消除二次导出 ([0645497](https://github.com/ljquan/aitu/commit/0645497))
- docs: 添加工具函数组织规则 ([6abdcad](https://github.com/ljquan/aitu/commit/6abdcad))
- Remove legacy workspace rename spec ([a7063f4](https://github.com/ljquan/aitu/commit/a7063f4))
- Fix workspace item naming collisions ([b8019f1](https://github.com/ljquan/aitu/commit/b8019f1))

### ❤️  Thank You

- gongchengtu <1817063960@qq.com>
- mengxiangtu <changesydneyai@gmail.com>
- liquidliang <ljquan@qq.com>
- zzz <zzz@zzzdeMac-mini.local>

## 0.5.63 (2026-01-29)

### 🚀 Features

- 添加"不再提示"按钮到灵感创意板块 ([17b926a](https://github.com/ljquan/aitu/commit/17b926a))

### 🔧 Chores

- update app version to 0.5.62 and adjust build time in version.json ([147815c](https://github.com/ljquan/aitu/commit/147815c))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- zzz <zzz@zzzdeMac-mini.local>

## 0.5.62 (2026-01-29)

### 🚀 Features

- 添加重命名验证功能，禁止同级重名 ([a69c57a](https://github.com/ljquan/aitu/commit/a69c57a))
- 完成 AI 输入栏和 ChatDrawer 完整测试体系 ([1c3fa39](https://github.com/ljquan/aitu/commit/1c3fa39))
- 完成所有核心功能 Manual GIF 录制体系 ([d60c4a4](https://github.com/ljquan/aitu/commit/d60c4a4))
- 移动端适配 ([ade6470](https://github.com/ljquan/aitu/commit/ade6470))
- 全面优化多端响应式适配 ([1b06d2f](https://github.com/ljquan/aitu/commit/1b06d2f))
- 统一媒体预览组件并优化缩略图展示 ([a617211](https://github.com/ljquan/aitu/commit/a617211))
- enhance pencil and eraser settings with shape selection ([cbde7b2](https://github.com/ljquan/aitu/commit/cbde7b2))
- 增强文字属性面板样式设置功能 ([2b437fa](https://github.com/ljquan/aitu/commit/2b437fa))
- add alignment, distribution, and boolean operation buttons ([811111e](https://github.com/ljquan/aitu/commit/811111e))
- 对比模式下视频联动同步播放和重置 ([ea9b932](https://github.com/ljquan/aitu/commit/ea9b932))
- enhance user manual generation and CDN integration ([ba4746d](https://github.com/ljquan/aitu/commit/ba4746d))
- enhance user manual generation and E2E testing ([607ec7e](https://github.com/ljquan/aitu/commit/607ec7e))
- 添加用户手册生成系统和 E2E 测试增强 ([4daff77](https://github.com/ljquan/aitu/commit/4daff77))
- 新增 TaskProgressOverlay 组件显示任务进度 ([0ab1aa3](https://github.com/ljquan/aitu/commit/0ab1aa3))

### 🩹 Fixes

- 修复批量生成只执行第一个任务的问题 ([ebca700](https://github.com/ljquan/aitu/commit/ebca700))
- enhance task submission and execution checks ([7a92d70](https://github.com/ljquan/aitu/commit/7a92d70))
- 使用 Context 共享健康状态数据修复显示不一致问题 ([b95247a](https://github.com/ljquan/aitu/commit/b95247a))

### 🔧 Chores

- update version to 0.5.61 and enhance batch processing logic in image and video generation ([243725e](https://github.com/ljquan/aitu/commit/243725e))
- bump version to 0.5.61 ([20feb2d](https://github.com/ljquan/aitu/commit/20feb2d))
- update version to 0.5.60 and improve board selection logic ([3723135](https://github.com/ljquan/aitu/commit/3723135))
- bump version to 0.5.60 ([9d64bc7](https://github.com/ljquan/aitu/commit/9d64bc7))
- bump version to 0.5.59 ([8b93fb2](https://github.com/ljquan/aitu/commit/8b93fb2))
- remove batch-image.html from build and deploy configurations ([7ef1c37](https://github.com/ljquan/aitu/commit/7ef1c37))
- update deployment scripts and versioning logic; bump version to 0.5.58 ([f7c1cde](https://github.com/ljquan/aitu/commit/f7c1cde))
- bump version to 0.5.58 ([80fb213](https://github.com/ljquan/aitu/commit/80fb213))
- bump version to 0.5.57 ([8aff14b](https://github.com/ljquan/aitu/commit/8aff14b))
- bump version to 0.5.56 ([34917aa](https://github.com/ljquan/aitu/commit/34917aa))
- bump version to 0.5.55 ([41eb428](https://github.com/ljquan/aitu/commit/41eb428))
- bump version to 0.5.54 ([c5e23b0](https://github.com/ljquan/aitu/commit/c5e23b0))
- bump version to 0.5.53 ([c49a324](https://github.com/ljquan/aitu/commit/c49a324))
- bump version to 0.5.52 ([bc42ff4](https://github.com/ljquan/aitu/commit/bc42ff4))
- bump version to 0.5.51 ([78acdbf](https://github.com/ljquan/aitu/commit/78acdbf))
- bump version to 0.5.50 ([c5db0c5](https://github.com/ljquan/aitu/commit/c5db0c5))
- bump version to 0.5.49 ([396f90c](https://github.com/ljquan/aitu/commit/396f90c))
- update app version to 0.5.48 and adjust build time ([b97371b](https://github.com/ljquan/aitu/commit/b97371b))
- refactor: 迁移通用工具函数到 @aitu/utils 并消除二次导出 ([0645497](https://github.com/ljquan/aitu/commit/0645497))
- docs: 添加工具函数组织规则 ([6abdcad](https://github.com/ljquan/aitu/commit/6abdcad))
- Remove legacy workspace rename spec ([a7063f4](https://github.com/ljquan/aitu/commit/a7063f4))
- Fix workspace item naming collisions ([b8019f1](https://github.com/ljquan/aitu/commit/b8019f1))
- docs(claude): 添加新规则 - 工作区初始化自动选择画板 ([c571cb7](https://github.com/ljquan/aitu/commit/c571cb7))
- refactor(task-queue): update resume methods to reuse original LLM API log entries ([d96f066](https://github.com/ljquan/aitu/commit/d96f066))
- 去掉参数n ([989e919](https://github.com/ljquan/aitu/commit/989e919))
- docs: 添加 Slate-React Leaf DOM 结构稳定性规则 ([a20c4a4](https://github.com/ljquan/aitu/commit/a20c4a4))
- docs: 添加编码规则 - Clipper 布尔运算结果处理 ([fe13ef8](https://github.com/ljquan/aitu/commit/fe13ef8))
- docs: 添加编码规则 - useCallback 定义顺序 ([6f891ea](https://github.com/ljquan/aitu/commit/6f891ea))
- docs(claude): 添加新规则 - 日志记录应反映实际发送的数据 ([c714761](https://github.com/ljquan/aitu/commit/c714761))
- docs(claude): 添加新规则 - 多组件共享异步数据时使用 Context ([c688c15](https://github.com/ljquan/aitu/commit/c688c15))
- docs(claude): 添加新规则 - Props 变化时重置组件内部状态 ([2011c2e](https://github.com/ljquan/aitu/commit/2011c2e))
- docs(claude): 添加新规则 - Flex布局兄弟元素隐藏导致宽度变化 ([9a917ab](https://github.com/ljquan/aitu/commit/9a917ab))
- Update README.md ([cf65ccf](https://github.com/ljquan/aitu/commit/cf65ccf))
- Update README_en.md ([aa6986d](https://github.com/ljquan/aitu/commit/aa6986d))
- docs(readme): align Chinese link ([3d37033](https://github.com/ljquan/aitu/commit/3d37033))
- docs(readme): fix english readme link ([c58b01d](https://github.com/ljquan/aitu/commit/c58b01d))
- docs(readme): update demo links ([4fd7ba4](https://github.com/ljquan/aitu/commit/4fd7ba4))
- 添加e2e ([07e18e2](https://github.com/ljquan/aitu/commit/07e18e2))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liquid <ljquan@qq.com>
- ovst <wangjueszu@qq.com>

## 0.5.61 (2026-01-27)

### 🚀 Features

- 移动端适配 ([ade6470](https://github.com/ljquan/aitu/commit/ade6470))
- 全面优化多端响应式适配 ([1b06d2f](https://github.com/ljquan/aitu/commit/1b06d2f))
- 统一媒体预览组件并优化缩略图展示 ([a617211](https://github.com/ljquan/aitu/commit/a617211))
- enhance pencil and eraser settings with shape selection ([cbde7b2](https://github.com/ljquan/aitu/commit/cbde7b2))
- 增强文字属性面板样式设置功能 ([2b437fa](https://github.com/ljquan/aitu/commit/2b437fa))
- add alignment, distribution, and boolean operation buttons ([811111e](https://github.com/ljquan/aitu/commit/811111e))
- 对比模式下视频联动同步播放和重置 ([ea9b932](https://github.com/ljquan/aitu/commit/ea9b932))
- enhance user manual generation and CDN integration ([ba4746d](https://github.com/ljquan/aitu/commit/ba4746d))
- enhance user manual generation and E2E testing ([607ec7e](https://github.com/ljquan/aitu/commit/607ec7e))
- 添加用户手册生成系统和 E2E 测试增强 ([4daff77](https://github.com/ljquan/aitu/commit/4daff77))
- 新增 TaskProgressOverlay 组件显示任务进度 ([0ab1aa3](https://github.com/ljquan/aitu/commit/0ab1aa3))

### 🩹 Fixes

- 修复批量生成只执行第一个任务的问题 ([ebca700](https://github.com/ljquan/aitu/commit/ebca700))
- enhance task submission and execution checks ([7a92d70](https://github.com/ljquan/aitu/commit/7a92d70))
- 使用 Context 共享健康状态数据修复显示不一致问题 ([b95247a](https://github.com/ljquan/aitu/commit/b95247a))

### 🔧 Chores

- update version to 0.5.60 and improve board selection logic ([3723135](https://github.com/ljquan/aitu/commit/3723135))
- bump version to 0.5.60 ([9d64bc7](https://github.com/ljquan/aitu/commit/9d64bc7))
- bump version to 0.5.59 ([8b93fb2](https://github.com/ljquan/aitu/commit/8b93fb2))
- remove batch-image.html from build and deploy configurations ([7ef1c37](https://github.com/ljquan/aitu/commit/7ef1c37))
- update deployment scripts and versioning logic; bump version to 0.5.58 ([f7c1cde](https://github.com/ljquan/aitu/commit/f7c1cde))
- bump version to 0.5.58 ([80fb213](https://github.com/ljquan/aitu/commit/80fb213))
- bump version to 0.5.57 ([8aff14b](https://github.com/ljquan/aitu/commit/8aff14b))
- bump version to 0.5.56 ([34917aa](https://github.com/ljquan/aitu/commit/34917aa))
- bump version to 0.5.55 ([41eb428](https://github.com/ljquan/aitu/commit/41eb428))
- bump version to 0.5.54 ([c5e23b0](https://github.com/ljquan/aitu/commit/c5e23b0))
- bump version to 0.5.53 ([c49a324](https://github.com/ljquan/aitu/commit/c49a324))
- bump version to 0.5.52 ([bc42ff4](https://github.com/ljquan/aitu/commit/bc42ff4))
- bump version to 0.5.51 ([78acdbf](https://github.com/ljquan/aitu/commit/78acdbf))
- bump version to 0.5.50 ([c5db0c5](https://github.com/ljquan/aitu/commit/c5db0c5))
- bump version to 0.5.49 ([396f90c](https://github.com/ljquan/aitu/commit/396f90c))
- update app version to 0.5.48 and adjust build time ([b97371b](https://github.com/ljquan/aitu/commit/b97371b))
- docs(claude): 添加新规则 - 工作区初始化自动选择画板 ([c571cb7](https://github.com/ljquan/aitu/commit/c571cb7))
- refactor(task-queue): update resume methods to reuse original LLM API log entries ([d96f066](https://github.com/ljquan/aitu/commit/d96f066))
- 去掉参数n ([989e919](https://github.com/ljquan/aitu/commit/989e919))
- docs: 添加 Slate-React Leaf DOM 结构稳定性规则 ([a20c4a4](https://github.com/ljquan/aitu/commit/a20c4a4))
- docs: 添加编码规则 - Clipper 布尔运算结果处理 ([fe13ef8](https://github.com/ljquan/aitu/commit/fe13ef8))
- docs: 添加编码规则 - useCallback 定义顺序 ([6f891ea](https://github.com/ljquan/aitu/commit/6f891ea))
- docs(claude): 添加新规则 - 日志记录应反映实际发送的数据 ([c714761](https://github.com/ljquan/aitu/commit/c714761))
- docs(claude): 添加新规则 - 多组件共享异步数据时使用 Context ([c688c15](https://github.com/ljquan/aitu/commit/c688c15))
- docs(claude): 添加新规则 - Props 变化时重置组件内部状态 ([2011c2e](https://github.com/ljquan/aitu/commit/2011c2e))
- docs(claude): 添加新规则 - Flex布局兄弟元素隐藏导致宽度变化 ([9a917ab](https://github.com/ljquan/aitu/commit/9a917ab))
- Update README.md ([cf65ccf](https://github.com/ljquan/aitu/commit/cf65ccf))
- Update README_en.md ([aa6986d](https://github.com/ljquan/aitu/commit/aa6986d))
- docs(readme): align Chinese link ([3d37033](https://github.com/ljquan/aitu/commit/3d37033))
- docs(readme): fix english readme link ([c58b01d](https://github.com/ljquan/aitu/commit/c58b01d))
- docs(readme): update demo links ([4fd7ba4](https://github.com/ljquan/aitu/commit/4fd7ba4))
- 添加e2e ([07e18e2](https://github.com/ljquan/aitu/commit/07e18e2))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>
- ovst <wangjueszu@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.60 (2026-01-26)

### 🔧 Chores

- docs(claude): 添加新规则 - 工作区初始化自动选择画板 ([9bece83](https://github.com/ljquan/aitu/commit/9bece83))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.59 (2026-01-26)

### 🚀 Features

- 移动端适配 ([ade6470](https://github.com/ljquan/aitu/commit/ade6470))

### 🔧 Chores

- update deployment scripts and versioning logic; bump version to 0.5.58 ([f7c1cde](https://github.com/ljquan/aitu/commit/f7c1cde))
- bump version to 0.5.58 ([80fb213](https://github.com/ljquan/aitu/commit/80fb213))
- bump version to 0.5.57 ([8aff14b](https://github.com/ljquan/aitu/commit/8aff14b))
- bump version to 0.5.56 ([34917aa](https://github.com/ljquan/aitu/commit/34917aa))
- bump version to 0.5.55 ([41eb428](https://github.com/ljquan/aitu/commit/41eb428))
- bump version to 0.5.54 ([c5e23b0](https://github.com/ljquan/aitu/commit/c5e23b0))
- bump version to 0.5.53 ([c49a324](https://github.com/ljquan/aitu/commit/c49a324))
- bump version to 0.5.52 ([bc42ff4](https://github.com/ljquan/aitu/commit/bc42ff4))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.52 (2026-01-26)

### 🚀 Features

- 移动端适配 ([ade6470](https://github.com/ljquan/aitu/commit/ade6470))
- 全面优化多端响应式适配 ([1b06d2f](https://github.com/ljquan/aitu/commit/1b06d2f))
- 统一媒体预览组件并优化缩略图展示 ([a617211](https://github.com/ljquan/aitu/commit/a617211))
- enhance pencil and eraser settings with shape selection ([cbde7b2](https://github.com/ljquan/aitu/commit/cbde7b2))
- 增强文字属性面板样式设置功能 ([2b437fa](https://github.com/ljquan/aitu/commit/2b437fa))
- add alignment, distribution, and boolean operation buttons ([811111e](https://github.com/ljquan/aitu/commit/811111e))
- 对比模式下视频联动同步播放和重置 ([ea9b932](https://github.com/ljquan/aitu/commit/ea9b932))
- enhance user manual generation and CDN integration ([ba4746d](https://github.com/ljquan/aitu/commit/ba4746d))
- enhance user manual generation and E2E testing ([607ec7e](https://github.com/ljquan/aitu/commit/607ec7e))
- 添加用户手册生成系统和 E2E 测试增强 ([4daff77](https://github.com/ljquan/aitu/commit/4daff77))
- 新增 TaskProgressOverlay 组件显示任务进度 ([0ab1aa3](https://github.com/ljquan/aitu/commit/0ab1aa3))

### 🩹 Fixes

- 修复批量生成只执行第一个任务的问题 ([ebca700](https://github.com/ljquan/aitu/commit/ebca700))
- enhance task submission and execution checks ([7a92d70](https://github.com/ljquan/aitu/commit/7a92d70))
- 使用 Context 共享健康状态数据修复显示不一致问题 ([b95247a](https://github.com/ljquan/aitu/commit/b95247a))

### 🔧 Chores

- bump version to 0.5.51 ([78acdbf](https://github.com/ljquan/aitu/commit/78acdbf))
- bump version to 0.5.50 ([c5db0c5](https://github.com/ljquan/aitu/commit/c5db0c5))
- bump version to 0.5.49 ([396f90c](https://github.com/ljquan/aitu/commit/396f90c))
- update app version to 0.5.48 and adjust build time ([b97371b](https://github.com/ljquan/aitu/commit/b97371b))
- refactor(task-queue): update resume methods to reuse original LLM API log entries ([d96f066](https://github.com/ljquan/aitu/commit/d96f066))
- 去掉参数n ([989e919](https://github.com/ljquan/aitu/commit/989e919))
- docs: 添加 Slate-React Leaf DOM 结构稳定性规则 ([a20c4a4](https://github.com/ljquan/aitu/commit/a20c4a4))
- docs: 添加编码规则 - Clipper 布尔运算结果处理 ([fe13ef8](https://github.com/ljquan/aitu/commit/fe13ef8))
- docs: 添加编码规则 - useCallback 定义顺序 ([6f891ea](https://github.com/ljquan/aitu/commit/6f891ea))
- docs(claude): 添加新规则 - 日志记录应反映实际发送的数据 ([c714761](https://github.com/ljquan/aitu/commit/c714761))
- docs(claude): 添加新规则 - 多组件共享异步数据时使用 Context ([c688c15](https://github.com/ljquan/aitu/commit/c688c15))
- docs(claude): 添加新规则 - Props 变化时重置组件内部状态 ([2011c2e](https://github.com/ljquan/aitu/commit/2011c2e))
- docs(claude): 添加新规则 - Flex布局兄弟元素隐藏导致宽度变化 ([9a917ab](https://github.com/ljquan/aitu/commit/9a917ab))
- Update README.md ([cf65ccf](https://github.com/ljquan/aitu/commit/cf65ccf))
- Update README_en.md ([aa6986d](https://github.com/ljquan/aitu/commit/aa6986d))
- docs(readme): align Chinese link ([3d37033](https://github.com/ljquan/aitu/commit/3d37033))
- docs(readme): fix english readme link ([c58b01d](https://github.com/ljquan/aitu/commit/c58b01d))
- docs(readme): update demo links ([4fd7ba4](https://github.com/ljquan/aitu/commit/4fd7ba4))
- 添加e2e ([07e18e2](https://github.com/ljquan/aitu/commit/07e18e2))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>
- ovst <wangjueszu@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.51 (2026-01-25)

### 🚀 Features

- 全面优化多端响应式适配 ([1b06d2f](https://github.com/ljquan/aitu/commit/1b06d2f))
- 统一媒体预览组件并优化缩略图展示 ([a617211](https://github.com/ljquan/aitu/commit/a617211))
- enhance pencil and eraser settings with shape selection ([cbde7b2](https://github.com/ljquan/aitu/commit/cbde7b2))
- 增强文字属性面板样式设置功能 ([2b437fa](https://github.com/ljquan/aitu/commit/2b437fa))
- add alignment, distribution, and boolean operation buttons ([811111e](https://github.com/ljquan/aitu/commit/811111e))

### 🩹 Fixes

- enhance task submission and execution checks ([7a92d70](https://github.com/ljquan/aitu/commit/7a92d70))

### 🔧 Chores

- 去掉参数n ([989e919](https://github.com/ljquan/aitu/commit/989e919))
- docs: 添加 Slate-React Leaf DOM 结构稳定性规则 ([a20c4a4](https://github.com/ljquan/aitu/commit/a20c4a4))
- docs: 添加编码规则 - Clipper 布尔运算结果处理 ([fe13ef8](https://github.com/ljquan/aitu/commit/fe13ef8))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.50 (2026-01-24)

### 🚀 Features

- 对比模式下视频联动同步播放和重置 ([ea9b932](https://github.com/ljquan/aitu/commit/ea9b932))

### 🔧 Chores

- docs: 添加编码规则 - useCallback 定义顺序 ([6f891ea](https://github.com/ljquan/aitu/commit/6f891ea))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.49 (2026-01-24)

### 🚀 Features

- enhance user manual generation and CDN integration ([ba4746d](https://github.com/ljquan/aitu/commit/ba4746d))
- enhance user manual generation and E2E testing ([607ec7e](https://github.com/ljquan/aitu/commit/607ec7e))
- 添加用户手册生成系统和 E2E 测试增强 ([4daff77](https://github.com/ljquan/aitu/commit/4daff77))
- 新增 TaskProgressOverlay 组件显示任务进度 ([0ab1aa3](https://github.com/ljquan/aitu/commit/0ab1aa3))

### 🩹 Fixes

- 使用 Context 共享健康状态数据修复显示不一致问题 ([b95247a](https://github.com/ljquan/aitu/commit/b95247a))

### 🔧 Chores

- update app version to 0.5.48 and adjust build time ([b97371b](https://github.com/ljquan/aitu/commit/b97371b))
- docs(claude): 添加新规则 - 日志记录应反映实际发送的数据 ([c714761](https://github.com/ljquan/aitu/commit/c714761))
- docs(claude): 添加新规则 - 多组件共享异步数据时使用 Context ([c688c15](https://github.com/ljquan/aitu/commit/c688c15))
- docs(claude): 添加新规则 - Props 变化时重置组件内部状态 ([2011c2e](https://github.com/ljquan/aitu/commit/2011c2e))
- docs(claude): 添加新规则 - Flex布局兄弟元素隐藏导致宽度变化 ([9a917ab](https://github.com/ljquan/aitu/commit/9a917ab))
- Update README.md ([cf65ccf](https://github.com/ljquan/aitu/commit/cf65ccf))
- Update README_en.md ([aa6986d](https://github.com/ljquan/aitu/commit/aa6986d))
- docs(readme): align Chinese link ([3d37033](https://github.com/ljquan/aitu/commit/3d37033))
- docs(readme): fix english readme link ([c58b01d](https://github.com/ljquan/aitu/commit/c58b01d))
- docs(readme): update demo links ([4fd7ba4](https://github.com/ljquan/aitu/commit/4fd7ba4))
- 添加e2e ([07e18e2](https://github.com/ljquan/aitu/commit/07e18e2))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- ovst <wangjueszu@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.44 (2026-01-23)

### 🔧 Chores

- update app version to 0.5.43 and adjust build time ([f0f1d52](https://github.com/ljquan/aitu/commit/f0f1d52))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.43 (2026-01-23)

### 🚀 Features

- 点击画板自动关闭项目抽屉和工具箱抽屉 ([a91ed12](https://github.com/ljquan/aitu/commit/a91ed12))
- update OpenTu labels and model hints ([8571c79](https://github.com/ljquan/aitu/commit/8571c79))

### 🩹 Fixes

- 修复图片覆盖保存时缩放比例计算错误 ([81a59ba](https://github.com/ljquan/aitu/commit/81a59ba))

### 🔧 Chores

- update app version to 0.5.42 and adjust build time ([14e6185](https://github.com/ljquan/aitu/commit/14e6185))
- bump version to 0.5.1 ([7fadafd](https://github.com/ljquan/aitu/commit/7fadafd))
- style(settings-dialog): 美化设置弹窗并统一模型选择器样式 ([e7c30ce](https://github.com/ljquan/aitu/commit/e7c30ce))
- refactor(image-editor): 提取图片尺寸计算逻辑到共享模块 ([596faab](https://github.com/ljquan/aitu/commit/596faab))
- docs: 添加编码规则 - 模式切换状态同步 ([db19940](https://github.com/ljquan/aitu/commit/db19940))
- Update online experience link in README ([b3a8b4c](https://github.com/ljquan/aitu/commit/b3a8b4c))
- Update README.md ([339e720](https://github.com/ljquan/aitu/commit/339e720))
- Rename project to Opentu and update README ([38032e6](https://github.com/ljquan/aitu/commit/38032e6))
- 添加readme 的 git 图素材 ([c0bb49a](https://github.com/ljquan/aitu/commit/c0bb49a))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>
- Opentu Developer <noreply@aitu.chat>
- gongchengtu <1817063960@qq.com>
- ovst <wangjueszu@qq.com>

## 0.5.42 (2026-01-23)

### 🚀 Features

- update AI input parser to enhance prompt generation logic ([272d73d](https://github.com/ljquan/aitu/commit/272d73d))
- 优化分析模式 ([60bf02a](https://github.com/ljquan/aitu/commit/60bf02a))
- 添加数据备份功能和进度显示 ([cc74d29](https://github.com/ljquan/aitu/commit/cc74d29))
- 统一 Tooltip 样式并美化模型健康状态信号展示 ([1076cb2](https://github.com/ljquan/aitu/commit/1076cb2))
- 初始化时自动滚动显示 AI 按钮 ([f110657](https://github.com/ljquan/aitu/commit/f110657))
- 优化角色创建时间轴视频帧显示 ([2a927bc](https://github.com/ljquan/aitu/commit/2a927bc))
- 添加工具窗口最小化/恢复动画 ([0cba6b1](https://github.com/ljquan/aitu/commit/0cba6b1))
- 优化工具箱 UI 和工具栏交互 ([b866b85](https://github.com/ljquan/aitu/commit/b866b85))
- 增强敏感信息处理和日志记录 ([70c83b6](https://github.com/ljquan/aitu/commit/70c83b6))
- add media library button and functionality to AI input bar ([3ece148](https://github.com/ljquan/aitu/commit/3ece148))
- 优化素材库筛选按钮间距并实现三段式循环排序模式 ([1264b42](https://github.com/ljquan/aitu/commit/1264b42))

### 🩹 Fixes

- 阻止无效配置下创建的任务被执行 ([fae807b](https://github.com/ljquan/aitu/commit/fae807b))
- 修复多选元素时填充色图标显示异常 ([bbfeaaa](https://github.com/ljquan/aitu/commit/bbfeaaa))
- 修复视频插入函数名错误 ([9593b02](https://github.com/ljquan/aitu/commit/9593b02))

### 🔧 Chores

- 清理调试日志和修复未定义函数调用 ([718c4fb](https://github.com/ljquan/aitu/commit/718c4fb))
- update app version to 0.5.41 and adjust build time ([0fc7aeb](https://github.com/ljquan/aitu/commit/0fc7aeb))
- bump version to 0.5.41 ([7b3ffc0](https://github.com/ljquan/aitu/commit/7b3ffc0))
- bump version to 0.5.40 ([d78e75c](https://github.com/ljquan/aitu/commit/d78e75c))
- bump version to 0.5.39 ([1fa11f9](https://github.com/ljquan/aitu/commit/1fa11f9))
- bump version to 0.5.39 ([95ab336](https://github.com/ljquan/aitu/commit/95ab336))
- update app version to 0.5.38 and adjust build time in version.json ([47d1029](https://github.com/ljquan/aitu/commit/47d1029))
- bump version to 0.5.38 ([ee623df](https://github.com/ljquan/aitu/commit/ee623df))
- bump version to 0.5.36 ([ab4d3e2](https://github.com/ljquan/aitu/commit/ab4d3e2))
- update app version to 0.5.37 and enhance tool URL handling ([fba900c](https://github.com/ljquan/aitu/commit/fba900c))
- docs: 精简 CLAUDE.md 并补充编码规则 ([2ca7cc9](https://github.com/ljquan/aitu/commit/2ca7cc9))
- refactor(image-splitter): 提取共享模块统一拆分配置 ([10816e8](https://github.com/ljquan/aitu/commit/10816e8))
- docs: 添加共享模块设计规则 ([53d0900](https://github.com/ljquan/aitu/commit/53d0900))
- refactor(health): 使用单例控制模型健康状态 API 调用频率 ([cfb92dd](https://github.com/ljquan/aitu/commit/cfb92dd))
- docs(claude): 添加新规则 - 无效配置下的数据不应被持久化或执行 ([5bfa029](https://github.com/ljquan/aitu/commit/5bfa029))
- docs: 添加编码规则 - 布局抖动、结构化数据与图标验证 ([27dedea](https://github.com/ljquan/aitu/commit/27dedea))
- style(winbox): optimize titlebar buttons for light theme and fix black square issue ([0a45250](https://github.com/ljquan/aitu/commit/0a45250))
- refactor(sw-debug): 模块化重构调试面板 ([33aa2ed](https://github.com/ljquan/aitu/commit/33aa2ed))
- refactor(auto-complete-shape-picker): update shape icons to use JSX syntax ([5049f6e](https://github.com/ljquan/aitu/commit/5049f6e))
- docs: 添加 SW 枚举值小写规则 ([dceb83a](https://github.com/ljquan/aitu/commit/dceb83a))
- docs(rules): 添加 Blob MIME 类型获取和 Shift 连选防文本选中规则 ([c0e63d0](https://github.com/ljquan/aitu/commit/c0e63d0))
- docs(claude): 添加新规则 - 同名模块的全局状态隔离问题 ([3d92dda](https://github.com/ljquan/aitu/commit/3d92dda))
- docs: 添加 UI 交互规范 - 可点击容器、筛选联动、全局配色 ([1d8c77c](https://github.com/ljquan/aitu/commit/1d8c77c))
- docs: 添加强制重绘 void 前缀规则 ([98b400f](https://github.com/ljquan/aitu/commit/98b400f))
- docs: 添加 TDesign Dropdown popupProps 透传规则 ([14925fb](https://github.com/ljquan/aitu/commit/14925fb))
- docs: 更新项目文档，修正在线应用链接并优化 CLAUDE.md 结构 ([dfef8c1](https://github.com/ljquan/aitu/commit/dfef8c1))
- docs(claude): 添加项目概念文档和维护规则 ([70fddff](https://github.com/ljquan/aitu/commit/70fddff))
- docs(claude): 添加敏感信息过滤相关安全规则 ([1156efc](https://github.com/ljquan/aitu/commit/1156efc))
- docs(claude): 添加新交互和样式规则 - 三段式排序与筛选岛对齐 ([ec72cd5](https://github.com/ljquan/aitu/commit/ec72cd5))
- docs(claude): 更新规则 - 图标组件渲染错误示例补充三元表达式场景 ([4116347](https://github.com/ljquan/aitu/commit/4116347))
- docs(claude): 添加敏感信息模板变量安全处理规则 ([a206daa](https://github.com/ljquan/aitu/commit/a206daa))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.41 (2026-01-23)

### 🚀 Features

- 优化分析模式 ([60bf02a](https://github.com/ljquan/aitu/commit/60bf02a))
- 添加数据备份功能和进度显示 ([cc74d29](https://github.com/ljquan/aitu/commit/cc74d29))
- 统一 Tooltip 样式并美化模型健康状态信号展示 ([1076cb2](https://github.com/ljquan/aitu/commit/1076cb2))
- 初始化时自动滚动显示 AI 按钮 ([f110657](https://github.com/ljquan/aitu/commit/f110657))

### 🩹 Fixes

- 修复多选元素时填充色图标显示异常 ([bbfeaaa](https://github.com/ljquan/aitu/commit/bbfeaaa))

### 🔧 Chores

- bump version to 0.5.40 ([d78e75c](https://github.com/ljquan/aitu/commit/d78e75c))
- bump version to 0.5.39 ([1fa11f9](https://github.com/ljquan/aitu/commit/1fa11f9))
- refactor(sw-debug): 模块化重构调试面板 ([33aa2ed](https://github.com/ljquan/aitu/commit/33aa2ed))
- refactor(auto-complete-shape-picker): update shape icons to use JSX syntax ([5049f6e](https://github.com/ljquan/aitu/commit/5049f6e))
- docs: 添加 SW 枚举值小写规则 ([dceb83a](https://github.com/ljquan/aitu/commit/dceb83a))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.39 (2026-01-22)

### 🚀 Features

- 添加数据备份功能和进度显示 ([cc74d29](https://github.com/ljquan/aitu/commit/cc74d29))
- 统一 Tooltip 样式并美化模型健康状态信号展示 ([1076cb2](https://github.com/ljquan/aitu/commit/1076cb2))
- 初始化时自动滚动显示 AI 按钮 ([f110657](https://github.com/ljquan/aitu/commit/f110657))
- 优化角色创建时间轴视频帧显示 ([2a927bc](https://github.com/ljquan/aitu/commit/2a927bc))
- 添加工具窗口最小化/恢复动画 ([0cba6b1](https://github.com/ljquan/aitu/commit/0cba6b1))
- 优化工具箱 UI 和工具栏交互 ([b866b85](https://github.com/ljquan/aitu/commit/b866b85))
- 增强敏感信息处理和日志记录 ([70c83b6](https://github.com/ljquan/aitu/commit/70c83b6))
- add media library button and functionality to AI input bar ([3ece148](https://github.com/ljquan/aitu/commit/3ece148))
- 优化素材库筛选按钮间距并实现三段式循环排序模式 ([1264b42](https://github.com/ljquan/aitu/commit/1264b42))
- 添加模型健康状态功能并更新 CLAUDE.md 文档 ([98f9319](https://github.com/ljquan/aitu/commit/98f9319))
- implement precache manifest generation and update service worker activation strategy ([f44fea3](https://github.com/ljquan/aitu/commit/f44fea3))
- implement responsive layout with ResizeObserver and improve styling consistency ([72057e9](https://github.com/ljquan/aitu/commit/72057e9))

### 🩹 Fixes

- 修复多选元素时填充色图标显示异常 ([bbfeaaa](https://github.com/ljquan/aitu/commit/bbfeaaa))
- 修复视频插入函数名错误 ([9593b02](https://github.com/ljquan/aitu/commit/9593b02))
- 修复 ModelDropdown Portal 模式下的位置计算和点击选择问题 ([f075058](https://github.com/ljquan/aitu/commit/f075058))

### 🔧 Chores

- update app version to 0.5.38 and adjust build time in version.json ([47d1029](https://github.com/ljquan/aitu/commit/47d1029))
- bump version to 0.5.38 ([ee623df](https://github.com/ljquan/aitu/commit/ee623df))
- bump version to 0.5.36 ([ab4d3e2](https://github.com/ljquan/aitu/commit/ab4d3e2))
- update app version to 0.5.37 and enhance tool URL handling ([fba900c](https://github.com/ljquan/aitu/commit/fba900c))
- bump version to 0.5.37 ([3a06964](https://github.com/ljquan/aitu/commit/3a06964))
- update app version to 0.5.36 and adjust build time in version.json ([b1cd461](https://github.com/ljquan/aitu/commit/b1cd461))
- bump version to 0.5.36 ([0c8c796](https://github.com/ljquan/aitu/commit/0c8c796))
- update app version to 0.5.35 and adjust build time in version.json ([7b8c32e](https://github.com/ljquan/aitu/commit/7b8c32e))
- bump version to 0.5.35 ([cfa8949](https://github.com/ljquan/aitu/commit/cfa8949))
- bump version to 0.5.34 ([2903d85](https://github.com/ljquan/aitu/commit/2903d85))
- bump version to 0.5.33 ([e9cd0ec](https://github.com/ljquan/aitu/commit/e9cd0ec))
- bump version to 0.5.32 ([f0ff19e](https://github.com/ljquan/aitu/commit/f0ff19e))
- bump version to 0.5.31 ([8d4cb2d](https://github.com/ljquan/aitu/commit/8d4cb2d))
- update app version to 0.5.30 and adjust build time in version.json ([1512fd7](https://github.com/ljquan/aitu/commit/1512fd7))
- bump version to 0.5.30 ([5279f38](https://github.com/ljquan/aitu/commit/5279f38))
- refactor(auto-complete-shape-picker): update shape icons to use JSX syntax ([5049f6e](https://github.com/ljquan/aitu/commit/5049f6e))
- docs: 添加 SW 枚举值小写规则 ([dceb83a](https://github.com/ljquan/aitu/commit/dceb83a))
- docs(rules): 添加 Blob MIME 类型获取和 Shift 连选防文本选中规则 ([c0e63d0](https://github.com/ljquan/aitu/commit/c0e63d0))
- docs(claude): 添加新规则 - 同名模块的全局状态隔离问题 ([3d92dda](https://github.com/ljquan/aitu/commit/3d92dda))
- docs: 添加 UI 交互规范 - 可点击容器、筛选联动、全局配色 ([1d8c77c](https://github.com/ljquan/aitu/commit/1d8c77c))
- docs: 添加强制重绘 void 前缀规则 ([98b400f](https://github.com/ljquan/aitu/commit/98b400f))
- docs: 添加 TDesign Dropdown popupProps 透传规则 ([14925fb](https://github.com/ljquan/aitu/commit/14925fb))
- docs: 更新项目文档，修正在线应用链接并优化 CLAUDE.md 结构 ([dfef8c1](https://github.com/ljquan/aitu/commit/dfef8c1))
- docs(claude): 添加项目概念文档和维护规则 ([70fddff](https://github.com/ljquan/aitu/commit/70fddff))
- docs(claude): 添加敏感信息过滤相关安全规则 ([1156efc](https://github.com/ljquan/aitu/commit/1156efc))
- docs(claude): 添加新交互和样式规则 - 三段式排序与筛选岛对齐 ([ec72cd5](https://github.com/ljquan/aitu/commit/ec72cd5))
- docs(claude): 更新规则 - 图标组件渲染错误示例补充三元表达式场景 ([4116347](https://github.com/ljquan/aitu/commit/4116347))
- docs(claude): 添加敏感信息模板变量安全处理规则 ([a206daa](https://github.com/ljquan/aitu/commit/a206daa))
- docs(claude): 添加关于批量操作按钮视觉层级和 URL 模板变量处理的新规则 ([1891b1e](https://github.com/ljquan/aitu/commit/1891b1e))
- docs(claude): 添加关于 Tooltip 布局、筛选逻辑和 UI 设计原则的新规则 ([d7eaca8](https://github.com/ljquan/aitu/commit/d7eaca8))
- docs(claude): 添加新规则 - 嵌套滚动容器和动态高度容器的滚动事件处理 ([7e6c26b](https://github.com/ljquan/aitu/commit/7e6c26b))
- refactor: update HandIcon SVG paths for improved structure and clarity ([1741b5a](https://github.com/ljquan/aitu/commit/1741b5a))
- docs(claude): 添加有关图标组件规范和筛选逻辑修复的新规则 ([0d35d22](https://github.com/ljquan/aitu/commit/0d35d22))
- docs(claude): 添加新规则 - CustomEvent 传递硬编码占位符问题 ([4543793](https://github.com/ljquan/aitu/commit/4543793))
- docs(claude): 添加 Service Worker 自动激活策略文档 ([a3983d7](https://github.com/ljquan/aitu/commit/a3983d7))
- docs(claude): 补充预缓存不阻塞首次访问的说明 ([d5ca154](https://github.com/ljquan/aitu/commit/d5ca154))
- docs(claude): 添加 Service Worker 预缓存机制文档 ([c26bd23](https://github.com/ljquan/aitu/commit/c26bd23))
- docs(claude): 添加新规则 - 获取第三方组件位置应使用 getBoundingClientRect() ([082f274](https://github.com/ljquan/aitu/commit/082f274))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.38 (2026-01-21)

### 🔧 Chores

- bump version to 0.5.36 ([ab4d3e2](https://github.com/ljquan/aitu/commit/ab4d3e2))
- update app version to 0.5.37 and enhance tool URL handling ([fba900c](https://github.com/ljquan/aitu/commit/fba900c))
- bump version to 0.5.37 ([3a06964](https://github.com/ljquan/aitu/commit/3a06964))
- update app version to 0.5.36 and adjust build time in version.json ([b1cd461](https://github.com/ljquan/aitu/commit/b1cd461))
- bump version to 0.5.36 ([0c8c796](https://github.com/ljquan/aitu/commit/0c8c796))
- docs(claude): 更新规则 - 图标组件渲染错误示例补充三元表达式场景 ([4116347](https://github.com/ljquan/aitu/commit/4116347))
- docs(claude): 添加敏感信息模板变量安全处理规则 ([a206daa](https://github.com/ljquan/aitu/commit/a206daa))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.37 (2026-01-21)

### 🔧 Chores

- update app version to 0.5.36 and adjust build time in version.json ([b1cd461](https://github.com/ljquan/aitu/commit/b1cd461))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.36 (2026-01-21)

### 🚀 Features

- 添加模型健康状态功能并更新 CLAUDE.md 文档 ([98f9319](https://github.com/ljquan/aitu/commit/98f9319))
- implement precache manifest generation and update service worker activation strategy ([f44fea3](https://github.com/ljquan/aitu/commit/f44fea3))
- implement responsive layout with ResizeObserver and improve styling consistency ([72057e9](https://github.com/ljquan/aitu/commit/72057e9))
- enhance split and restore functionality for WinBoxWindow ([a53c0b8](https://github.com/ljquan/aitu/commit/a53c0b8))
- 优化批量出图 UI 和交互体验 ([94e2e05](https://github.com/ljquan/aitu/commit/94e2e05))

### 🩹 Fixes

- 修复 ModelDropdown Portal 模式下的位置计算和点击选择问题 ([f075058](https://github.com/ljquan/aitu/commit/f075058))

### 🔧 Chores

- update app version to 0.5.35 and adjust build time in version.json ([7b8c32e](https://github.com/ljquan/aitu/commit/7b8c32e))
- bump version to 0.5.35 ([cfa8949](https://github.com/ljquan/aitu/commit/cfa8949))
- bump version to 0.5.34 ([2903d85](https://github.com/ljquan/aitu/commit/2903d85))
- bump version to 0.5.33 ([e9cd0ec](https://github.com/ljquan/aitu/commit/e9cd0ec))
- bump version to 0.5.32 ([f0ff19e](https://github.com/ljquan/aitu/commit/f0ff19e))
- bump version to 0.5.31 ([8d4cb2d](https://github.com/ljquan/aitu/commit/8d4cb2d))
- update app version to 0.5.30 and adjust build time in version.json ([1512fd7](https://github.com/ljquan/aitu/commit/1512fd7))
- bump version to 0.5.30 ([5279f38](https://github.com/ljquan/aitu/commit/5279f38))
- update app version to 0.5.29 and adjust build time ([4a0edf6](https://github.com/ljquan/aitu/commit/4a0edf6))
- docs(claude): 添加关于批量操作按钮视觉层级和 URL 模板变量处理的新规则 ([1891b1e](https://github.com/ljquan/aitu/commit/1891b1e))
- docs(claude): 添加关于 Tooltip 布局、筛选逻辑和 UI 设计原则的新规则 ([d7eaca8](https://github.com/ljquan/aitu/commit/d7eaca8))
- docs(claude): 添加新规则 - 嵌套滚动容器和动态高度容器的滚动事件处理 ([7e6c26b](https://github.com/ljquan/aitu/commit/7e6c26b))
- refactor: update HandIcon SVG paths for improved structure and clarity ([1741b5a](https://github.com/ljquan/aitu/commit/1741b5a))
- docs(claude): 添加有关图标组件规范和筛选逻辑修复的新规则 ([0d35d22](https://github.com/ljquan/aitu/commit/0d35d22))
- docs(claude): 添加新规则 - CustomEvent 传递硬编码占位符问题 ([4543793](https://github.com/ljquan/aitu/commit/4543793))
- docs(claude): 添加 Service Worker 自动激活策略文档 ([a3983d7](https://github.com/ljquan/aitu/commit/a3983d7))
- docs(claude): 补充预缓存不阻塞首次访问的说明 ([d5ca154](https://github.com/ljquan/aitu/commit/d5ca154))
- docs(claude): 添加 Service Worker 预缓存机制文档 ([c26bd23](https://github.com/ljquan/aitu/commit/c26bd23))
- docs(claude): 添加新规则 - 获取第三方组件位置应使用 getBoundingClientRect() ([082f274](https://github.com/ljquan/aitu/commit/082f274))
- docs(claude): 添加新规则 - 独立的 React 树缺少上下文环境 ([eac542f](https://github.com/ljquan/aitu/commit/eac542f))
- docs(claude): 添加新规则 - 传递给第三方库的回调无法获取最新 React state ([306ac42](https://github.com/ljquan/aitu/commit/306ac42))
- docs(claude): 添加新规则 - 点击外部关闭应使用全局事件监听而非透明遮罩层 ([36785f1](https://github.com/ljquan/aitu/commit/36785f1))
- docs(claude): 添加新规则 - React Context 回调中必须使用函数式更新 ([3b89eb2](https://github.com/ljquan/aitu/commit/3b89eb2))
- docs(claude): 添加异步任务重试与恢复规范 ([a7b61a0](https://github.com/ljquan/aitu/commit/a7b61a0))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liquid <ljquan@qq.com>

## 0.5.34 (2026-01-21)

### 🚀 Features

- implement precache manifest generation and update service worker activation strategy ([f44fea3](https://github.com/ljquan/aitu/commit/f44fea3))

### 🔧 Chores

- docs(claude): 添加 Service Worker 自动激活策略文档 ([a3983d7](https://github.com/ljquan/aitu/commit/a3983d7))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.32 (2026-01-21)

### 🔧 Chores

- docs(claude): 补充预缓存不阻塞首次访问的说明 ([d5ca154](https://github.com/ljquan/aitu/commit/d5ca154))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.31 (2026-01-21)

### 🚀 Features

- implement responsive layout with ResizeObserver and improve styling consistency ([72057e9](https://github.com/ljquan/aitu/commit/72057e9))
- enhance split and restore functionality for WinBoxWindow ([a53c0b8](https://github.com/ljquan/aitu/commit/a53c0b8))
- 优化批量出图 UI 和交互体验 ([94e2e05](https://github.com/ljquan/aitu/commit/94e2e05))

### 🩹 Fixes

- keep auto-insert aspect ratio ([1457f27](https://github.com/ljquan/aitu/commit/1457f27))
- preserve image ratio in payload ([614fc8b](https://github.com/ljquan/aitu/commit/614fc8b))

### 🔧 Chores

- update app version to 0.5.30 and adjust build time in version.json ([1512fd7](https://github.com/ljquan/aitu/commit/1512fd7))
- bump version to 0.5.30 ([5279f38](https://github.com/ljquan/aitu/commit/5279f38))
- update app version to 0.5.29 and adjust build time ([4a0edf6](https://github.com/ljquan/aitu/commit/4a0edf6))
- bump version to 0.5.29 ([9adb98a](https://github.com/ljquan/aitu/commit/9adb98a))
- bump version to 0.5.28 ([9fca109](https://github.com/ljquan/aitu/commit/9fca109))
- docs(claude): 添加 Service Worker 预缓存机制文档 ([c26bd23](https://github.com/ljquan/aitu/commit/c26bd23))
- docs(claude): 添加新规则 - 获取第三方组件位置应使用 getBoundingClientRect() ([082f274](https://github.com/ljquan/aitu/commit/082f274))
- docs(claude): 添加新规则 - 独立的 React 树缺少上下文环境 ([eac542f](https://github.com/ljquan/aitu/commit/eac542f))
- docs(claude): 添加新规则 - 传递给第三方库的回调无法获取最新 React state ([306ac42](https://github.com/ljquan/aitu/commit/306ac42))
- docs(claude): 添加新规则 - 点击外部关闭应使用全局事件监听而非透明遮罩层 ([36785f1](https://github.com/ljquan/aitu/commit/36785f1))
- docs(claude): 添加新规则 - React Context 回调中必须使用函数式更新 ([3b89eb2](https://github.com/ljquan/aitu/commit/3b89eb2))
- docs(claude): 添加异步任务重试与恢复规范 ([a7b61a0](https://github.com/ljquan/aitu/commit/a7b61a0))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.30 (2026-01-20)

### 🚀 Features

- enhance split and restore functionality for WinBoxWindow ([a53c0b8](https://github.com/ljquan/aitu/commit/a53c0b8))
- 优化批量出图 UI 和交互体验 ([94e2e05](https://github.com/ljquan/aitu/commit/94e2e05))
- add reference image handling in LLM API logs and enhance task recovery mechanisms ([c94b032](https://github.com/ljquan/aitu/commit/c94b032))
- implement model dropdown component with search functionality and update AI input bar to use # for model selection ([6aa6267](https://github.com/ljquan/aitu/commit/6aa6267))
- enhance performance panel with image count tracking and updated memory thresholds ([5ec5172](https://github.com/ljquan/aitu/commit/5ec5172))
- 优化素材库 UI 交互、缩放缓存、Grid 布局及空间效率 ([c64e4a7](https://github.com/ljquan/aitu/commit/c64e4a7))

### 🩹 Fixes

- keep auto-insert aspect ratio ([1457f27](https://github.com/ljquan/aitu/commit/1457f27))
- preserve image ratio in payload ([614fc8b](https://github.com/ljquan/aitu/commit/614fc8b))

### 🔧 Chores

- update app version to 0.5.29 and adjust build time ([4a0edf6](https://github.com/ljquan/aitu/commit/4a0edf6))
- bump version to 0.5.29 ([9adb98a](https://github.com/ljquan/aitu/commit/9adb98a))
- bump version to 0.5.28 ([9fca109](https://github.com/ljquan/aitu/commit/9fca109))
- bump version to 0.5.27 ([0b3c40b](https://github.com/ljquan/aitu/commit/0b3c40b))
- bump version to 0.5.26 ([10b2b16](https://github.com/ljquan/aitu/commit/10b2b16))
- enhance CDN response validation and update version to 0.5.25 ([155ec00](https://github.com/ljquan/aitu/commit/155ec00))
- bump version to 0.5.25 ([8bd7f30](https://github.com/ljquan/aitu/commit/8bd7f30))
- bump version to 0.5.22 ([5571d3f](https://github.com/ljquan/aitu/commit/5571d3f))
- bump version to 0.5.21 ([55ad29c](https://github.com/ljquan/aitu/commit/55ad29c))
- bump version to 0.5.20 ([8bfc191](https://github.com/ljquan/aitu/commit/8bfc191))
- bump version to 0.5.19 ([8707a5b](https://github.com/ljquan/aitu/commit/8707a5b))
- bump version to 0.5.18 ([88c0dfd](https://github.com/ljquan/aitu/commit/88c0dfd))
- bump version to 0.5.17 ([91799c9](https://github.com/ljquan/aitu/commit/91799c9))
- bump version to 0.5.17 and update build time in version.json ([51b5f3f](https://github.com/ljquan/aitu/commit/51b5f3f))
- bump version to 0.5.17 ([c41c9bd](https://github.com/ljquan/aitu/commit/c41c9bd))
- update paths for CDN compatibility and add npm publish scripts ([e4cdca4](https://github.com/ljquan/aitu/commit/e4cdca4))
- docs(claude): 添加新规则 - 独立的 React 树缺少上下文环境 ([eac542f](https://github.com/ljquan/aitu/commit/eac542f))
- docs(claude): 添加新规则 - 传递给第三方库的回调无法获取最新 React state ([306ac42](https://github.com/ljquan/aitu/commit/306ac42))
- docs(claude): 添加新规则 - 点击外部关闭应使用全局事件监听而非透明遮罩层 ([36785f1](https://github.com/ljquan/aitu/commit/36785f1))
- docs(claude): 添加新规则 - React Context 回调中必须使用函数式更新 ([3b89eb2](https://github.com/ljquan/aitu/commit/3b89eb2))
- docs(claude): 添加异步任务重试与恢复规范 ([a7b61a0](https://github.com/ljquan/aitu/commit/a7b61a0))
- docs(claude): 更新调试日志处理和命令行工具使用说明，添加后台清理任务日志记录示例 ([30cf458](https://github.com/ljquan/aitu/commit/30cf458))
- docs(claude): 添加 React 事件委托、筛选逻辑、Grid 布局及 UI 高度统一规则 ([dcabd75](https://github.com/ljquan/aitu/commit/dcabd75))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.29 (2026-01-20)

### 🚀 Features

- add reference image handling in LLM API logs and enhance task recovery mechanisms ([c94b032](https://github.com/ljquan/aitu/commit/c94b032))
- implement model dropdown component with search functionality and update AI input bar to use # for model selection ([6aa6267](https://github.com/ljquan/aitu/commit/6aa6267))
- enhance performance panel with image count tracking and updated memory thresholds ([5ec5172](https://github.com/ljquan/aitu/commit/5ec5172))

### 🩹 Fixes

- keep auto-insert aspect ratio ([1457f27](https://github.com/ljquan/aitu/commit/1457f27))
- preserve image ratio in payload ([614fc8b](https://github.com/ljquan/aitu/commit/614fc8b))

### 🔧 Chores

- bump version to 0.5.28 ([9fca109](https://github.com/ljquan/aitu/commit/9fca109))
- bump version to 0.5.27 ([0b3c40b](https://github.com/ljquan/aitu/commit/0b3c40b))
- bump version to 0.5.26 ([10b2b16](https://github.com/ljquan/aitu/commit/10b2b16))
- enhance CDN response validation and update version to 0.5.25 ([155ec00](https://github.com/ljquan/aitu/commit/155ec00))

### ❤️  Thank You

- gongchengtu <1817063960@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.26 (2026-01-20)

### 🚀 Features

- add reference image handling in LLM API logs and enhance task recovery mechanisms ([c94b032](https://github.com/ljquan/aitu/commit/c94b032))
- implement model dropdown component with search functionality and update AI input bar to use # for model selection ([6aa6267](https://github.com/ljquan/aitu/commit/6aa6267))
- enhance performance panel with image count tracking and updated memory thresholds ([5ec5172](https://github.com/ljquan/aitu/commit/5ec5172))

### 🔧 Chores

- enhance CDN response validation and update version to 0.5.25 ([155ec00](https://github.com/ljquan/aitu/commit/155ec00))
- bump version to 0.5.25 ([8bd7f30](https://github.com/ljquan/aitu/commit/8bd7f30))
- bump version to 0.5.22 ([5571d3f](https://github.com/ljquan/aitu/commit/5571d3f))
- bump version to 0.5.21 ([55ad29c](https://github.com/ljquan/aitu/commit/55ad29c))
- bump version to 0.5.20 ([8bfc191](https://github.com/ljquan/aitu/commit/8bfc191))
- bump version to 0.5.19 ([8707a5b](https://github.com/ljquan/aitu/commit/8707a5b))
- bump version to 0.5.18 ([88c0dfd](https://github.com/ljquan/aitu/commit/88c0dfd))
- bump version to 0.5.17 ([91799c9](https://github.com/ljquan/aitu/commit/91799c9))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.23 (2026-01-20)

### 🚀 Features

- 优化素材库 UI 交互、缩放缓存、Grid 布局及空间效率 ([c64e4a7](https://github.com/ljquan/aitu/commit/c64e4a7))

### 🔧 Chores

- bump version to 0.5.22 ([5571d3f](https://github.com/ljquan/aitu/commit/5571d3f))
- bump version to 0.5.21 ([55ad29c](https://github.com/ljquan/aitu/commit/55ad29c))
- bump version to 0.5.20 ([8bfc191](https://github.com/ljquan/aitu/commit/8bfc191))
- bump version to 0.5.19 ([8707a5b](https://github.com/ljquan/aitu/commit/8707a5b))
- bump version to 0.5.18 ([88c0dfd](https://github.com/ljquan/aitu/commit/88c0dfd))
- bump version to 0.5.17 ([91799c9](https://github.com/ljquan/aitu/commit/91799c9))
- bump version to 0.5.17 and update build time in version.json ([51b5f3f](https://github.com/ljquan/aitu/commit/51b5f3f))
- bump version to 0.5.17 ([c41c9bd](https://github.com/ljquan/aitu/commit/c41c9bd))
- docs(claude): 更新调试日志处理和命令行工具使用说明，添加后台清理任务日志记录示例 ([30cf458](https://github.com/ljquan/aitu/commit/30cf458))
- docs(claude): 添加 React 事件委托、筛选逻辑、Grid 布局及 UI 高度统一规则 ([dcabd75](https://github.com/ljquan/aitu/commit/dcabd75))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.17 (2026-01-20)

### 🚀 Features

- 优化素材库 UI 交互、缩放缓存、Grid 布局及空间效率 ([c64e4a7](https://github.com/ljquan/aitu/commit/c64e4a7))
- implement CORS domain handling and cache validation ([de13297](https://github.com/ljquan/aitu/commit/de13297))
- 封装函数不应被绕过、页面卸载清理定时器 ([f6bd3af](https://github.com/ljquan/aitu/commit/f6bd3af))
- enhance prompt history management with preset prompts ([8e8738c](https://github.com/ljquan/aitu/commit/8e8738c))

### 🔧 Chores

- update paths for CDN compatibility and add npm publish scripts ([e4cdca4](https://github.com/ljquan/aitu/commit/e4cdca4))
- bump version to 0.5.16 ([ef30e2e](https://github.com/ljquan/aitu/commit/ef30e2e))
- bump version to 0.5.15 ([c126ed5](https://github.com/ljquan/aitu/commit/c126ed5))
- update project references from aitu.chat to opentu.ai ([345b0a9](https://github.com/ljquan/aitu/commit/345b0a9))
- bump version to 0.5.14 ([305fa7f](https://github.com/ljquan/aitu/commit/305fa7f))
- docs(claude): 添加 React 事件委托、筛选逻辑、Grid 布局及 UI 高度统一规则 ([dcabd75](https://github.com/ljquan/aitu/commit/dcabd75))
- docs(claude): 添加部署脚本安全实践规则 ([ad9ef4d](https://github.com/ljquan/aitu/commit/ad9ef4d))
- docs(claude): 添加新规则 - SSH 远程执行复杂 Shell 命令应使用 base64 编码 ([e37666f](https://github.com/ljquan/aitu/commit/e37666f))
- refactor(sw-debug): reorganize cache statistics panel and enhance LLM API log entry styles ([31f684f](https://github.com/ljquan/aitu/commit/31f684f))
- docs(claude): 添加 Service Worker opaque 响应处理和缓存验证规则 ([bdbaff4](https://github.com/ljquan/aitu/commit/bdbaff4))
- docs(claude): 添加缓存策略和数据一致性规则 ([310b7d0](https://github.com/ljquan/aitu/commit/310b7d0))
- docs(claude): 添加新规则 - 封装函数不应被绕过、页面卸载清理定时器 ([06ae079](https://github.com/ljquan/aitu/commit/06ae079))
- docs(claude): 添加独立页面配色一致性规则 ([7876471](https://github.com/ljquan/aitu/commit/7876471))
- docs(claude): 添加 UI 重构信息完整性和日志保留优先级规则 ([d402148](https://github.com/ljquan/aitu/commit/d402148))
- docs(claude): 添加组件空状态处理和文案通用性规则 ([d2c1569](https://github.com/ljquan/aitu/commit/d2c1569))
- v0.5.11 ([f7e6f0b](https://github.com/ljquan/aitu/commit/f7e6f0b))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.15 (2026-01-20)

### 🔧 Chores

- update project references from aitu.chat to opentu.ai ([345b0a9](https://github.com/ljquan/aitu/commit/345b0a9))
- bump version to 0.5.14 ([305fa7f](https://github.com/ljquan/aitu/commit/305fa7f))
- docs(claude): 添加部署脚本安全实践规则 ([ad9ef4d](https://github.com/ljquan/aitu/commit/ad9ef4d))
- docs(claude): 添加新规则 - SSH 远程执行复杂 Shell 命令应使用 base64 编码 ([e37666f](https://github.com/ljquan/aitu/commit/e37666f))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.14 (2026-01-19)

### 🚀 Features

- implement CORS domain handling and cache validation ([de13297](https://github.com/ljquan/aitu/commit/de13297))
- 封装函数不应被绕过、页面卸载清理定时器 ([f6bd3af](https://github.com/ljquan/aitu/commit/f6bd3af))
- enhance prompt history management with preset prompts ([8e8738c](https://github.com/ljquan/aitu/commit/8e8738c))
- implement user confirmation for service worker upgrades ([f0571a7](https://github.com/ljquan/aitu/commit/f0571a7))
- add memory monitoring and crash logging features ([19f54ec](https://github.com/ljquan/aitu/commit/19f54ec))

### 🩹 Fixes

- 修复 workflows Map 和 setInterval 内存泄漏 ([bfb7ed5](https://github.com/ljquan/aitu/commit/bfb7ed5))

### 🔧 Chores

- bump version to 0.5.13 ([2edadb3](https://github.com/ljquan/aitu/commit/2edadb3))
- bump version to 0.5.10 and update changelog ([305b5d7](https://github.com/ljquan/aitu/commit/305b5d7))
- refactor(sw-debug): reorganize cache statistics panel and enhance LLM API log entry styles ([31f684f](https://github.com/ljquan/aitu/commit/31f684f))
- docs(claude): 添加 Service Worker opaque 响应处理和缓存验证规则 ([bdbaff4](https://github.com/ljquan/aitu/commit/bdbaff4))
- docs(claude): 添加缓存策略和数据一致性规则 ([310b7d0](https://github.com/ljquan/aitu/commit/310b7d0))
- docs(claude): 添加新规则 - 封装函数不应被绕过、页面卸载清理定时器 ([06ae079](https://github.com/ljquan/aitu/commit/06ae079))
- docs(claude): 添加独立页面配色一致性规则 ([7876471](https://github.com/ljquan/aitu/commit/7876471))
- docs(claude): 添加 UI 重构信息完整性和日志保留优先级规则 ([d402148](https://github.com/ljquan/aitu/commit/d402148))
- docs(claude): 添加组件空状态处理和文案通用性规则 ([d2c1569](https://github.com/ljquan/aitu/commit/d2c1569))
- v0.5.11 ([f7e6f0b](https://github.com/ljquan/aitu/commit/f7e6f0b))
- 添加更多版本 ([c4c7e3d](https://github.com/ljquan/aitu/commit/c4c7e3d))
- docs(claude): 添加内存泄漏预防规则 ([d1112d0](https://github.com/ljquan/aitu/commit/d1112d0))
- docs(claude): 添加 SW 更新和配置同步规则 ([2fb1088](https://github.com/ljquan/aitu/commit/2fb1088))
- docs(claude): 添加新规则 - navigator.storage.estimate() 返回浏览器配额而非磁盘空间 ([c823877](https://github.com/ljquan/aitu/commit/c823877))
- 优化渐变 ([de86f2a](https://github.com/ljquan/aitu/commit/de86f2a))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.12 (2026-01-19)

### 🚀 Features

- implement CORS domain handling and cache validation ([de13297](https://github.com/ljquan/aitu/commit/de13297))
- 封装函数不应被绕过、页面卸载清理定时器 ([f6bd3af](https://github.com/ljquan/aitu/commit/f6bd3af))
- enhance prompt history management with preset prompts ([8e8738c](https://github.com/ljquan/aitu/commit/8e8738c))

### 🔧 Chores

- refactor(sw-debug): reorganize cache statistics panel and enhance LLM API log entry styles ([31f684f](https://github.com/ljquan/aitu/commit/31f684f))
- docs(claude): 添加 Service Worker opaque 响应处理和缓存验证规则 ([bdbaff4](https://github.com/ljquan/aitu/commit/bdbaff4))
- docs(claude): 添加缓存策略和数据一致性规则 ([310b7d0](https://github.com/ljquan/aitu/commit/310b7d0))
- docs(claude): 添加新规则 - 封装函数不应被绕过、页面卸载清理定时器 ([06ae079](https://github.com/ljquan/aitu/commit/06ae079))
- docs(claude): 添加独立页面配色一致性规则 ([7876471](https://github.com/ljquan/aitu/commit/7876471))
- docs(claude): 添加 UI 重构信息完整性和日志保留优先级规则 ([d402148](https://github.com/ljquan/aitu/commit/d402148))
- docs(claude): 添加组件空状态处理和文案通用性规则 ([d2c1569](https://github.com/ljquan/aitu/commit/d2c1569))
- v0.5.11 ([f7e6f0b](https://github.com/ljquan/aitu/commit/f7e6f0b))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.5.11 (2026-01-18)

### 🚀 Features

- implement user confirmation for service worker upgrades ([f0571a7](https://github.com/ljquan/aitu/commit/f0571a7))
- add memory monitoring and crash logging features ([19f54ec](https://github.com/ljquan/aitu/commit/19f54ec))

### 🩹 Fixes

- 修复 workflows Map 和 setInterval 内存泄漏 ([bfb7ed5](https://github.com/ljquan/aitu/commit/bfb7ed5))

### 🔧 Chores

- bump version to 0.5.10 and update changelog ([305b5d7](https://github.com/ljquan/aitu/commit/305b5d7))
- 添加更多版本 ([c4c7e3d](https://github.com/ljquan/aitu/commit/c4c7e3d))
- docs(claude): 添加内存泄漏预防规则 ([d1112d0](https://github.com/ljquan/aitu/commit/d1112d0))
- docs(claude): 添加 SW 更新和配置同步规则 ([2fb1088](https://github.com/ljquan/aitu/commit/2fb1088))
- docs(claude): 添加新规则 - navigator.storage.estimate() 返回浏览器配额而非磁盘空间 ([c823877](https://github.com/ljquan/aitu/commit/c823877))
- 优化渐变 ([de86f2a](https://github.com/ljquan/aitu/commit/de86f2a))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.10 (2026-01-17)

### 🔧 Chores

- v0.5.9 ([c1c5d5b](https://github.com/ljquan/aitu/commit/c1c5d5b))
- refactor(fill-panel): enhance fill panel functionality and styles ([160170b](https://github.com/ljquan/aitu/commit/160170b))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.9 (2026-01-17)

### 🚀 Features

- enhance fill options with gradient and image support ([206af04](https://github.com/ljquan/aitu/commit/206af04))

### 🔧 Chores

- bump version to 0.5.8 and update changelog ([8f5953b](https://github.com/ljquan/aitu/commit/8f5953b))
- update version to 0.5.2 and enhance fill panel styles ([e2b4a84](https://github.com/ljquan/aitu/commit/e2b4a84))
- feat： 调整4k配置 ([5bfcb9e](https://github.com/ljquan/aitu/commit/5bfcb9e))
- docs(claude): 添加异步任务幂等性检查规则 ([e046e57](https://github.com/ljquan/aitu/commit/e046e57))
- docs(claude): 添加单击/双击区分场景的计时器清理规则 ([079374c](https://github.com/ljquan/aitu/commit/079374c))
- docs(claude): 添加 Service Worker 更新提示开发模式规则 ([9b8f79e](https://github.com/ljquan/aitu/commit/9b8f79e))
- docs(claude): 更新规则 - 滑块节流和 Plait API 签名 ([2286e34](https://github.com/ljquan/aitu/commit/2286e34))
- docs(claude): 添加工具函数使用和滑块更新策略规则 ([f51f914](https://github.com/ljquan/aitu/commit/f51f914))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- liquidliang <ljquan@qq.com>

## 0.5.8 (2026-01-17)

### 🚀 Features

- add debug panel and logging enhancements ([12576ee](https://github.com/ljquan/aitu/commit/12576ee))

### 🔧 Chores

- bump version to 0.5.7 and update changelog ([b38a485](https://github.com/ljquan/aitu/commit/b38a485))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.7 (2026-01-17)

### 🚀 Features

- enhance postMessage logging and workflow recovery ([d76a0e9](https://github.com/ljquan/aitu/commit/d76a0e9))

### 🔧 Chores

- bump version to 0.5.6 and update changelog ([6855673](https://github.com/ljquan/aitu/commit/6855673))
- refactor(ai-input-bar, project-drawer): remove debug logs and add cleanup effect ([b1f58f5](https://github.com/ljquan/aitu/commit/b1f58f5))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.6 (2026-01-17)

### 🚀 Features

- add touch support for mobile interactions ([d7a30ea](https://github.com/ljquan/aitu/commit/d7a30ea))

### 🔧 Chores

- bump version to 0.5.5 and update changelog ([e4b7c79](https://github.com/ljquan/aitu/commit/e4b7c79))
- style(ai-input-bar, version-update-prompt): enhance responsiveness and positioning for mobile devices ([bbcd896](https://github.com/ljquan/aitu/commit/bbcd896))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.5 (2026-01-17)

### 🚀 Features

- 添加双击重命名功能 ([e7968f1](https://github.com/ljquan/aitu/commit/e7968f1))

### 🔧 Chores

- bump version to 0.5.4 and update changelog ([9baf1a7](https://github.com/ljquan/aitu/commit/9baf1a7))
- refactor(storage): enhance database version handling and integrity checks ([dcfd46a](https://github.com/ljquan/aitu/commit/dcfd46a))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- Claude Code <claude@anthropic.com>

## 0.5.4 (2026-01-17)

### 🩹 Fixes

- improve version update handling and error response caching ([eb8da7e](https://github.com/ljquan/aitu/commit/eb8da7e))

### 🔧 Chores

- bump version to 0.5.3 and update changelog ([d83ffc4](https://github.com/ljquan/aitu/commit/d83ffc4))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.5.3 (2026-01-16)

### 🔧 Chores

- 去掉重试逻辑 ([77391d8](https://github.com/ljquan/aitu/commit/77391d8))
- v0.5.2 ([470742f](https://github.com/ljquan/aitu/commit/470742f))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.5.2 (2026-01-16)

### 🚀 Features

- add multi-selection resize functionality and new stroke styles ([85271a2](https://github.com/ljquan/aitu/commit/85271a2))
- implement viewport saving and restoration functionality ([e8b1f31](https://github.com/ljquan/aitu/commit/e8b1f31))
- add corner radius feature and enhance pen settings ([05b9a4d](https://github.com/ljquan/aitu/commit/05b9a4d))
- 当 API 返回 401 错误时自动打开设置对话框 ([ec60835](https://github.com/ljquan/aitu/commit/ec60835))
- 优化工具栏交互体验 ([3077f76](https://github.com/ljquan/aitu/commit/3077f76))
- 支持保存文件时嵌入媒体数据 ([cb2fcac](https://github.com/ljquan/aitu/commit/cb2fcac))
- 使用统一拾色器替换阴影和渐变的颜色选择器 ([5c2b5d8](https://github.com/ljquan/aitu/commit/5c2b5d8))
- 添加画笔描边样式设置并将画笔工具移至工具栏 ([9651a75](https://github.com/ljquan/aitu/commit/9651a75))
- 优化画笔和橡皮擦功能 ([79e1edf](https://github.com/ljquan/aitu/commit/79e1edf))
- 实现画笔和橡皮擦设置工具栏 ([1d5ceea](https://github.com/ljquan/aitu/commit/1d5ceea))
- 素材库增加 unified-cache 数据源 ([e0d23fa](https://github.com/ljquan/aitu/commit/e0d23fa))
- 添加备份恢复功能支持导出导入提示词、项目和素材 ([ee8f66f](https://github.com/ljquan/aitu/commit/ee8f66f))
- 添加参考图片智能处理和压缩功能 ([250cd1b](https://github.com/ljquan/aitu/commit/250cd1b))
- 集成 Sentry 错误监控并修复角色 API ([dc4c81e](https://github.com/ljquan/aitu/commit/dc4c81e))
- 优化图层控制面板和任务队列交互 ([2d4bb28](https://github.com/ljquan/aitu/commit/2d4bb28))
- 添加任务多选和批量操作功能 ([85ead4c](https://github.com/ljquan/aitu/commit/85ead4c))
- 增强批量出图功能和任务超时机制 ([2f26597](https://github.com/ljquan/aitu/commit/2f26597))
- 实现视频提示词即时保存到预设列表 ([275a7ff](https://github.com/ljquan/aitu/commit/275a7ff))
- 添加 isDataReady 状态防止灵感板闪烁 ([c615c27](https://github.com/ljquan/aitu/commit/c615c27))
- 添加 Claude Code 工作流自动化斜杠命令 ([3353665](https://github.com/ljquan/aitu/commit/3353665))
- 添加提示词预设置顶和删除功能 ([06e7ba9](https://github.com/ljquan/aitu/commit/06e7ba9))
- 完善 Service Worker 任务队列和工作流执行 ([b99f452](https://github.com/ljquan/aitu/commit/b99f452))
- 添加阴影颜色设置并加宽面板 ([765ed7d](https://github.com/ljquan/aitu/commit/765ed7d))
- 完善文本属性面板和字体管理系统 ([057fdef](https://github.com/ljquan/aitu/commit/057fdef))
- 添加智能文本粘贴功能和文档更新命令 ([334dfd0](https://github.com/ljquan/aitu/commit/334dfd0))
- 增强图片合并功能，支持图形、线条、手绘等元素 ([2c769d5](https://github.com/ljquan/aitu/commit/2c769d5))
- 增强视频缓存持久化和素材库 URL 支持 ([8d45cb8](https://github.com/ljquan/aitu/commit/8d45cb8))
- 增强图片尺寸感知和智能缓存处理 ([740f953](https://github.com/ljquan/aitu/commit/740f953))
- 实现合并视频的 Service Worker 缓存方案 ([e058f92](https://github.com/ljquan/aitu/commit/e058f92))
- 添加提示词工具快捷入口 ([c2ff40a](https://github.com/ljquan/aitu/commit/c2ff40a))
- 添加历史提示词功能支持置顶 ([bb52bc6](https://github.com/ljquan/aitu/commit/bb52bc6))
- 实现统一图片缓存系统 ([e8bd3ca](https://github.com/ljquan/aitu/commit/e8bd3ca))
- 添加 SizeDropdown 组件优化生图模型尺寸参数适配 ([8b49477](https://github.com/ljquan/aitu/commit/8b49477))
- 实现工作区缩放和左对齐插入位置功能 ([0b4516c](https://github.com/ljquan/aitu/commit/0b4516c))
- 新增共享工具函数库并重构相关代码 ([a34e2eb](https://github.com/ljquan/aitu/commit/a34e2eb))
- 添加灵感板组件和内容上传功能 ([531e612](https://github.com/ljquan/aitu/commit/531e612))

### 🩹 Fixes

- 修复备份恢复服务的 TypeScript 类型错误 ([8181a3f](https://github.com/ljquan/aitu/commit/8181a3f))
- improve key assignment and stroke width calculation ([52bf30f](https://github.com/ljquan/aitu/commit/52bf30f))
- use pnpm instead of npm for Vercel deployment ([315fd5d](https://github.com/ljquan/aitu/commit/315fd5d))
- 移除自动删除用户数据的逻辑 ([0942aa5](https://github.com/ljquan/aitu/commit/0942aa5))
- 修复 agent_flow 工作流卡在"待开始"状态的问题 ([718c644](https://github.com/ljquan/aitu/commit/718c644))
- 修复页面加载时小地图自动展开的问题 ([9cd009d](https://github.com/ljquan/aitu/commit/9cd009d))
- 修复宫格图生成时未使用选择的图像模型 ([2d88b98](https://github.com/ljquan/aitu/commit/2d88b98))
- 优化尺寸参数优先级策略 ([650b9c5](https://github.com/ljquan/aitu/commit/650b9c5))
- 修复任务删除和视频并发生成问题 ([906e0d6](https://github.com/ljquan/aitu/commit/906e0d6))
- 修复 API Key 加密问题和参考图残留问题 ([d11752e](https://github.com/ljquan/aitu/commit/d11752e))
- 修复 z-index 层级和双击事件穿透问题 ([cea2642](https://github.com/ljquan/aitu/commit/cea2642))
- 修复工作流重复提交和发送按钮状态问题 ([6ce9690](https://github.com/ljquan/aitu/commit/6ce9690))
- 修复多行 console.log 注释导致的语法错误 ([124b5dd](https://github.com/ljquan/aitu/commit/124b5dd))
- 修复画板初始状态闪烁问题并优化视频恢复逻辑 ([0a1aa0c](https://github.com/ljquan/aitu/commit/0a1aa0c))
- 改进LLM响应解析的健壮性 ([dd7c0d9](https://github.com/ljquan/aitu/commit/dd7c0d9))
- 修正示例1中图片生成提示词过于扩展的问题 ([6d2ffd6](https://github.com/ljquan/aitu/commit/6d2ffd6))
- 移除手动分包让Vite自动处理避免循环依赖 ([d9cfe7d](https://github.com/ljquan/aitu/commit/d9cfe7d))
- 更新CSP策略添加us-assets.i.posthog.com域名 feat(sw): 添加对非http/https请求的过滤 docs: 更新文档添加service worker源码路径 chore: 更新构建时间和版本信息 ([6b011de](https://github.com/ljquan/aitu/commit/6b011de))
- 仅缓存HTTP请求的响应以避免错误 ([f6c022a](https://github.com/ljquan/aitu/commit/f6c022a))

### 🔧 Chores

- 清理 console.log 调试日志 ([77340d8](https://github.com/ljquan/aitu/commit/77340d8))
- 发布版本 0.5.0 ([d2befb1](https://github.com/ljquan/aitu/commit/d2befb1))
- 注释掉所有 console.log/debug/info 日志 ([9fe03cf](https://github.com/ljquan/aitu/commit/9fe03cf))
- 更新版本号至0.4.3并优化vite分包配置 ([3349854](https://github.com/ljquan/aitu/commit/3349854))
- 更新构建命令和版本文件时间戳 ([9ec3837](https://github.com/ljquan/aitu/commit/9ec3837))
- docs(claude): 添加新规则 - 生产代码禁止保留调试日志 ([00df2f7](https://github.com/ljquan/aitu/commit/00df2f7))
- refactor(task-queue): 移除重复提交检测并优化存储性能 ([e1785a8](https://github.com/ljquan/aitu/commit/e1785a8))
- docs(claude): 添加新规则 - 重复提交检测应由 UI 层处理 ([c2e367f](https://github.com/ljquan/aitu/commit/c2e367f))
- docs(claude): 添加新规则 - API 请求禁止重试 ([b564930](https://github.com/ljquan/aitu/commit/b564930))
- refactor(api): 移除 API 重试逻辑简化错误处理 ([4ba9774](https://github.com/ljquan/aitu/commit/4ba9774))
- 优化画笔 ([2a66799](https://github.com/ljquan/aitu/commit/2a66799))
- docs(claude): 添加新规则 - 扩展外部库的枚举类型 ([156668e](https://github.com/ljquan/aitu/commit/156668e))
- docs(claude): 添加新规则 - Plait 选中状态渲染触发 ([34db489](https://github.com/ljquan/aitu/commit/34db489))
- docs(claude): 添加新规则 - Hover 延迟操作计时器清理 ([ebe979f](https://github.com/ljquan/aitu/commit/ebe979f))
- docs(claude): 添加新规则 - 元组类型 vs 数组类型 ([82f9d7a](https://github.com/ljquan/aitu/commit/82f9d7a))
- 优化形状 ([ceff394](https://github.com/ljquan/aitu/commit/ceff394))
- docs(claude): 添加新规则 - 对象字面量只能指定已知属性 ([378a512](https://github.com/ljquan/aitu/commit/378a512))
- docs(claude): 添加新规则 - 高频事件处理性能优化 ([1cfe7b4](https://github.com/ljquan/aitu/commit/1cfe7b4))
- docs(claude): 添加新规则 - PointerEvent 压力感应兼容性 ([70f325e](https://github.com/ljquan/aitu/commit/70f325e))
- 优化滑块位置 ([fec0f9b](https://github.com/ljquan/aitu/commit/fec0f9b))
- docs(claude): 添加新规则 - 绝对定位子元素需要正确的父容器设置 ([babc0f9](https://github.com/ljquan/aitu/commit/babc0f9))
- docs(claude): 添加新规则 - 新增 UI 组件需同步更新全局事件排除列表 ([4876bc8](https://github.com/ljquan/aitu/commit/4876bc8))
- docs(claude): 添加新规则 - 相对路径 URL 解析规范 ([1c988de](https://github.com/ljquan/aitu/commit/1c988de))
- 优化缓存获取 ([dbafcc4](https://github.com/ljquan/aitu/commit/dbafcc4))
- docs(claude): 添加新规则 - Cache API 缓存 key 一致性规范 ([bb22cae](https://github.com/ljquan/aitu/commit/bb22cae))
- 添加调试日志 ([4a5675b](https://github.com/ljquan/aitu/commit/4a5675b))
- docs(claude): 添加新规则 - Service Worker 内部处理虚拟路径 URL ([fceb939](https://github.com/ljquan/aitu/commit/fceb939))
- docs(claude): 添加新规则 - 虚拟路径 URL 匹配规范 ([91c1f65](https://github.com/ljquan/aitu/commit/91c1f65))
- docs(claude): 添加新规则 - 媒体 URL 处理规范（避免 CSP 和生命周期问题） ([f8272b4](https://github.com/ljquan/aitu/commit/f8272b4))
- style(text-property): 自定义渐变和预设渐变放在同一行展示 ([004cd48](https://github.com/ljquan/aitu/commit/004cd48))
- style(text-property): 调整阴影渐变拾色器宽度与设置面板一致 ([588b2ea](https://github.com/ljquan/aitu/commit/588b2ea))
- docs(claude): 添加新规则 - Freehand 元素属性设置需要自定义 callback ([e27bf28](https://github.com/ljquan/aitu/commit/e27bf28))
- docs(claude): 添加调试日志清理规范 ([3ad8400](https://github.com/ljquan/aitu/commit/3ad8400))
- refactor(image): extract shared border trimming utilities and update development guidelines ([90fad36](https://github.com/ljquan/aitu/commit/90fad36))
- docs: 添加 Service Worker 初始化时序规则 ([3dfa4d1](https://github.com/ljquan/aitu/commit/3dfa4d1))
- 去掉删除遗留db问题 ([c86ebba](https://github.com/ljquan/aitu/commit/c86ebba))
- 注释掉调试日志 ([898b77b](https://github.com/ljquan/aitu/commit/898b77b))
- perf(media-library): 实现任务队列和素材库的分页加载与虚拟滚动 ([5ace768](https://github.com/ljquan/aitu/commit/5ace768))
- docs(readme): 添加 Vercel 和 Netlify 一键部署按钮 ([424b1b8](https://github.com/ljquan/aitu/commit/424b1b8))
- deps: 移除 @sentry/react 并升级 typescript ([155d05e](https://github.com/ljquan/aitu/commit/155d05e))
- 优化导出 ([7b9d2eb](https://github.com/ljquan/aitu/commit/7b9d2eb))
- perf(image): 优化图片压缩算法使用二分查找 ([596a689](https://github.com/ljquan/aitu/commit/596a689))
- 迁移存储 ([0608b09](https://github.com/ljquan/aitu/commit/0608b09))
- docs(codebuddy): 添加 Sora-2 角色 API 约定文档 ([f25a09d](https://github.com/ljquan/aitu/commit/f25a09d))
- 完善命令 ([866c87a](https://github.com/ljquan/aitu/commit/866c87a))
- 优化提示词 ([a54ce64](https://github.com/ljquan/aitu/commit/a54ce64))
- 更新Claude.md ([bf34c5c](https://github.com/ljquan/aitu/commit/bf34c5c))
- 优化 ([574e17e](https://github.com/ljquan/aitu/commit/574e17e))
- 优化插入位置 ([70ee8f9](https://github.com/ljquan/aitu/commit/70ee8f9))
-  优化 ([0ab27b1](https://github.com/ljquan/aitu/commit/0ab27b1))
- 优化素材库展示 ([0a876a0](https://github.com/ljquan/aitu/commit/0a876a0))
- 优化图片上传到素材库 ([ff7a07d](https://github.com/ljquan/aitu/commit/ff7a07d))
- 优化缓存 ([7b65b7c](https://github.com/ljquan/aitu/commit/7b65b7c))
- style(ai-input-bar): 优化灵感板与输入框的无缝连接UI ([767f8c8](https://github.com/ljquan/aitu/commit/767f8c8))
- docs: 更新 CLAUDE.md 文档，添加新功能说明 ([fcfe109](https://github.com/ljquan/aitu/commit/fcfe109))
- docs(agent): 更新系统提示以明确JSON响应格式要求 ([b01ddf5](https://github.com/ljquan/aitu/commit/b01ddf5))
- refactor(vite配置): 简化分包策略让Vite自动处理依赖 ([05c1b37](https://github.com/ljquan/aitu/commit/05c1b37))
- refactor(vite配置): 移除mermaid手动分包改为自动处理 ([0b0cd48](https://github.com/ljquan/aitu/commit/0b0cd48))
- refactor(vite): 简化mermaid打包配置以避免循环依赖问题 ([f5c1ff5](https://github.com/ljquan/aitu/commit/f5c1ff5))
- build: 更新构建配置和依赖项 ([216f157](https://github.com/ljquan/aitu/commit/216f157))
- refactor(utils): 重构工具模块并迁移共享代码到独立包 ([69233dd](https://github.com/ljquan/aitu/commit/69233dd))
- perf(vite): 优化手动分块策略以按需加载依赖 ([5055de6](https://github.com/ljquan/aitu/commit/5055de6))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.5.0 (2026-01-13)

### 🚀 Features

- 添加备份恢复功能支持导出导入提示词、项目和素材 ([ee8f66f](https://github.com/ljquan/aitu/commit/ee8f66f))
- 添加参考图片智能处理和压缩功能 ([250cd1b](https://github.com/ljquan/aitu/commit/250cd1b))
- 集成 Sentry 错误监控并修复角色 API ([dc4c81e](https://github.com/ljquan/aitu/commit/dc4c81e))
- 优化图层控制面板和任务队列交互 ([2d4bb28](https://github.com/ljquan/aitu/commit/2d4bb28))
- 添加任务多选和批量操作功能 ([85ead4c](https://github.com/ljquan/aitu/commit/85ead4c))
- 增强批量出图功能和任务超时机制 ([2f26597](https://github.com/ljquan/aitu/commit/2f26597))
- 实现视频提示词即时保存到预设列表 ([275a7ff](https://github.com/ljquan/aitu/commit/275a7ff))
- 添加 isDataReady 状态防止灵感板闪烁 ([c615c27](https://github.com/ljquan/aitu/commit/c615c27))
- 添加 Claude Code 工作流自动化斜杠命令 ([3353665](https://github.com/ljquan/aitu/commit/3353665))
- 添加提示词预设置顶和删除功能 ([06e7ba9](https://github.com/ljquan/aitu/commit/06e7ba9))
- 完善 Service Worker 任务队列和工作流执行 ([b99f452](https://github.com/ljquan/aitu/commit/b99f452))
- 添加阴影颜色设置并加宽面板 ([765ed7d](https://github.com/ljquan/aitu/commit/765ed7d))
- 完善文本属性面板和字体管理系统 ([057fdef](https://github.com/ljquan/aitu/commit/057fdef))
- 添加智能文本粘贴功能和文档更新命令 ([334dfd0](https://github.com/ljquan/aitu/commit/334dfd0))
- 增强图片合并功能，支持图形、线条、手绘等元素 ([2c769d5](https://github.com/ljquan/aitu/commit/2c769d5))
- 增强视频缓存持久化和素材库 URL 支持 ([8d45cb8](https://github.com/ljquan/aitu/commit/8d45cb8))
- 增强图片尺寸感知和智能缓存处理 ([740f953](https://github.com/ljquan/aitu/commit/740f953))
- 实现合并视频的 Service Worker 缓存方案 ([e058f92](https://github.com/ljquan/aitu/commit/e058f92))
- 添加提示词工具快捷入口 ([c2ff40a](https://github.com/ljquan/aitu/commit/c2ff40a))
- 添加历史提示词功能支持置顶 ([bb52bc6](https://github.com/ljquan/aitu/commit/bb52bc6))
- 实现统一图片缓存系统 ([e8bd3ca](https://github.com/ljquan/aitu/commit/e8bd3ca))
- 添加 SizeDropdown 组件优化生图模型尺寸参数适配 ([8b49477](https://github.com/ljquan/aitu/commit/8b49477))
- 实现工作区缩放和左对齐插入位置功能 ([0b4516c](https://github.com/ljquan/aitu/commit/0b4516c))
- 新增共享工具函数库并重构相关代码 ([a34e2eb](https://github.com/ljquan/aitu/commit/a34e2eb))
- 添加灵感板组件和内容上传功能 ([531e612](https://github.com/ljquan/aitu/commit/531e612))

### 🩹 Fixes

- 优化尺寸参数优先级策略 ([650b9c5](https://github.com/ljquan/aitu/commit/650b9c5))
- 修复任务删除和视频并发生成问题 ([906e0d6](https://github.com/ljquan/aitu/commit/906e0d6))
- 修复 API Key 加密问题和参考图残留问题 ([d11752e](https://github.com/ljquan/aitu/commit/d11752e))
- 修复 z-index 层级和双击事件穿透问题 ([cea2642](https://github.com/ljquan/aitu/commit/cea2642))
- 修复工作流重复提交和发送按钮状态问题 ([6ce9690](https://github.com/ljquan/aitu/commit/6ce9690))
- 修复多行 console.log 注释导致的语法错误 ([124b5dd](https://github.com/ljquan/aitu/commit/124b5dd))
- 修复画板初始状态闪烁问题并优化视频恢复逻辑 ([0a1aa0c](https://github.com/ljquan/aitu/commit/0a1aa0c))
- 改进LLM响应解析的健壮性 ([dd7c0d9](https://github.com/ljquan/aitu/commit/dd7c0d9))
- 修正示例1中图片生成提示词过于扩展的问题 ([6d2ffd6](https://github.com/ljquan/aitu/commit/6d2ffd6))
- 移除手动分包让Vite自动处理避免循环依赖 ([d9cfe7d](https://github.com/ljquan/aitu/commit/d9cfe7d))
- 更新CSP策略添加us-assets.i.posthog.com域名 feat(sw): 添加对非http/https请求的过滤 docs: 更新文档添加service worker源码路径 chore: 更新构建时间和版本信息 ([6b011de](https://github.com/ljquan/aitu/commit/6b011de))
- 仅缓存HTTP请求的响应以避免错误 ([f6c022a](https://github.com/ljquan/aitu/commit/f6c022a))

### 🔧 Chores

- 注释掉所有 console.log/debug/info 日志 ([9fe03cf](https://github.com/ljquan/aitu/commit/9fe03cf))
- 更新版本号至0.4.3并优化vite分包配置 ([3349854](https://github.com/ljquan/aitu/commit/3349854))
- 更新构建命令和版本文件时间戳 ([9ec3837](https://github.com/ljquan/aitu/commit/9ec3837))
- deps: 移除 @sentry/react 并升级 typescript ([155d05e](https://github.com/ljquan/aitu/commit/155d05e))
- 优化导出 ([7b9d2eb](https://github.com/ljquan/aitu/commit/7b9d2eb))
- perf(image): 优化图片压缩算法使用二分查找 ([596a689](https://github.com/ljquan/aitu/commit/596a689))
- 迁移存储 ([0608b09](https://github.com/ljquan/aitu/commit/0608b09))
- docs(codebuddy): 添加 Sora-2 角色 API 约定文档 ([f25a09d](https://github.com/ljquan/aitu/commit/f25a09d))
- 完善命令 ([866c87a](https://github.com/ljquan/aitu/commit/866c87a))
- 优化提示词 ([a54ce64](https://github.com/ljquan/aitu/commit/a54ce64))
- 更新Claude.md ([bf34c5c](https://github.com/ljquan/aitu/commit/bf34c5c))
- 优化 ([574e17e](https://github.com/ljquan/aitu/commit/574e17e))
- 优化插入位置 ([70ee8f9](https://github.com/ljquan/aitu/commit/70ee8f9))
-  优化 ([0ab27b1](https://github.com/ljquan/aitu/commit/0ab27b1))
- 优化素材库展示 ([0a876a0](https://github.com/ljquan/aitu/commit/0a876a0))
- 优化图片上传到素材库 ([ff7a07d](https://github.com/ljquan/aitu/commit/ff7a07d))
- 优化缓存 ([7b65b7c](https://github.com/ljquan/aitu/commit/7b65b7c))
- style(ai-input-bar): 优化灵感板与输入框的无缝连接UI ([767f8c8](https://github.com/ljquan/aitu/commit/767f8c8))
- docs: 更新 CLAUDE.md 文档，添加新功能说明 ([fcfe109](https://github.com/ljquan/aitu/commit/fcfe109))
- docs(agent): 更新系统提示以明确JSON响应格式要求 ([b01ddf5](https://github.com/ljquan/aitu/commit/b01ddf5))
- refactor(vite配置): 简化分包策略让Vite自动处理依赖 ([05c1b37](https://github.com/ljquan/aitu/commit/05c1b37))
- refactor(vite配置): 移除mermaid手动分包改为自动处理 ([0b0cd48](https://github.com/ljquan/aitu/commit/0b0cd48))
- refactor(vite): 简化mermaid打包配置以避免循环依赖问题 ([f5c1ff5](https://github.com/ljquan/aitu/commit/f5c1ff5))
- build: 更新构建配置和依赖项 ([216f157](https://github.com/ljquan/aitu/commit/216f157))
- refactor(utils): 重构工具模块并迁移共享代码到独立包 ([69233dd](https://github.com/ljquan/aitu/commit/69233dd))
- perf(vite): 优化手动分块策略以按需加载依赖 ([5055de6](https://github.com/ljquan/aitu/commit/5055de6))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liquid <ljquan@qq.com>

## 0.4.2 (2026-01-07)

### 🩹 Fixes

- 移除手动分包让Vite自动处理避免循环依赖 ([edbc280](https://github.com/ljquan/aitu/commit/edbc280))

### 🔧 Chores

- refactor(vite配置): 移除mermaid手动分包改为自动处理 ([3d47e65](https://github.com/ljquan/aitu/commit/3d47e65))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.4.1 (2026-01-07)

### 🚀 Features

- 新增共享工具函数库并重构相关代码 ([9b3c35b](https://github.com/ljquan/aitu/commit/9b3c35b))
- 添加Service Worker构建配置并更新开发模式处理 ([71fdd65](https://github.com/ljquan/aitu/commit/71fdd65))
- 为AI输入栏、聊天抽屉和弹出工具栏添加事件追踪 ([24e5162](https://github.com/ljquan/aitu/commit/24e5162))
- 更新版本至0.4.0，添加快捷工具栏并优化工具栏配置 ([8627823](https://github.com/ljquan/aitu/commit/8627823))
- 升级版本至0.4.0并添加更新日志功能 ([222ff9e](https://github.com/ljquan/aitu/commit/222ff9e))
- 添加版本更新提示组件和交互逻辑 ([9084f9a](https://github.com/ljquan/aitu/commit/9084f9a))
- 更新版本信息和初始化数据加载方式 ([e0fed52](https://github.com/ljquan/aitu/commit/e0fed52))
- 优化 WorkZone 位置策略 ([604ef48](https://github.com/ljquan/aitu/commit/604ef48))
- 添加长视频生成与恢复功能 ([c7c3fa2](https://github.com/ljquan/aitu/commit/c7c3fa2))
- 发送工作流时不自动展开 ChatDrawer ([3275cd1](https://github.com/ljquan/aitu/commit/3275cd1))
- 添加 WorkZone 画布元素显示工作流进度 ([74ef571](https://github.com/ljquan/aitu/commit/74ef571))
- 添加 @ 触发模型选择和固定底栏布局 ([d409912](https://github.com/ljquan/aitu/commit/d409912))
- 添加长视频生成功能 ([2f5d84f](https://github.com/ljquan/aitu/commit/2f5d84f))
- 添加共享选中内容预览组件并重构相关代码 ([2a8be45](https://github.com/ljquan/aitu/commit/2a8be45))
- 增强文本选择和复制功能并优化布局 ([655e5a3](https://github.com/ljquan/aitu/commit/655e5a3))
- 添加SVG工具支持矢量图插入画布 ([404e8e1](https://github.com/ljquan/aitu/commit/404e8e1))
- 添加AI分析内容显示和工作流消息优化 ([8cd8277](https://github.com/ljquan/aitu/commit/8cd8277))
- 添加插入元素后自动滚动到视口的功能 ([1671c60](https://github.com/ljquan/aitu/commit/1671c60))

### 🩹 Fixes

- 更新CSP策略添加us-assets.i.posthog.com域名 feat(sw): 添加对非http/https请求的过滤 docs: 更新文档添加service worker源码路径 chore: 更新构建时间和版本信息 ([618eb11](https://github.com/ljquan/aitu/commit/618eb11))
- 仅缓存HTTP请求的响应以避免错误 ([405b9b1](https://github.com/ljquan/aitu/commit/405b9b1))
- WorkZone 元素不触发 popup-toolbar ([bc6298b](https://github.com/ljquan/aitu/commit/bc6298b))
- 优化白边检测逻辑并改进图片分割策略 ([c864077](https://github.com/ljquan/aitu/commit/c864077))
- 修复工具栏按钮在打开状态时仍显示标题的问题 ([8973b8b](https://github.com/ljquan/aitu/commit/8973b8b))
- 优化宫格图分割逻辑，避免误裁透明背景角色 ([795fd28](https://github.com/ljquan/aitu/commit/795fd28))
- 修复消息提示实例未正确关闭的问题 ([0a5fbb9](https://github.com/ljquan/aitu/commit/0a5fbb9))
- 优化图片生成错误信息，返回原始 API 错误内容 ([0c38f4c](https://github.com/ljquan/aitu/commit/0c38f4c))

### 🔧 Chores

- 更新构建命令和版本文件时间戳 ([8827450](https://github.com/ljquan/aitu/commit/8827450))
- 将package-lock.json添加到.gitignore中 ([c9730ac](https://github.com/ljquan/aitu/commit/c9730ac))
- refactor(vite): 简化mermaid打包配置以避免循环依赖问题 ([a216206](https://github.com/ljquan/aitu/commit/a216206))
- build: 更新构建配置和依赖项 ([fef8673](https://github.com/ljquan/aitu/commit/fef8673))
- refactor(utils): 重构工具模块并迁移共享代码到独立包 ([b88e027](https://github.com/ljquan/aitu/commit/b88e027))
- perf(vite): 优化手动分块策略以按需加载依赖 ([bd87da4](https://github.com/ljquan/aitu/commit/bd87da4))
- refactor: 移除不必要的 rollupOptions 配置 ([936e9a9](https://github.com/ljquan/aitu/commit/936e9a9))
- refactor: 移除未使用的ffmpeg依赖和视频合并服务 ([51ecdb2](https://github.com/ljquan/aitu/commit/51ecdb2))
- docs: 更新 CLAUDE.md 添加 WorkZone 文档 ([3f9d194](https://github.com/ljquan/aitu/commit/3f9d194))
- 优化 ([d785603](https://github.com/ljquan/aitu/commit/d785603))
- 优化宫格拆图 ([47e4ca7](https://github.com/ljquan/aitu/commit/47e4ca7))
- 优化宫格图 ([acf2372](https://github.com/ljquan/aitu/commit/acf2372))
- 优化历史提示词展示 ([cf0f174](https://github.com/ljquan/aitu/commit/cf0f174))
- 优化提示词 ([cdd5ac4](https://github.com/ljquan/aitu/commit/cdd5ac4))
- 优化拆分 ([7c4d4fe](https://github.com/ljquan/aitu/commit/7c4d4fe))
- 优化拆图 ([39885a1](https://github.com/ljquan/aitu/commit/39885a1))
- 优化拆图 ([e072ca0](https://github.com/ljquan/aitu/commit/e072ca0))
- 照片墙改成灵感图 ([e3f1d9a](https://github.com/ljquan/aitu/commit/e3f1d9a))
- 优化拆分 ([0d1ebce](https://github.com/ljquan/aitu/commit/0d1ebce))
- 优化模型注入 ([97d113e](https://github.com/ljquan/aitu/commit/97d113e))
- 优化对话抽屉 ([d7b1714](https://github.com/ljquan/aitu/commit/d7b1714))
- 优化抽屉输入框 ([cfb87f3](https://github.com/ljquan/aitu/commit/cfb87f3))
- 对话抽屉换到右侧 ([50c8e72](https://github.com/ljquan/aitu/commit/50c8e72))
- 优化去白边 ([94d2e24](https://github.com/ljquan/aitu/commit/94d2e24))
- 优化 ([a49eba8](https://github.com/ljquan/aitu/commit/a49eba8))
- 优化拆分 ([49828b8](https://github.com/ljquan/aitu/commit/49828b8))
- 优化拆图 ([22afb18](https://github.com/ljquan/aitu/commit/22afb18))
- 添加照片墙 ([24f1bee](https://github.com/ljquan/aitu/commit/24f1bee))
- 修改概念 ([5213d28](https://github.com/ljquan/aitu/commit/5213d28))
- 下载 ([9f924a1](https://github.com/ljquan/aitu/commit/9f924a1))
- 优化切图 ([f299821](https://github.com/ljquan/aitu/commit/f299821))
- 优化 ([99d3342](https://github.com/ljquan/aitu/commit/99d3342))
- 生成照片墙 ([b17cf46](https://github.com/ljquan/aitu/commit/b17cf46))
- 优化图、视频mcp ([8f2cee5](https://github.com/ljquan/aitu/commit/8f2cee5))
- 添加思维导图mcp ([ab51889](https://github.com/ljquan/aitu/commit/ab51889))
- 增加冷启动提示词 ([c705055](https://github.com/ljquan/aitu/commit/c705055))
- 修复对话 ([a11d401](https://github.com/ljquan/aitu/commit/a11d401))
- 优化指令 ([9f8ad01](https://github.com/ljquan/aitu/commit/9f8ad01))
- 优化工作流实现 ([ba00566](https://github.com/ljquan/aitu/commit/ba00566))
- 优化点击 ([904a6c5](https://github.com/ljquan/aitu/commit/904a6c5))
- 优化 ([f096ce2](https://github.com/ljquan/aitu/commit/f096ce2))
- 优化提示词 ([f281595](https://github.com/ljquan/aitu/commit/f281595))
- 优化数量选择 ([18ca11d](https://github.com/ljquan/aitu/commit/18ca11d))
- 优化多任务 ([61c615b](https://github.com/ljquan/aitu/commit/61c615b))
- 优化删除 ([f000e29](https://github.com/ljquan/aitu/commit/f000e29))
- 优化提示词 ([530ad3a](https://github.com/ljquan/aitu/commit/530ad3a))
- 优化 ([6121a6a](https://github.com/ljquan/aitu/commit/6121a6a))
- 并行 ([fd793c7](https://github.com/ljquan/aitu/commit/fd793c7))
- 优化工作流 ([0dbd619](https://github.com/ljquan/aitu/commit/0dbd619))
- 优化 ([5bfcf88](https://github.com/ljquan/aitu/commit/5bfcf88))
- 优化输入框 ([7263289](https://github.com/ljquan/aitu/commit/7263289))
- 优化参数 ([b46af91](https://github.com/ljquan/aitu/commit/b46af91))
- 优化样式 ([560ee6f](https://github.com/ljquan/aitu/commit/560ee6f))
- 样式优化 ([726d27b](https://github.com/ljquan/aitu/commit/726d27b))
- 优化 ([1d24b51](https://github.com/ljquan/aitu/commit/1d24b51))
- 添加文本模型设置 ([41670cf](https://github.com/ljquan/aitu/commit/41670cf))
- 优化 ([441db62](https://github.com/ljquan/aitu/commit/441db62))
- 优化输入框 ([b0fe73c](https://github.com/ljquan/aitu/commit/b0fe73c))
- 优化提示词 ([50c06be](https://github.com/ljquan/aitu/commit/50c06be))
- 优化输入框交互 ([f0017b8](https://github.com/ljquan/aitu/commit/f0017b8))
- 优化输入框 ([0d3624d](https://github.com/ljquan/aitu/commit/0d3624d))
- 优化 ([e18c059](https://github.com/ljquan/aitu/commit/e18c059))
- 样式优化 ([620940d](https://github.com/ljquan/aitu/commit/620940d))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>
- wj <wj@MacBook-Pro.local>
- gongchengtu <1817063960@qq.com>

## 0.4.0 (2026-01-05)

### 🚀 Features

- 添加版本更新提示组件和交互逻辑 ([9084f9a](https://github.com/ljquan/aitu/commit/9084f9a))
- 更新版本信息和初始化数据加载方式 ([e0fed52](https://github.com/ljquan/aitu/commit/e0fed52))
- 优化 WorkZone 位置策略 ([604ef48](https://github.com/ljquan/aitu/commit/604ef48))
- 添加长视频生成与恢复功能 ([c7c3fa2](https://github.com/ljquan/aitu/commit/c7c3fa2))
- 发送工作流时不自动展开 ChatDrawer ([3275cd1](https://github.com/ljquan/aitu/commit/3275cd1))
- 添加 WorkZone 画布元素显示工作流进度 ([74ef571](https://github.com/ljquan/aitu/commit/74ef571))
- 添加 @ 触发模型选择和固定底栏布局 ([d409912](https://github.com/ljquan/aitu/commit/d409912))
- 添加长视频生成功能 ([2f5d84f](https://github.com/ljquan/aitu/commit/2f5d84f))
- 添加共享选中内容预览组件并重构相关代码 ([2a8be45](https://github.com/ljquan/aitu/commit/2a8be45))
- 增强文本选择和复制功能并优化布局 ([655e5a3](https://github.com/ljquan/aitu/commit/655e5a3))
- 添加SVG工具支持矢量图插入画布 ([404e8e1](https://github.com/ljquan/aitu/commit/404e8e1))
- 添加AI分析内容显示和工作流消息优化 ([8cd8277](https://github.com/ljquan/aitu/commit/8cd8277))
- 添加插入元素后自动滚动到视口的功能 ([1671c60](https://github.com/ljquan/aitu/commit/1671c60))

### 🩹 Fixes

- WorkZone 元素不触发 popup-toolbar ([bc6298b](https://github.com/ljquan/aitu/commit/bc6298b))
- 优化白边检测逻辑并改进图片分割策略 ([c864077](https://github.com/ljquan/aitu/commit/c864077))
- 修复工具栏按钮在打开状态时仍显示标题的问题 ([8973b8b](https://github.com/ljquan/aitu/commit/8973b8b))
- 优化宫格图分割逻辑，避免误裁透明背景角色 ([795fd28](https://github.com/ljquan/aitu/commit/795fd28))
- 修复消息提示实例未正确关闭的问题 ([0a5fbb9](https://github.com/ljquan/aitu/commit/0a5fbb9))

### 🔧 Chores

- 将package-lock.json添加到.gitignore中 ([c9730ac](https://github.com/ljquan/aitu/commit/c9730ac))
- refactor: 移除未使用的ffmpeg依赖和视频合并服务 ([51ecdb2](https://github.com/ljquan/aitu/commit/51ecdb2))
- docs: 更新 CLAUDE.md 添加 WorkZone 文档 ([3f9d194](https://github.com/ljquan/aitu/commit/3f9d194))
- 优化 ([d785603](https://github.com/ljquan/aitu/commit/d785603))
- 优化宫格拆图 ([47e4ca7](https://github.com/ljquan/aitu/commit/47e4ca7))
- 优化宫格图 ([acf2372](https://github.com/ljquan/aitu/commit/acf2372))
- 优化历史提示词展示 ([cf0f174](https://github.com/ljquan/aitu/commit/cf0f174))
- 优化提示词 ([cdd5ac4](https://github.com/ljquan/aitu/commit/cdd5ac4))
- 优化拆分 ([7c4d4fe](https://github.com/ljquan/aitu/commit/7c4d4fe))
- 优化拆图 ([39885a1](https://github.com/ljquan/aitu/commit/39885a1))
- 优化拆图 ([e072ca0](https://github.com/ljquan/aitu/commit/e072ca0))
- 照片墙改成灵感图 ([e3f1d9a](https://github.com/ljquan/aitu/commit/e3f1d9a))
- 优化拆分 ([0d1ebce](https://github.com/ljquan/aitu/commit/0d1ebce))
- 优化模型注入 ([97d113e](https://github.com/ljquan/aitu/commit/97d113e))
- 优化对话抽屉 ([d7b1714](https://github.com/ljquan/aitu/commit/d7b1714))
- 优化抽屉输入框 ([cfb87f3](https://github.com/ljquan/aitu/commit/cfb87f3))
- 对话抽屉换到右侧 ([50c8e72](https://github.com/ljquan/aitu/commit/50c8e72))
- 优化去白边 ([94d2e24](https://github.com/ljquan/aitu/commit/94d2e24))
- 优化 ([a49eba8](https://github.com/ljquan/aitu/commit/a49eba8))
- 优化拆分 ([49828b8](https://github.com/ljquan/aitu/commit/49828b8))
- 优化拆图 ([22afb18](https://github.com/ljquan/aitu/commit/22afb18))
- 添加照片墙 ([24f1bee](https://github.com/ljquan/aitu/commit/24f1bee))
- 修改概念 ([5213d28](https://github.com/ljquan/aitu/commit/5213d28))
- 下载 ([9f924a1](https://github.com/ljquan/aitu/commit/9f924a1))
- 优化切图 ([f299821](https://github.com/ljquan/aitu/commit/f299821))
- 优化 ([99d3342](https://github.com/ljquan/aitu/commit/99d3342))
- 生成照片墙 ([b17cf46](https://github.com/ljquan/aitu/commit/b17cf46))
- 优化图、视频mcp ([8f2cee5](https://github.com/ljquan/aitu/commit/8f2cee5))
- 添加思维导图mcp ([ab51889](https://github.com/ljquan/aitu/commit/ab51889))
- 增加冷启动提示词 ([c705055](https://github.com/ljquan/aitu/commit/c705055))
- 修复对话 ([a11d401](https://github.com/ljquan/aitu/commit/a11d401))
- 优化指令 ([9f8ad01](https://github.com/ljquan/aitu/commit/9f8ad01))
- 优化工作流实现 ([ba00566](https://github.com/ljquan/aitu/commit/ba00566))
- 优化点击 ([904a6c5](https://github.com/ljquan/aitu/commit/904a6c5))
- 优化 ([f096ce2](https://github.com/ljquan/aitu/commit/f096ce2))
- 优化提示词 ([f281595](https://github.com/ljquan/aitu/commit/f281595))
- 优化数量选择 ([18ca11d](https://github.com/ljquan/aitu/commit/18ca11d))
- 优化多任务 ([61c615b](https://github.com/ljquan/aitu/commit/61c615b))
- 优化删除 ([f000e29](https://github.com/ljquan/aitu/commit/f000e29))
- 优化提示词 ([530ad3a](https://github.com/ljquan/aitu/commit/530ad3a))
- 优化 ([6121a6a](https://github.com/ljquan/aitu/commit/6121a6a))
- 并行 ([fd793c7](https://github.com/ljquan/aitu/commit/fd793c7))
- 优化工作流 ([0dbd619](https://github.com/ljquan/aitu/commit/0dbd619))
- 优化 ([5bfcf88](https://github.com/ljquan/aitu/commit/5bfcf88))
- 优化输入框 ([7263289](https://github.com/ljquan/aitu/commit/7263289))
- 优化参数 ([b46af91](https://github.com/ljquan/aitu/commit/b46af91))
- 优化样式 ([560ee6f](https://github.com/ljquan/aitu/commit/560ee6f))
- 样式优化 ([726d27b](https://github.com/ljquan/aitu/commit/726d27b))
- 优化 ([1d24b51](https://github.com/ljquan/aitu/commit/1d24b51))
- 添加文本模型设置 ([41670cf](https://github.com/ljquan/aitu/commit/41670cf))
- 优化 ([441db62](https://github.com/ljquan/aitu/commit/441db62))
- 优化输入框 ([b0fe73c](https://github.com/ljquan/aitu/commit/b0fe73c))
- 优化提示词 ([50c06be](https://github.com/ljquan/aitu/commit/50c06be))
- 优化输入框交互 ([f0017b8](https://github.com/ljquan/aitu/commit/f0017b8))
- 优化输入框 ([0d3624d](https://github.com/ljquan/aitu/commit/0d3624d))
- 优化 ([e18c059](https://github.com/ljquan/aitu/commit/e18c059))
- 样式优化 ([620940d](https://github.com/ljquan/aitu/commit/620940d))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- wj <wj@MacBook-Pro.local>
- liquidliang <ljquan@qq.com>

## 0.3.3 (2025-12-29)

### 🚀 Features

- 新增视图模式切换和性能优化 ([c8eecf5](https://github.com/ljquan/aitu/commit/c8eecf5))
- 优化场景时长选择器和角色提取限制 ([12441ee](https://github.com/ljquan/aitu/commit/12441ee))
- 优化故事场景模式UI和配置 ([9ff294a](https://github.com/ljquan/aitu/commit/9ff294a))
- 添加 Sora-2 角色提取与复用功能 ([26aefb0](https://github.com/ljquan/aitu/commit/26aefb0))
- 添加 Sora-2 故事场景模式支持 ([7155c5b](https://github.com/ljquan/aitu/commit/7155c5b))
- 任务卡片添加打开链接功能 ([07bb0b3](https://github.com/ljquan/aitu/commit/07bb0b3))
- 优化图片加载体验 ([3fba487](https://github.com/ljquan/aitu/commit/3fba487))
- 任务创建时间改为绝对时间格式 ([fc5a864](https://github.com/ljquan/aitu/commit/fc5a864))

### 🩹 Fixes

- 添加 @tanstack/react-virtual 到根目录依赖解决构建问题 ([8a08d58](https://github.com/ljquan/aitu/commit/8a08d58))
- 优化视频生成参考图多图处理和模型切换保留 ([e1782e8](https://github.com/ljquan/aitu/commit/e1782e8))
- 虚拟滚动优化和视图模式持久化 ([af2978c](https://github.com/ljquan/aitu/commit/af2978c))
- 优化角色任务队列展示和预览功能 ([718052a](https://github.com/ljquan/aitu/commit/718052a))
- 修复角色接口兼容任务队列请求 ([e1b8562](https://github.com/ljquan/aitu/commit/e1b8562))
- 角色加载优化 ([4c4879b](https://github.com/ljquan/aitu/commit/4c4879b))
- 修复角色提取功能问题 ([8a121ba](https://github.com/ljquan/aitu/commit/8a121ba))
- 修复创建角色缓存问题 ([6372a89](https://github.com/ljquan/aitu/commit/6372a89))
- 故事板支持@角色 ([3f18b8e](https://github.com/ljquan/aitu/commit/3f18b8e))
- 角色提示优化 ([4eafc4d](https://github.com/ljquan/aitu/commit/4eafc4d))
- 故事场景模式优化 ([dc90986](https://github.com/ljquan/aitu/commit/dc90986))
- 修复重试时立即报超时的问题 ([1f2df99](https://github.com/ljquan/aitu/commit/1f2df99))
- 优化下载逻辑，优先使用本地缓存并增加重试机制 ([0c03c5d](https://github.com/ljquan/aitu/commit/0c03c5d))

### 🔧 Chores

- 同步 package-lock.json 添加 @tanstack/react-virtual ([69fe1d5](https://github.com/ljquan/aitu/commit/69fe1d5))
- 添加 pnpm-lock.yaml 修复 Netlify 构建 ([c74f2ed](https://github.com/ljquan/aitu/commit/c74f2ed))
- refactor(character): 代码质量优化 ([3918571](https://github.com/ljquan/aitu/commit/3918571))
- 不同模型 @ 显示区分 ([6e1d8be](https://github.com/ljquan/aitu/commit/6e1d8be))
- 优化图标 ([5c82e04](https://github.com/ljquan/aitu/commit/5c82e04))

### ❤️  Thank You

- gongchengtu <1817063960@qq.com>
- liquidliang <ljquan@qq.com>

## 0.3.2 (2025-12-23)

### 🔧 Chores

- 添加域名处理 ([b227909](https://github.com/ljquan/aitu/commit/b227909))
- v0.3.1 ([0f639c3](https://github.com/ljquan/aitu/commit/0f639c3))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.3.1 (2025-12-23)

### 🚀 Features

- 优化AI图片和AI视频图标样式 ([237695f](https://github.com/ljquan/aitu/commit/237695f))
- 优化工具栏图标布局和AI图标样式 ([00392d4](https://github.com/ljquan/aitu/commit/00392d4))
- 优化按钮布局 close #42 ([80ed227](https://github.com/ljquan/aitu/commit/80ed227))
- 将模式切换按钮移至 WinBox 标题栏 ([4c8617b](https://github.com/ljquan/aitu/commit/4c8617b))
- 添加新 VIP 图片模型并优化模型选择器 ([64ca946](https://github.com/ljquan/aitu/commit/64ca946))
- 优化表格交互体验 ([093681e](https://github.com/ljquan/aitu/commit/093681e))
- 生成中状态显示在已完成图片后面 ([3a81415](https://github.com/ljquan/aitu/commit/3a81415))
- 智能下载功能（单张直接下载，多张打包zip） ([5ba9ab7](https://github.com/ljquan/aitu/commit/5ba9ab7))
- 添加图片预览导航和生成警告功能 ([b02f181](https://github.com/ljquan/aitu/commit/b02f181))
- 添加模式记忆功能 ([05a16ff](https://github.com/ljquan/aitu/commit/05a16ff))
- 改进错误信息显示 ([a3d4d41](https://github.com/ljquan/aitu/commit/a3d4d41))
- 添加本地缓存和修复光标位置 ([ab2cba7](https://github.com/ljquan/aitu/commit/ab2cba7))
- 改进单元格交互体验 ([f8a88e5](https://github.com/ljquan/aitu/commit/f8a88e5))
- 改进数量单元格的交互体验 ([5e86ff4](https://github.com/ljquan/aitu/commit/5e86ff4))
- 切换到批量模式时自动最大化窗口 ([6dc6283](https://github.com/ljquan/aitu/commit/6dc6283))
- 改进添加行UI和下载模板功能 ([4f9e2b8](https://github.com/ljquan/aitu/commit/4f9e2b8))
- 添加图片预览放大、批量下载和模型选择功能 ([ab23c7d](https://github.com/ljquan/aitu/commit/ab23c7d))
- 添加 Excel 导入导出功能 ([7afe54b](https://github.com/ljquan/aitu/commit/7afe54b))
- 支持选择批量导入的起始行 ([c322a95](https://github.com/ljquan/aitu/commit/c322a95))
- 添加批量上传导入表格功能 ([59d0c81](https://github.com/ljquan/aitu/commit/59d0c81))
- 添加复选框列用于行选择 ([b373b8f](https://github.com/ljquan/aitu/commit/b373b8f))
- 添加预览列、选择功能和仅生成选中行 ([efb9253](https://github.com/ljquan/aitu/commit/efb9253))
- 将批量出图集成到 AI 图片生成对话框 ([51a8141](https://github.com/ljquan/aitu/commit/51a8141))
- 重构批量任务提交逻辑，添加批次参数避免重复检测 ([9885195](https://github.com/ljquan/aitu/commit/9885195))
- 增强批量出图功能 ([c608c09](https://github.com/ljquan/aitu/commit/c608c09))
- 添加批量出图工具及图片库功能 ([5b943db](https://github.com/ljquan/aitu/commit/5b943db))

### 🩹 Fixes

- 修复批量生成预览图首次加载损坏问题 ([1ba7a93](https://github.com/ljquan/aitu/commit/1ba7a93))
- 修复无API Key时批量生成弹出多个弹窗问题 ([0613708](https://github.com/ljquan/aitu/commit/0613708))
- 修复填充柄与选择拖拽冲突问题 ([f128f28](https://github.com/ljquan/aitu/commit/f128f28))
- 优化画廊和下载功能 ([af0e7d9](https://github.com/ljquan/aitu/commit/af0e7d9))
- 修复带内容进入时自动放大问题 ([d60a25d](https://github.com/ljquan/aitu/commit/d60a25d))
- 修复多项交互问题 ([c94283b](https://github.com/ljquan/aitu/commit/c94283b))
- 修复单元格选择和复制粘贴功能 ([faa24b9](https://github.com/ljquan/aitu/commit/faa24b9))
- 点击失败行预览单元格时选中行复选框 ([382e94b](https://github.com/ljquan/aitu/commit/382e94b))
- 统一错误显示格式与任务队列一致 ([f2c1732](https://github.com/ljquan/aitu/commit/f2c1732))
- 修复编辑模式下单击退出编辑的问题 ([796c5ec](https://github.com/ljquan/aitu/commit/796c5ec))
- 修正单元格交互为Excel风格 ([335cbb9](https://github.com/ljquan/aitu/commit/335cbb9))
- 添加 globalIndex 确保每个子任务哈希唯一 ([ed6c92b](https://github.com/ljquan/aitu/commit/ed6c92b))

### 🔧 Chores

- 优化z-index ([94e887d](https://github.com/ljquan/aitu/commit/94e887d))
- style(batch-image): 将批量出图按钮改为文字链接样式 ([43e9871](https://github.com/ljquan/aitu/commit/43e9871))
- refactor(batch-image): 移除状态、预览、操作列，简化为纯提交工具 ([735e736](https://github.com/ljquan/aitu/commit/735e736))

### ❤️  Thank You

- gongchengtu <1817063960@qq.com>
- liquidliang <ljquan@qq.com>
- likeusewin10 <1375280732@qq.com>

## 0.3.0 (2025-12-16)

### 🩹 Fixes

- 添加 .npmrc 解决 CI 依赖安装冲突 ([0b8f8e1](https://github.com/ljquan/aitu/commit/0b8f8e1))
- 修复winbox 中任务显示不正常 ([3f16f13](https://github.com/ljquan/aitu/commit/3f16f13))

### 🔧 Chores

- 指示小优化 ([d90971f](https://github.com/ljquan/aitu/commit/d90971f))
- 素材库位置优化 ([5e2e0ea](https://github.com/ljquan/aitu/commit/5e2e0ea))
- 工具箱优化 ([794ca89](https://github.com/ljquan/aitu/commit/794ca89))
- 更换chat生图接口为 image接口、修复素材库边距 ([4757992](https://github.com/ljquan/aitu/commit/4757992))
- 优化教程 ([f927878](https://github.com/ljquan/aitu/commit/f927878))

### ❤️  Thank You

- gongchengtu <1817063960@qq.com>
- liquid <ljquan@qq.com>

## 0.2.15 (2025-12-13)

### 🚀 Features

- 素材库批量删除支持 ([5440dae](https://github.com/ljquan/aitu/commit/5440dae))
- 素材库初版实现 ([9acfaa4](https://github.com/ljquan/aitu/commit/9acfaa4))
- 实现多功能工具箱系统 ([2ece4c6](https://github.com/ljquan/aitu/commit/2ece4c6))
- 优化工具栏和AI生成功能 ([51e6f5c](https://github.com/ljquan/aitu/commit/51e6f5c))
- 优化项目抽屉UI和图标设计 ([615f4f6](https://github.com/ljquan/aitu/commit/615f4f6))
- workspace项目管理系统及首次访问默认数据 ([a6d6a84](https://github.com/ljquan/aitu/commit/a6d6a84))

### 🩹 Fixes

- 素材库移动端优化 ([cad4025](https://github.com/ljquan/aitu/commit/cad4025))
- 素材填入优化 ([6dfbe94](https://github.com/ljquan/aitu/commit/6dfbe94))
- 视频加载修复 ([9e7a5f7](https://github.com/ljquan/aitu/commit/9e7a5f7))
- 素材库样式修复 ([34b36a5](https://github.com/ljquan/aitu/commit/34b36a5))
- 修复视频模型切换参数同步问题 ([53a653e](https://github.com/ljquan/aitu/commit/53a653e))

### 🔧 Chores

- bump version to 0.2.14 ([66e8bba](https://github.com/ljquan/aitu/commit/66e8bba))
- 优化交互 ([a961727](https://github.com/ljquan/aitu/commit/a961727))
- 优化缩放 ([c605f5a](https://github.com/ljquan/aitu/commit/c605f5a))
- 优化工具 ([62d7d76](https://github.com/ljquan/aitu/commit/62d7d76))
- docs: 添加openspec ([663998f](https://github.com/ljquan/aitu/commit/663998f))
- docs(009-media-library): 添加媒体库功能规划文档 ([9c6c35a](https://github.com/ljquan/aitu/commit/9c6c35a))
- refactor(analytics): 将 Umami 分析替换为 PostHog ([c0b7069](https://github.com/ljquan/aitu/commit/c0b7069))

### ❤️  Thank You

- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liquidliang <ljquan@qq.com>

## 0.2.14 (2025-12-10)

### 🚀 Features

- 优化工具栏和AI生成功能 ([51e6f5c](https://github.com/ljquan/aitu/commit/51e6f5c))
- 优化项目抽屉UI和图标设计 ([615f4f6](https://github.com/ljquan/aitu/commit/615f4f6))
- workspace项目管理系统及首次访问默认数据 ([a6d6a84](https://github.com/ljquan/aitu/commit/a6d6a84))

### 🩹 Fixes

- 修复视频模型切换参数同步问题 ([53a653e](https://github.com/ljquan/aitu/commit/53a653e))

### 🔧 Chores

- refactor(analytics): 将 Umami 分析替换为 PostHog ([c0b7069](https://github.com/ljquan/aitu/commit/c0b7069))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.2.13 (2025-12-06)

### 🚀 Features

- 实现智能升级机制,避免中断用户活跃请求 ([484797a](https://github.com/ljquan/aitu/commit/484797a))

### 🔧 Chores

- refactor(dialog): 重构AI生成对话框为任务列表驱动的工作流 ([3612715](https://github.com/ljquan/aitu/commit/3612715))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.2.12 (2025-12-06)

### 🩹 Fixes

- 优化静态资源缓存策略并修复HTML版本问题 ([6550953](https://github.com/ljquan/aitu/commit/6550953))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.2.11 (2025-12-05)

### 🔧 Chores

- 优化升级逻辑 ([d03710d](https://github.com/ljquan/aitu/commit/d03710d))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.2.10 (2025-12-05)

### 🔧 Chores

- 修复bug ([8e055a8](https://github.com/ljquan/aitu/commit/8e055a8))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.2.9 (2025-12-05)

### 🚀 Features

- 统一应用版本管理并添加全局版本变量 ([b57d947](https://github.com/ljquan/aitu/commit/b57d947))
- add declarative tracking specification and task breakdown ([53f18c7](https://github.com/ljquan/aitu/commit/53f18c7))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>

## 0.2.8 (2025-12-05)

### 🚀 Features

- 添加聊天模型选择器组件 ([289857a](https://github.com/ljquan/aitu/commit/289857a))
- 添加文本对话抽屉 ([8ad019e](https://github.com/ljquan/aitu/commit/8ad019e))
- 优化布局 #12 ([28d2ee3](https://github.com/ljquan/aitu/commit/28d2ee3))

### 🩹 Fixes

- 修复WinBox内容挂载导致的DOM节点引用错误 ([22c6c3d](https://github.com/ljquan/aitu/commit/22c6c3d))
- 修复对话抽屉API key检查和弹窗层级问题 ([06cf9d5](https://github.com/ljquan/aitu/commit/06cf9d5))
- 修复统一工具栏与任务按钮位置冲突 ([88f2c4c](https://github.com/ljquan/aitu/commit/88f2c4c))
- 修复视频插入画板后不显示的问题 ([91bdfa4](https://github.com/ljquan/aitu/commit/91bdfa4))
- 优化缓存机制、工具栏交互和AI图片生成功能 ([b606db4](https://github.com/ljquan/aitu/commit/b606db4))

### 🔧 Chores

- bump version to 0.2.7 ([8f926c5](https://github.com/ljquan/aitu/commit/8f926c5))
- bump version to 0.2.6 ([4774a24](https://github.com/ljquan/aitu/commit/4774a24))
- 优化样式 ([d12681d](https://github.com/ljquan/aitu/commit/d12681d))
- 优化颜色 ([b94d6ab](https://github.com/ljquan/aitu/commit/b94d6ab))
- 优化示例 ([964a8a8](https://github.com/ljquan/aitu/commit/964a8a8))
- 优化构建 ([b0d9653](https://github.com/ljquan/aitu/commit/b0d9653))
- 优化build ([152b9ca](https://github.com/ljquan/aitu/commit/152b9ca))
- 添加type ([966ce2e](https://github.com/ljquan/aitu/commit/966ce2e))
- 调整层级 ([57b4a98](https://github.com/ljquan/aitu/commit/57b4a98))
- 布局优化2 ([a8a9faa](https://github.com/ljquan/aitu/commit/a8a9faa))
- 布局优化1 ([ecf8d8d](https://github.com/ljquan/aitu/commit/ecf8d8d))
- 提高超时时间 ([620d5c2](https://github.com/ljquan/aitu/commit/620d5c2))
- 优化上报&弹窗 ([211fc9f](https://github.com/ljquan/aitu/commit/211fc9f))
- docs: 完善项目文档和工具链 ([4dae671](https://github.com/ljquan/aitu/commit/4dae671))
- 添加filesystem兜底 ([622ce19](https://github.com/ljquan/aitu/commit/622ce19))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>

## 0.2.7 (2025-12-04)

### 🚀 Features

- 添加聊天模型选择器组件 ([289857a](https://github.com/ljquan/aitu/commit/289857a))
- 添加文本对话抽屉 ([8ad019e](https://github.com/ljquan/aitu/commit/8ad019e))
- 优化布局 #12 ([28d2ee3](https://github.com/ljquan/aitu/commit/28d2ee3))

### 🩹 Fixes

- 修复对话抽屉API key检查和弹窗层级问题 ([06cf9d5](https://github.com/ljquan/aitu/commit/06cf9d5))
- 修复统一工具栏与任务按钮位置冲突 ([88f2c4c](https://github.com/ljquan/aitu/commit/88f2c4c))
- 修复视频插入画板后不显示的问题 ([91bdfa4](https://github.com/ljquan/aitu/commit/91bdfa4))
- 优化缓存机制、工具栏交互和AI图片生成功能 ([b606db4](https://github.com/ljquan/aitu/commit/b606db4))

### 🔧 Chores

- bump version to 0.2.6 ([4774a24](https://github.com/ljquan/aitu/commit/4774a24))
- 布局优化2 ([a8a9faa](https://github.com/ljquan/aitu/commit/a8a9faa))
- 布局优化1 ([ecf8d8d](https://github.com/ljquan/aitu/commit/ecf8d8d))
- 提高超时时间 ([620d5c2](https://github.com/ljquan/aitu/commit/620d5c2))
- docs: 完善项目文档和工具链 ([4dae671](https://github.com/ljquan/aitu/commit/4dae671))
- 添加filesystem兜底 ([622ce19](https://github.com/ljquan/aitu/commit/622ce19))

### ❤️  Thank You

- gongchengtu <1817063960@qq.com>
- liquidliang <ljquan@qq.com>
- liquid <ljquan@qq.com>

## 0.2.6 (2025-12-02)

### 🚀 Features

- 优化布局 #12 ([28d2ee3](https://github.com/ljquan/aitu/commit/28d2ee3))

### 🩹 Fixes

- 修复视频插入画板后不显示的问题 ([91bdfa4](https://github.com/ljquan/aitu/commit/91bdfa4))
- 优化缓存机制、工具栏交互和AI图片生成功能 ([b606db4](https://github.com/ljquan/aitu/commit/b606db4))

### 🔧 Chores

- bump version to 0.2.4 ([bb46198](https://github.com/ljquan/aitu/commit/bb46198))
- 添加filesystem兜底 ([622ce19](https://github.com/ljquan/aitu/commit/622ce19))
- 优化缓存 ([72ca629](https://github.com/ljquan/aitu/commit/72ca629))

### ❤️  Thank You

- liquidliang <ljquan@qq.com>
- gongchengtu <1817063960@qq.com>
- liquid <ljquan@qq.com>

## 0.2.4 (2025-11-30)

### 🔧 Chores

- 优化缓存 ([72ca629](https://github.com/ljquan/aitu/commit/72ca629))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.2.3 (2025-11-30)

### 🔧 Chores

- 添加图片加载的重试组件 ([f365f84](https://github.com/ljquan/aitu/commit/f365f84))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.2.2 (2025-11-30)

### 🔧 Chores

- choice: 优化changelog ([9b47e75](https://github.com/ljquan/aitu/commit/9b47e75))
- 优化缓存和版本管理 ([cde96d4](https://github.com/ljquan/aitu/commit/cde96d4))

### ❤️  Thank You

- liquid <ljquan@qq.com>

## 0.2.1 (2025-08-06)


### 🩹 Fixes

- **hotkey:** assign t as hotkey to create text element ([#192](https://github.com/plait-board/drawnix/pull/192))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.2.0 (2025-08-06)

This was a version bump only, there were no code changes.

## 0.1.4 (2025-08-06)

This was a version bump only, there were no code changes.

## 0.1.3 (2025-08-06)


### 🩹 Fixes

- **hotkey:** prevent hotkey when  type normally ([#189](https://github.com/plait-board/drawnix/pull/189))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.1.2 (2025-08-06)


### 🚀 Features

- **creation:** support creation mode hotkey #183 ([#185](https://github.com/plait-board/drawnix/pull/185), [#183](https://github.com/plait-board/drawnix/issues/183))
- **mind:** bump plait into 0.82.0 to improve the experience of mind ([f904594](https://github.com/plait-board/drawnix/commit/f904594))
- **viewer:** support image which in mind node view #125 ([#125](https://github.com/plait-board/drawnix/issues/125))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.1.1 (2025-07-10)


### 🩹 Fixes

- **text:** resolve text can not auto break line #173 #169 ([#173](https://github.com/plait-board/drawnix/issues/173), [#169](https://github.com/plait-board/drawnix/issues/169))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.1.0 (2025-07-02)


### 🚀 Features

- import styles ([ecfe3cd](https://github.com/plait-board/drawnix/commit/ecfe3cd))
- add script and update ci ([147c028](https://github.com/plait-board/drawnix/commit/147c028))
- bump plait into 0.62.0-next.7 ([7ab4003](https://github.com/plait-board/drawnix/commit/7ab4003))
- add main menu ([#14](https://github.com/plait-board/drawnix/pull/14))
- improve active-toolbar ([fd19725](https://github.com/plait-board/drawnix/commit/fd19725))
- rename active-toolbar to popup-toolbar and modify tool-button ([aa06c7e](https://github.com/plait-board/drawnix/commit/aa06c7e))
- support opacity for  color property ([#16](https://github.com/plait-board/drawnix/pull/16))
- support local storage ([9c0e652](https://github.com/plait-board/drawnix/commit/9c0e652))
- add product_showcase bump plait into 0.69.0 ([61fe571](https://github.com/plait-board/drawnix/commit/61fe571))
- add sitemap ([3b9d9a3](https://github.com/plait-board/drawnix/commit/3b9d9a3))
- improve pinch zoom ([#77](https://github.com/plait-board/drawnix/pull/77))
- bump plait into 0.76.0 and handle break changes ([#90](https://github.com/plait-board/drawnix/pull/90))
- improve README ([9e0190d](https://github.com/plait-board/drawnix/commit/9e0190d))
- add dependencies for packages ([6d89b32](https://github.com/plait-board/drawnix/commit/6d89b32))
- init dialog and mermaid-to-dialog ([6ff70b9](https://github.com/plait-board/drawnix/commit/6ff70b9))
- support save as json from hotkey ([120dffa](https://github.com/plait-board/drawnix/commit/120dffa))
- support sub menu and export jpg ([#132](https://github.com/plait-board/drawnix/pull/132))
- improve link popup state ([#147](https://github.com/plait-board/drawnix/pull/147))
- improve seo ([#148](https://github.com/plait-board/drawnix/pull/148))
- **active-toolbar:** add active toolbar ([7e737a2](https://github.com/plait-board/drawnix/commit/7e737a2))
- **active-toolbar:** support font color property ([4b2d964](https://github.com/plait-board/drawnix/commit/4b2d964))
- **app:** use localforage to storage main board content #122 ([#122](https://github.com/plait-board/drawnix/issues/122))
- **app-toolbar:** support undo/redo operation ([50f8831](https://github.com/plait-board/drawnix/commit/50f8831))
- **app-toolbar:** add trash and duplicate in app-toolbar ([#28](https://github.com/plait-board/drawnix/pull/28))
- **clean-board:** complete clean board ([#124](https://github.com/plait-board/drawnix/pull/124))
- **clean-confirm:** autoFocus ok button ([582172a](https://github.com/plait-board/drawnix/commit/582172a))
- **color-picker:** support merge operations for update opacity #4 ([#45](https://github.com/plait-board/drawnix/pull/45), [#4](https://github.com/plait-board/drawnix/issues/4))
- **component:** improve the onXXXChange feature for drawnix component #79 ([#79](https://github.com/plait-board/drawnix/issues/79))
- **component:** add afterInit to expose board instance ([23d91dc](https://github.com/plait-board/drawnix/commit/23d91dc))
- **component:** support update value from drawnix component outside ([#103](https://github.com/plait-board/drawnix/pull/103))
- **component:** fit viewport after children updated ([#104](https://github.com/plait-board/drawnix/pull/104))
- **creation-toolbar:** support long-press triggers drag selection an… ([#78](https://github.com/plait-board/drawnix/pull/78))
- **creation-toolbar:** remove default action when click shape and arrow icon in creation toolbar improve tool-button ([a46c2df](https://github.com/plait-board/drawnix/commit/a46c2df))
- **draw:** bump plait into 0.75.0-next.0 and support fine-grained selection ([#69](https://github.com/plait-board/drawnix/pull/69))
- **draw-toolbar:** add draw toolbar ([#9](https://github.com/plait-board/drawnix/pull/9))
- **draw-toolbar:** add shape and arrow panel for draw-toolbar #10 ([#12](https://github.com/plait-board/drawnix/pull/12), [#10](https://github.com/plait-board/drawnix/issues/10))
- **drawnix:** init drawnix package ([397d865](https://github.com/plait-board/drawnix/commit/397d865))
- **drawnix:** export utils ([#105](https://github.com/plait-board/drawnix/pull/105))
- **drawnix-board:** initialize drawnix board ([117e5a8](https://github.com/plait-board/drawnix/commit/117e5a8))
- **fill:** split fill color and fill opacity setting ([#53](https://github.com/plait-board/drawnix/pull/53))
- **flowchart:** add terminal shape element ([#80](https://github.com/plait-board/drawnix/pull/80))
- **freehand:** initialize freehand #2 ([#2](https://github.com/plait-board/drawnix/issues/2))
- **freehand:** apply gaussianSmooth to freehand curve ([#47](https://github.com/plait-board/drawnix/pull/47))
- **freehand:** update stroke width to 2 and optimize freehand end points ([#50](https://github.com/plait-board/drawnix/pull/50))
- **freehand:** improve freehand experience ([#51](https://github.com/plait-board/drawnix/pull/51))
- **freehand:** add FreehandSmoother to optimize freehand curve ([#62](https://github.com/plait-board/drawnix/pull/62))
- **freehand:** optimize freehand curve by stylus features ([#63](https://github.com/plait-board/drawnix/pull/63))
- **freehand:** freehand support theme ([b7c7965](https://github.com/plait-board/drawnix/commit/b7c7965))
- **freehand:** support closed freehand and add popup for freehand ([#68](https://github.com/plait-board/drawnix/pull/68))
- **freehand:** bump plait into 0.75.0-next.9 and resolve freehand unexpected resize-handle after moving freehand elements ([#84](https://github.com/plait-board/drawnix/pull/84))
- **hotkey:** support export png hotkey ([#30](https://github.com/plait-board/drawnix/pull/30))
- **image:** support free image element and support insert image at m… ([#95](https://github.com/plait-board/drawnix/pull/95))
- **image:** should hide popup toolbar when selected element include image ([#96](https://github.com/plait-board/drawnix/pull/96))
- **image:** support drag image to board to add image as draw element or mind node image ([#144](https://github.com/plait-board/drawnix/pull/144))
- **link:** improve link popup ([eba06e2](https://github.com/plait-board/drawnix/commit/eba06e2))
- **markdown-to-drawnix:** support markdown to drawnix mind map #134 ([#135](https://github.com/plait-board/drawnix/pull/135), [#134](https://github.com/plait-board/drawnix/issues/134))
- **menu:** support export to json file ([d0d6ca5](https://github.com/plait-board/drawnix/commit/d0d6ca5))
- **menu:** support load file action ([758aa6d](https://github.com/plait-board/drawnix/commit/758aa6d))
- **mermaid:** improve mermaid-to-drawnix ([a928ba1](https://github.com/plait-board/drawnix/commit/a928ba1))
- **mobile:** adapt mobile device ([7c0742f](https://github.com/plait-board/drawnix/commit/7c0742f))
- **pencil-mode:** add pencil mode and add drawnix context ([#76](https://github.com/plait-board/drawnix/pull/76))
- **pinch-zoom:** support pinch zoom for touch device ([#60](https://github.com/plait-board/drawnix/pull/60))
- **pinch-zoom:** improve pinch zoom functionality and support hand moving ([#75](https://github.com/plait-board/drawnix/pull/75))
- **popover:** add reusable popover and replace radix popover ([d30388a](https://github.com/plait-board/drawnix/commit/d30388a))
- **popup:** display icon when color is complete opacity ([#42](https://github.com/plait-board/drawnix/pull/42))
- **popup-toolbar:** support set branch color remove color property when select transparent #17 ([#17](https://github.com/plait-board/drawnix/issues/17))
- **popup-toolbar:** bump plait into 0.71.0 and mind node link stroke and node stroke support dashed/dotted style #22 ([#22](https://github.com/plait-board/drawnix/issues/22))
- **property:** support stroke style setting ([463c92a](https://github.com/plait-board/drawnix/commit/463c92a))
- **size-slider:** improve size-slider component ([780be9d](https://github.com/plait-board/drawnix/commit/780be9d))
- **text:** support soft break ([#39](https://github.com/plait-board/drawnix/pull/39))
- **text:** support update text from outside ([#58](https://github.com/plait-board/drawnix/pull/58))
- **text:** support insertSoftBreak for text #136 ([#136](https://github.com/plait-board/drawnix/issues/136))
- **theme-toolbar:** add theme selection toolbar for customizable themes ([dca0e33](https://github.com/plait-board/drawnix/commit/dca0e33))
- **toolbar:** support zoom toolbar ([76ef5d9](https://github.com/plait-board/drawnix/commit/76ef5d9))
- **web:** seo ([84cde4b](https://github.com/plait-board/drawnix/commit/84cde4b))
- **web:** add cloud.umami.is to track views ([#64](https://github.com/plait-board/drawnix/pull/64))
- **web:** modify initialize-data for adding freehand data ([#65](https://github.com/plait-board/drawnix/pull/65))
- **web:** add debug console ([#83](https://github.com/plait-board/drawnix/pull/83))
- **wrapper:** add wrapper component and context hook ([#6](https://github.com/plait-board/drawnix/pull/6))
- **zoom-toolbar:** support zoom menu ([cc6a6b8](https://github.com/plait-board/drawnix/commit/cc6a6b8))

### 🩹 Fixes

- remove theme-toolbar font-weight style ([#67](https://github.com/plait-board/drawnix/pull/67))
- revert package lock ([1aa9d42](https://github.com/plait-board/drawnix/commit/1aa9d42))
- fix pub issue ([156abcb](https://github.com/plait-board/drawnix/commit/156abcb))
- improve libs build ([9ddb6d9](https://github.com/plait-board/drawnix/commit/9ddb6d9))
- **app-toolbar:** correct app-toolbar style ([#106](https://github.com/plait-board/drawnix/pull/106))
- **arrow-line:** optimize the popup toolbar position when selected element is arrow line ([#70](https://github.com/plait-board/drawnix/pull/70))
- **board:** resolve mobile scrolling issue when resize or moving ([8fdca8e](https://github.com/plait-board/drawnix/commit/8fdca8e))
- **board:** bump plait into 0.69.1 deselect when text editing end refactor popup toolbar placement ([aef6d23](https://github.com/plait-board/drawnix/commit/aef6d23))
- **board:** use updateViewBox to fix board wobbles when dragging or resizing ([#94](https://github.com/plait-board/drawnix/pull/94))
- **color-picker:** support display 0 opacity ([#48](https://github.com/plait-board/drawnix/pull/48))
- **core:** bump plait into 0.79.1 to fix with-hand issue when press space key #141 ([#149](https://github.com/plait-board/drawnix/pull/149), [#141](https://github.com/plait-board/drawnix/issues/141))
- **creation-toolbar:** use pointerUp set basic pointer cause onChange do not fire on mobile bind pointermove/pointerup to viewportContainerRef to implement dnd on mobile #20 ([#20](https://github.com/plait-board/drawnix/issues/20))
- **creation-toolbar:** move out toolbar from board to avoid fired pointer down event when operating ([ddb6092](https://github.com/plait-board/drawnix/commit/ddb6092))
- **font-color:** fix color can not be assigned when current color is empty ([#55](https://github.com/plait-board/drawnix/pull/55))
- **freehand:** fix freehand creation issue(caused by throttleRAF) ([#40](https://github.com/plait-board/drawnix/pull/40))
- **mermaid:** bump mermaid-to-drawnix to 0.0.2 to fix text display issue ([33878d0](https://github.com/plait-board/drawnix/commit/33878d0))
- **mermaid-to-drawnix:** support group for insertToBoard ([e2f5056](https://github.com/plait-board/drawnix/commit/e2f5056))
- **mind:** remove branchColor property setting ([#46](https://github.com/plait-board/drawnix/pull/46))
- **property:** prevent set fill color opacity when color is none ([#56](https://github.com/plait-board/drawnix/pull/56))
- **react-board:** resolve text should not display in safari ([19fc20f](https://github.com/plait-board/drawnix/commit/19fc20f))
- **react-board:** support fit viewport after browser window resized ([96f4a0e](https://github.com/plait-board/drawnix/commit/96f4a0e))
- **size-slider:** correct size slider click handle can not fire ([#57](https://github.com/plait-board/drawnix/pull/57))
- **text:** fix composition input and abc input trembly issue ([#15](https://github.com/plait-board/drawnix/pull/15))
- **text:** resolve with-text build error ([#41](https://github.com/plait-board/drawnix/pull/41))
- **text:** fix text can not editing ([#52](https://github.com/plait-board/drawnix/pull/52))
- **text:** fix text can not display correctly on windows 10 chrome env #99 ([#100](https://github.com/plait-board/drawnix/pull/100), [#99](https://github.com/plait-board/drawnix/issues/99))
- **text:** allow scroll to show all text ([#156](https://github.com/plait-board/drawnix/pull/156))
- **text:** set whiteSpace: pre to avoid \n is ineffectual ([#165](https://github.com/plait-board/drawnix/pull/165))
- **use-board-event:** fix board event timing ([0d4a8f1](https://github.com/plait-board/drawnix/commit/0d4a8f1))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.0.4 (2025-04-15)


### 🚀 Features

- ci: a tiny docker image (#127) ([#122](https://github.com/plait-board/drawnix/pull/127))
- support save as json from hotkey ([120dffa](https://github.com/plait-board/drawnix/commit/120dffa))
- **app:** use localforage to storage main board content #122 ([#122](https://github.com/plait-board/drawnix/issues/122))
- **clean-board:** complete clean board ([#124](https://github.com/plait-board/drawnix/pull/124))

### 🩹 Fixes

- **react-board:** support fit viewport after browser window resized ([96f4a0e](https://github.com/plait-board/drawnix/commit/96f4a0e))

### ❤️  Thank You

- lurenyang418 @lurenyang418
- whyour @whyour
- pubuzhixing8 @pubuzhixing8

## 0.0.4-3 (2025-03-25)


### 🩹 Fixes

- improve libs build ([9ddb6d9](https://github.com/plait-board/drawnix/commit/9ddb6d9))
- **mermaid:** bump mermaid-to-drawnix to 0.0.2 to fix text display issue ([33878d0](https://github.com/plait-board/drawnix/commit/33878d0))

### ❤️  Thank You

- pubuzhixing8

## 0.0.4-2 (2025-03-19)


### 🚀 Features

- init dialog and mermaid-to-dialog ([6ff70b9](https://github.com/plait-board/drawnix/commit/6ff70b9))
- **mermaid:** improve mermaid-to-drawnix ([a928ba1](https://github.com/plait-board/drawnix/commit/a928ba1))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.0.4-1 (2025-03-16)

This was a version bump only, there were no code changes.

## 0.0.4-0 (2025-03-16)


### 🚀 Features

- add dependencies for packages ([6d89b32](https://github.com/plait-board/drawnix/commit/6d89b32))
- **component:** support update value from drawnix component outside ([#103](https://github.com/plait-board/drawnix/pull/103))
- **component:** fit viewport after children updated ([#104](https://github.com/plait-board/drawnix/pull/104))
- **drawnix:** export utils ([#105](https://github.com/plait-board/drawnix/pull/105))

### 🩹 Fixes

- **app-toolbar:** correct app-toolbar style ([#106](https://github.com/plait-board/drawnix/pull/106))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.0.3 (2025-03-14)


### 🩹 Fixes

- revert package lock ([1aa9d42](https://github.com/plait-board/drawnix/commit/1aa9d42))
- fix pub issue ([156abcb](https://github.com/plait-board/drawnix/commit/156abcb))
- **text:** fix text can not display correctly on windows 10 chrome env #99 ([#100](https://github.com/plait-board/drawnix/pull/100), [#99](https://github.com/plait-board/drawnix/issues/99))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.0.2 (2025-03-10)


### 🚀 Features

- improve README ([9e0190d](https://github.com/plait-board/drawnix/commit/9e0190d))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8

## 0.0.1 (2025-03-10)


### 🚀 Features

- import styles ([ecfe3cd](https://github.com/plait-board/drawnix/commit/ecfe3cd))
- add script and update ci ([147c028](https://github.com/plait-board/drawnix/commit/147c028))
- bump plait into 0.62.0-next.7 ([7ab4003](https://github.com/plait-board/drawnix/commit/7ab4003))
- add main menu ([#14](https://github.com/plait-board/drawnix/pull/14))
- improve active-toolbar ([fd19725](https://github.com/plait-board/drawnix/commit/fd19725))
- rename active-toolbar to popup-toolbar and modify tool-button ([aa06c7e](https://github.com/plait-board/drawnix/commit/aa06c7e))
- support opacity for  color property ([#16](https://github.com/plait-board/drawnix/pull/16))
- support local storage ([9c0e652](https://github.com/plait-board/drawnix/commit/9c0e652))
- add product_showcase bump plait into 0.69.0 ([61fe571](https://github.com/plait-board/drawnix/commit/61fe571))
- add sitemap ([3b9d9a3](https://github.com/plait-board/drawnix/commit/3b9d9a3))
- improve pinch zoom ([#77](https://github.com/plait-board/drawnix/pull/77))
- bump plait into 0.76.0 and handle break changes ([#90](https://github.com/plait-board/drawnix/pull/90))
- **active-toolbar:** add active toolbar ([7e737a2](https://github.com/plait-board/drawnix/commit/7e737a2))
- **active-toolbar:** support font color property ([4b2d964](https://github.com/plait-board/drawnix/commit/4b2d964))
- **app-toolbar:** support undo/redo operation ([50f8831](https://github.com/plait-board/drawnix/commit/50f8831))
- **app-toolbar:** add trash and duplicate in app-toolbar ([#28](https://github.com/plait-board/drawnix/pull/28))
- **color-picker:** support merge operations for update opacity #4 ([#45](https://github.com/plait-board/drawnix/pull/45), [#4](https://github.com/plait-board/drawnix/issues/4))
- **component:** improve the onXXXChange feature for drawnix component #79 ([#79](https://github.com/plait-board/drawnix/issues/79))
- **component:** add afterInit to expose board instance ([23d91dc](https://github.com/plait-board/drawnix/commit/23d91dc))
- **creation-toolbar:** support long-press triggers drag selection an… ([#78](https://github.com/plait-board/drawnix/pull/78))
- **draw:** bump plait into 0.75.0-next.0 and support fine-grained selection ([#69](https://github.com/plait-board/drawnix/pull/69))
- **draw-toolbar:** add draw toolbar ([#9](https://github.com/plait-board/drawnix/pull/9))
- **draw-toolbar:** add shape and arrow panel for draw-toolbar #10 ([#12](https://github.com/plait-board/drawnix/pull/12), [#10](https://github.com/plait-board/drawnix/issues/10))
- **drawnix:** init drawnix package ([397d865](https://github.com/plait-board/drawnix/commit/397d865))
- **drawnix-board:** initialize drawnix board ([117e5a8](https://github.com/plait-board/drawnix/commit/117e5a8))
- **fill:** split fill color and fill opacity setting ([#53](https://github.com/plait-board/drawnix/pull/53))
- **flowchart:** add terminal shape element ([#80](https://github.com/plait-board/drawnix/pull/80))
- **freehand:** initialize freehand #2 ([#2](https://github.com/plait-board/drawnix/issues/2))
- **freehand:** apply gaussianSmooth to freehand curve ([#47](https://github.com/plait-board/drawnix/pull/47))
- **freehand:** update stroke width to 2 and optimize freehand end points ([#50](https://github.com/plait-board/drawnix/pull/50))
- **freehand:** improve freehand experience ([#51](https://github.com/plait-board/drawnix/pull/51))
- **freehand:** add FreehandSmoother to optimize freehand curve ([#62](https://github.com/plait-board/drawnix/pull/62))
- **freehand:** optimize freehand curve by stylus features ([#63](https://github.com/plait-board/drawnix/pull/63))
- **freehand:** freehand support theme ([b7c7965](https://github.com/plait-board/drawnix/commit/b7c7965))
- **freehand:** support closed freehand and add popup for freehand ([#68](https://github.com/plait-board/drawnix/pull/68))
- **freehand:** bump plait into 0.75.0-next.9 and resolve freehand unexpected resize-handle after moving freehand elements ([#84](https://github.com/plait-board/drawnix/pull/84))
- **hotkey:** support export png hotkey ([#30](https://github.com/plait-board/drawnix/pull/30))
- **image:** support free image element and support insert image at m… ([#95](https://github.com/plait-board/drawnix/pull/95))
- **image:** should hide popup toolbar when selected element include image ([#96](https://github.com/plait-board/drawnix/pull/96))
- **menu:** support export to json file ([d0d6ca5](https://github.com/plait-board/drawnix/commit/d0d6ca5))
- **menu:** support load file action ([758aa6d](https://github.com/plait-board/drawnix/commit/758aa6d))
- **mobile:** adapt mobile device ([7c0742f](https://github.com/plait-board/drawnix/commit/7c0742f))
- **pencil-mode:** add pencil mode and add drawnix context ([#76](https://github.com/plait-board/drawnix/pull/76))
- **pinch-zoom:** support pinch zoom for touch device ([#60](https://github.com/plait-board/drawnix/pull/60))
- **pinch-zoom:** improve pinch zoom functionality and support hand moving ([#75](https://github.com/plait-board/drawnix/pull/75))
- **popover:** add reusable popover and replace radix popover ([d30388a](https://github.com/plait-board/drawnix/commit/d30388a))
- **popup:** display icon when color is complete opacity ([#42](https://github.com/plait-board/drawnix/pull/42))
- **popup-toolbar:** support set branch color remove color property when select transparent #17 ([#17](https://github.com/plait-board/drawnix/issues/17))
- **popup-toolbar:** bump plait into 0.71.0 and mind node link stroke and node stroke support dashed/dotted style #22 ([#22](https://github.com/plait-board/drawnix/issues/22))
- **property:** support stroke style setting ([463c92a](https://github.com/plait-board/drawnix/commit/463c92a))
- **size-slider:** improve size-slider component ([780be9d](https://github.com/plait-board/drawnix/commit/780be9d))
- **text:** support soft break ([#39](https://github.com/plait-board/drawnix/pull/39))
- **text:** support update text from outside ([#58](https://github.com/plait-board/drawnix/pull/58))
- **theme-toolbar:** add theme selection toolbar for customizable themes ([dca0e33](https://github.com/plait-board/drawnix/commit/dca0e33))
- **toolbar:** support zoom toolbar ([76ef5d9](https://github.com/plait-board/drawnix/commit/76ef5d9))
- **web:** seo ([84cde4b](https://github.com/plait-board/drawnix/commit/84cde4b))
- **web:** add cloud.umami.is to track views ([#64](https://github.com/plait-board/drawnix/pull/64))
- **web:** modify initialize-data for adding freehand data ([#65](https://github.com/plait-board/drawnix/pull/65))
- **web:** add debug console ([#83](https://github.com/plait-board/drawnix/pull/83))
- **wrapper:** add wrapper component and context hook ([#6](https://github.com/plait-board/drawnix/pull/6))
- **zoom-toolbar:** support zoom menu ([cc6a6b8](https://github.com/plait-board/drawnix/commit/cc6a6b8))

### 🩹 Fixes

- remove theme-toolbar font-weight style ([#67](https://github.com/plait-board/drawnix/pull/67))
- **arrow-line:** optimize the popup toolbar position when selected element is arrow line ([#70](https://github.com/plait-board/drawnix/pull/70))
- **board:** resolve mobile scrolling issue when resize or moving ([8fdca8e](https://github.com/plait-board/drawnix/commit/8fdca8e))
- **board:** bump plait into 0.69.1 deselect when text editing end refactor popup toolbar placement ([aef6d23](https://github.com/plait-board/drawnix/commit/aef6d23))
- **board:** use updateViewBox to fix board wobbles when dragging or resizing ([#94](https://github.com/plait-board/drawnix/pull/94))
- **color-picker:** support display 0 opacity ([#48](https://github.com/plait-board/drawnix/pull/48))
- **creation-toolbar:** use pointerUp set basic pointer cause onChange do not fire on mobile bind pointermove/pointerup to viewportContainerRef to implement dnd on mobile #20 ([#20](https://github.com/plait-board/drawnix/issues/20))
- **creation-toolbar:** move out toolbar from board to avoid fired pointer down event when operating ([ddb6092](https://github.com/plait-board/drawnix/commit/ddb6092))
- **font-color:** fix color can not be assigned when current color is empty ([#55](https://github.com/plait-board/drawnix/pull/55))
- **freehand:** fix freehand creation issue(caused by throttleRAF) ([#40](https://github.com/plait-board/drawnix/pull/40))
- **mind:** remove branchColor property setting ([#46](https://github.com/plait-board/drawnix/pull/46))
- **property:** prevent set fill color opacity when color is none ([#56](https://github.com/plait-board/drawnix/pull/56))
- **react-board:** resolve text should not display in safari ([19fc20f](https://github.com/plait-board/drawnix/commit/19fc20f))
- **size-slider:** correct size slider click handle can not fire ([#57](https://github.com/plait-board/drawnix/pull/57))
- **text:** fix composition input and abc input trembly issue ([#15](https://github.com/plait-board/drawnix/pull/15))
- **text:** resolve with-text build error ([#41](https://github.com/plait-board/drawnix/pull/41))
- **text:** fix text can not editing ([#52](https://github.com/plait-board/drawnix/pull/52))
- **use-board-event:** fix board event timing ([0d4a8f1](https://github.com/plait-board/drawnix/commit/0d4a8f1))

### ❤️  Thank You

- pubuzhixing8 @pubuzhixing8