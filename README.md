<div align="center">
  <h1>Opentu (opentu.ai)</h1>
  <h3>开图 · 以画布为核心的 AI 应用平台</h3>
  <p>连接多模型生成、工具、素材与知识流，让 AI 任务在同一工作区持续执行。</p>
  <p>
    <a href="https://github.com/ljquan/aitu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
    <a href="https://opentu.ai"><img src="https://img.shields.io/badge/demo-online-brightgreen.svg" alt="Demo"></a>
  </p>
  <p>
    <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fljquan%2Faitu&project-name=aitu&repository-name=aitu"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>
    <a href="https://app.netlify.com/start/deploy?repository=https://github.com/ljquan/aitu"><img src="https://www.netlify.com/img/deploy/button.svg" alt="Deploy to Netlify"></a>
  </p>
</div>

[English README](./README_en.md)

<p align="center">
  <a href="https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=opentu">
    <img src="./assets/atlas-cloud-logo.png" alt="Atlas Cloud" width="200">
  </a>
</p>

> 🎁 **[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=opentu)** — Opentu 的 AI 多模型路由核心可无缝接入 Atlas Cloud 统一 Media API，一套接口覆盖图像生成（Flux、DALL-E、Seedream）、视频生成（Seedance、Kling、Sora）及主流 LLM，无需逐一对接各平台，极大简化 Opentu 的模型扩展成本。新用户可免费领取 API Credits 直接试用 — [coding plan](https://www.atlascloud.ai/console/coding-plan)

<details>
<summary>All Atlas Cloud LLM models (59)</summary>

- Anthropic: `anthropic/claude-haiku-4.5-20251001`, `anthropic/claude-opus-4.8`, `anthropic/claude-sonnet-4.6`
- OpenAI: `openai/gpt-5.4`, `openai/gpt-5.5`
- Google Gemini: `google/gemini-3.1-flash-lite`, `google/gemini-3.1-pro-preview`, `google/gemini-3.5-flash`
- Qwen: `qwen/qwen2.5-7b-instruct`, `Qwen/Qwen3-235B-A22B-Instruct-2507`, `qwen/qwen3-235b-a22b-thinking-2507`, `qwen/qwen3-30b-a3b`, `Qwen/Qwen3-30B-A3B-Instruct-2507`, `qwen/qwen3-30b-a3b-thinking-2507`, `qwen/qwen3-32b`, `qwen/qwen3-8b`, `Qwen/Qwen3-Coder`, `qwen/qwen3-coder-next`, `qwen/qwen3-max-2026-01-23`, `Qwen/Qwen3-Next-80B-A3B-Instruct`, `Qwen/Qwen3-Next-80B-A3B-Thinking`, `Qwen/Qwen3-VL-235B-A22B-Instruct`, `qwen/qwen3-vl-235b-a22b-thinking`, `qwen/qwen3-vl-30b-a3b-instruct`, `qwen/qwen3-vl-30b-a3b-thinking`, `qwen/qwen3-vl-8b-instruct`, `qwen/qwen3.5-122b-a10b`, `qwen/qwen3.5-27b`, `qwen/qwen3.5-35b-a3b`, `qwen/qwen3.5-397b-a17b`, `qwen/qwen3.6-35b-a3b`, `qwen/qwen3.6-plus`
- DeepSeek: `deepseek-ai/deepseek-ocr`, `deepseek-ai/deepseek-r1-0528`, `deepseek-ai/DeepSeek-V3-0324`, `deepseek-ai/DeepSeek-V3.1`, `deepseek-ai/DeepSeek-V3.1-Terminus`, `deepseek-ai/deepseek-v3.2`, `deepseek-ai/DeepSeek-V3.2-Exp`, `deepseek-ai/deepseek-v4-flash`, `deepseek-ai/deepseek-v4-pro`
- Kimi: `moonshotai/Kimi-K2-Instruct`, `moonshotai/Kimi-K2-Instruct-0905`, `moonshotai/Kimi-K2-Thinking`, `moonshotai/kimi-k2.5`, `moonshotai/kimi-k2.6`
- GLM: `zai-org/GLM-4.6`, `zai-org/glm-4.7`, `zai-org/glm-5`, `zai-org/glm-5-turbo`, `zai-org/glm-5.1`, `zai-org/glm-5v-turbo`
- MiniMax: `MiniMaxAI/MiniMax-M2`, `minimaxai/minimax-m2.1`, `minimaxai/minimax-m2.5`, `minimaxai/minimax-m2.7`
- xAI: `xai/grok-4.3`
- KAT: `kwaipilot/kat-coder-pro-v2`
- Other: `owl`

</details>

## 在线体验

- 正式站点：[opentu.ai](https://opentu.ai)
- 预览实例：[pr.opentu.ai](https://pr.opentu.ai)

## 产品展示

| 拆分图片 | 流程图 | 思维导图 |
| --- | --- | --- |
| ![](./apps/web/public/product_showcase/九宫格拆图.gif) | ![](./apps/web/public/product_showcase/流程图.gif) | ![](./apps/web/public/product_showcase/思维导图.gif) |
| 语义理解 - 拆分图片 | 语义理解 - 流程图 | 语义理解 - 思维导图 |

## 平台能力

- **AI 生成与模型路由**：统一调度图片、视频、音频、文本与 Agent 流程。
- **画布工作区**：承载 AI 任务、素材、Frame、工具窗口与知识库内容。
- **任务与素材管理**：通过任务队列、素材库、统一缓存和历史记录复用生成结果。
- **工具箱与扩展**：支持内部 React 工具、iframe 工具、Skill/Agent 和插件化运行时。
- **PPT 与内容工作流**：支持 Frame 幻灯片、PPT 导出、Markdown/Mermaid 转换和多媒体编辑。

## 本地开发

### 环境要求

- Node.js 20+
- pnpm 10.21.0（推荐通过 Corepack 启用）

### 安装与启动

```bash
corepack enable pnpm
pnpm install
pnpm start
```

启动后访问 `http://localhost:7200`。

### 常用命令

```bash
pnpm start             # 启动 Web 开发服务
pnpm build:web         # 构建 Web 应用
pnpm build             # 构建工作区
pnpm check             # typecheck + lint
pnpm test              # 运行单元测试
pnpm e2e:smoke         # 运行冒烟测试
pnpm check:cycles      # 检查循环依赖
pnpm manual:build      # 生成用户手册
```

## 部署

项目保留多条部署链路：

- Vercel / Netlify：使用上方一键部署按钮或仓库配置。
- Docker：使用仓库根目录的 `Dockerfile` 构建静态站点镜像。
- Hybrid CDN + 自托管：见 [NPM CDN 部署](./docs/NPM_CDN_DEPLOY.md) 与 [CDN 部署](./docs/CDN_DEPLOYMENT.md)。

## 仓库结构

```text
aitu/
├── apps/
│   ├── web/                 # Opentu Web 应用与 Service Worker
│   └── web-e2e/             # Playwright E2E 与手册生成脚本
├── packages/
│   ├── drawnix/             # 画布工作区核心库
│   ├── react-board/         # Plait React 画布适配层
│   ├── react-text/          # 文本渲染组件
│   └── utils/               # 共享工具与工作流解析
├── docs/                    # 当前开发文档入口
├── openspec/                # 需求规格与变更提案
└── scripts/                 # 构建、发布、手册与部署脚本
```

## 文档入口

- [开发文档索引](./docs/README.md)
- [贡献指南](./CONTRIBUTING.md)
- [OpenSpec 说明](./openspec/AGENTS.md)

## License

MIT
