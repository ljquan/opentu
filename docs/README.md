# Opentu 开发文档

本目录只保留当前仍有维护价值的开发文档。产品介绍、安装和常用命令见 [项目 README](../README.md)。

## 必读入口

- [编码规则](./CODING_RULES.md)：项目级经验、踩坑记录和高风险改动规则。
- [编码标准](./CODING_STANDARDS.md)：TypeScript、React、样式与测试约定。
- [功能流](./FEATURE_FLOWS.md)：核心用户路径和主要功能流转。
- [概念说明](./CONCEPTS.md)：领域概念与画布工作区说明。
- [Service Worker 架构](./SW_ARCHITECTURE.md)：SW、缓存、后台任务与调试入口。

## 部署与发布

- [版本控制](./VERSION_CONTROL.md)：版本号、发布流程和缓存策略。
- [版本更新策略](./VERSION_UPDATE_STRATEGY.md)：版本文件、changelog 与发布验证。
- [Cloudflare Pages 部署](./CFPAGE-DEPLOY.md)：静态托管配置。
- [CDN 方案下线经验](./CDN_TO_SELF_HOSTED_LESSONS.md)：为什么放弃 jsDelivr/npm 发布，全量转自建服务器直发。

## UI 与品牌

- [品牌规范](./BRAND_GUIDELINES.md)：Logo、色彩和品牌用法。
- [品牌设计](./BRAND_DESIGN.md)：品牌方向与设计方案。
- [UI 配色系统与素材库状态架构经验](./UI_COLOR_SYSTEM_LESSONS.md)：全局 token、选中态、多选入口收敛和 AI 编程约束。
- [PWA 图标](./PWA_ICONS.md)：图标生成和 manifest 相关配置。
- [Z-Index 指南](./Z_INDEX_GUIDE.md)：弹层层级和遮挡问题处理。
- [TDesign 主题接入](./TDESIGN_THEME_INTEGRATION.md)：组件主题集成经验。

## 关键能力

- [统一缓存设计](./UNIFIED_CACHE_DESIGN.md)：缓存模型、存储和清理策略。
- [统一缓存实现总结](./UNIFIED_CACHE_IMPLEMENTATION_SUMMARY.md)：落地细节和验证要点。
- [网站数据清理交接文档](./2026-08-04-网站数据清理-交接文档.md)：桌面清理入口、两档清理范围、配置保留、迟到写回防护与失败恢复。
- [素材库插入经验](./MEDIA_LIBRARY_INSERTION_LESSONS.md)：素材插入、选择和画布联动。
- [素材库渲染性能经验](./MEDIA_LIBRARY_RENDER_PERFORMANCE_LESSONS.md)：列表、预览和性能优化。
- [异步任务供应商路由经验](./ASYNC_TASK_PROVIDER_ROUTE_LESSONS.md)：多供应商异步任务提交、恢复查询和路由快照规则。
- [模型分类优先级经验](./MODEL_CATEGORY_PRIORITY_LESSONS.md)：接口 `category`、`image` 词根和 endpoint 的判定顺序。
- [图片请求 ID](./IMAGE_REQUEST_ID_LESSONS.md)：本地任务 UUID 的生成、图片提交透传与回归边界。
- [批量出图预览单张删除经验](./BATCH_IMAGE_GENERATION_PREVIEW_DELETE_LESSONS.md)：单张结果删除、任务解绑、状态重算与画布边界。
- [AI 任务栏关闭跟随生成新图片](./2026-08-03-AI任务栏关闭跟随生成新图片.md)：关闭目标绑定、生成新图片与重新绑定边界。
- [AI 任务栏画布联想引用与平滑连线](./2026-08-12-AI任务栏画布联想引用与平滑连线-交接文档.md)：永久联想开关、任意位置 `@` 拾取、多来源引用、开放视觉数量及任务到结果的持久曲线。
- [PPT 能力规划](./PPT_CAPABILITY_PLAN.md)：PPT 生成、编辑和导出路线。
- [PPT Prompt](./PPT_Prompt.md)：PPT 相关提示词资产。

## 复盘文档

`*_LESSONS.md` 文档用于保留仍会影响实现决策的复盘经验。新增复盘前优先检查是否能合并进现有主题文档，避免继续膨胀。

常用主题：

- AI 生成参数、提示词历史、模型选择和任务队列。
- PPT 生成、媒体导出、Frame 操作和样式一致性。
- Service Worker、CDN、缓存、启动性能和发布稳定性。
- PostHog 埋点、错误追踪、SEO 和观测方法。

## 本地命令

```bash
corepack enable pnpm
pnpm install
pnpm start          # http://localhost:7200
pnpm check
pnpm test
pnpm check:cycles
```
