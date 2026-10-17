# 托管免费试运行实施记录

更新时间：2026-09-06。负责人已授权采用推荐方案，不再等待架构二选一。

## 选定方向

- API 与静态应用：Vercel，运行 Node 22。
- 数据库：Neon PostgreSQL，独立迁移与应用权限，强制 TLS。
- 首期计费：仅明确配置为 free 的文本/图片模型，不操作用户余额。上游成本由平台承担。
- 媒体存储：后续 B2 使用私有 S3 兼容存储，推荐 Cloudflare R2；当前未实现或配置。
- 长任务：后续接托管持久任务编排，不能把视频/音频执行循环放在 Vercel 请求生命周期内。当前尚未实现，不将维护 Cron 冒充持久任务执行器。

## 本批已实施

公开任务默认关闭：只有 `OPENTU_PUBLIC_GENERATION_ENABLED=true` 才可提交。关闭时目录返回空列表，已有任务仍可读取和取消。开关不是前端迁移开关，不能阻止旧版浏览器直连供应商，不能据此宣称所有生成流量已经受服务器管理。

目录和路由仅开放免费文本、研究文本和图片模型。管理员 canary 不能绕过未配置或 external 计费。旧 queued 任务执行前重新查询已发布、健康、网关启用、免费的原模型绑定，防止恢复已撤销的能力。

任务准入在一个数据库事务中持有全局 advisory lock，原子检查额度和插入。同一用户、同一幂等键重复请求先返回已有任务，不消耗第二份任务准入。锁仅覆盖数据库准入，不覆盖供应商网络请求；对于初期低并发合适，未来扩量后需要重新评估锁等待。

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| OPENTU_GENERATION_GLOBAL_CONCURRENCY | 4 | 全站活跃任务上限 |
| OPENTU_GENERATION_PROVIDER_CONCURRENCY | 2 | 单供应商活跃任务上限 |
| OPENTU_GENERATION_USER_CONCURRENCY | 1 | 单用户活跃任务上限 |
| OPENTU_GENERATION_GLOBAL_DAILY_LIMIT | 100 | 全站每日创建任务数上限 |
| OPENTU_GENERATION_USER_DAILY_LIMIT | 10 | 单用户每日创建任务数上限 |

活跃状态包括 queued、submitting、running、cancel_requested，管理员也受这些限制。每日按 UTC 00:00 重置，失败和取消不退还创建额度。这是任务数量控制，不是货币预算；不同模型单价不同，正式开放前还必须配置供应商侧硬预算与允许调用的具体模型。降低限额不会终止已运行任务。

文本默认且最大输出 2048 tokens；图片默认单张 1024x1024、low，可选择 standard。超过首期输入输出上限直接拒绝，不静默降质；参考文件/内联图、视频及音频拒绝。现有高质量和非方形图片前端参数需要迁移适配，尚未完成。

`/api/internal/generation-maintenance` 验证 `Authorization: Bearer <CRON_SECRET>`，密钥至少 32 字符。每次最多处理 100 个过期提交或超过 15 分钟的排队任务，并清理最多 1000 条超过两天的分钟限流记录。不会重新请求供应商或删除用户任务。中断提交标为 UPSTREAM_OUTCOME_UNKNOWN，保留人工核对责任。它会释放本地容量，上游未知任务可能仍在执行，因此不构成上游实际并发/费用的硬保证。

Vercel 配置每 5 分钟调度维护接口，生成函数最长 90 秒，维护函数 30 秒。部署套餐必须支持该 Cron 频率与函数时长，通常需要付费套餐；未验证实际账号配额。CRON_SECRET 缺失时返回 503，调度会失败，不能宣称恢复服务已运行。

## 上线步骤与依赖

1. 在 Vercel 配置域名、Neon 连接、供应商加密密钥、Cron 密钥与真实账号会话接口。参考根目录 `.env.example`。所有密钥只设在服务器环境，VITE_* 仅可包含公开配置。
2. 在受控部署环境运行 `pnpm check:production-config`。该命令只检查格式，不联网、不验证账号权限；CI 只运行合成凭据测试，不读取生产密钥。
3. 备份数据库，在测试库运行 `pnpm db:migrate`。新迁移标记是 `20260906-free-launch-v2`，新增 created_at 索引支持额度查询。验证后再安排生产迁移；运行账号需要业务表 DML 和迁移版本读取权限。
4. 保持公开生成开关 false，验证身份链路、用户归属、数据库并发事务、取消/断网、Cron 鉴权和上游任务核对流程。
5. 完成下列剩余门禁后，再显式开启开关。不能以合成测试通过替代真实环境验收。

## 尚未完成的发布门禁

- 浏览器作品、缓存和任务的账户隔离，以及匿名历史数据的明确归属迁移。
- 文本/图片前端完全接入服务端任务、取消和刷新恢复；尚不支持的旧直连路径在托管生产中关闭。
- 私有对象存储上传/结果归档，以及托管持久任务编排与真实供应商异步协议。
- Web Lint 的循环依赖、首屏 ai-chat 体积门禁和剩余 image-size 等依赖告警。
- 生产域名、Vercel/Neon/R2 账号权限、付费套餐、供应商硬预算和真实会话接口联调。
- 数据库并发与迁移集成测试、跨用户访问、备份恢复、负载测试、告警与运维验收。

本批验证：API 15 个套件共 89 项测试通过；API TypeScript 与 ESLint 通过；生产配置脚本 3 项测试通过；画布安全/依赖回归 8 项通过。数据库测试使用模拟接口，不宣称已验证真实 PostgreSQL 并发锁。此前 Web 33 项、Vite 应用及 SW 构建通过，但整套发布门禁仍未通过。OpenSpec CLI 本机未安装，尝试验证未能执行。
## Frontend gateway switch

Set `VITE_OPENTU_MANAGED_GENERATION=true` in the production build. In this mode image generation uses `/api/generation/tasks`, browser provider API keys are not used, and task cancellation is sent to the server. Keep it `false` only for local development with explicitly configured browser adapters.
