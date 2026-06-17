<div align="center">
  <h1>Opentu (opentu.ai)</h1>
  <h3>Canvas-first AI Application Platform</h3>
  <p>Connect models, tools, assets, and knowledge flows so AI work keeps running in one workspace.</p>
  <p>
    <a href="https://github.com/ljquan/aitu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
    <a href="https://opentu.ai"><img src="https://img.shields.io/badge/demo-online-brightgreen.svg" alt="Demo"></a>
  </p>
  <p>
    <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fljquan%2Faitu&project-name=aitu&repository-name=aitu"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>
    <a href="https://app.netlify.com/start/deploy?repository=https://github.com/ljquan/aitu"><img src="https://www.netlify.com/img/deploy/button.svg" alt="Deploy to Netlify"></a>
  </p>
</div>

[中文 README](./README.md)

<p align="center">
  <a href="https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=opentu">
    <img src="./assets/atlas-cloud-logo.png" alt="Atlas Cloud" width="200">
  </a>
</p>

> 🎁 **[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=opentu)** — Opentu's multi-model AI routing can integrate seamlessly with Atlas Cloud's unified Media API. One API covers image generation (Flux, DALL-E, Seedream), video generation (Seedance, Kling, Sora), and leading LLMs — eliminating per-platform integrations and dramatically reducing Opentu's model onboarding overhead. New users get free API Credits to start immediately — [coding plan](https://www.atlascloud.ai/console/coding-plan)

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

## Live Apps

- Production: [opentu.ai](https://opentu.ai)
- Preview: [pr.opentu.ai](https://pr.opentu.ai)

## Product Showcase

| Split Images | Flowcharts | Mind Maps |
| --- | --- | --- |
| ![](./apps/web/public/product_showcase/九宫格拆图.gif) | ![](./apps/web/public/product_showcase/流程图.gif) | ![](./apps/web/public/product_showcase/思维导图.gif) |
| Semantic image splitting | Semantic flowcharts | Semantic mind maps |

## Platform Capabilities

- **AI generation and routing**: images, video, audio, text, and Agent flows from one workspace.
- **Canvas workspace**: AI tasks, assets, frames, tool windows, and knowledge-base content share the same surface.
- **Task and asset management**: queues, media library, unified cache, and history make outputs reusable.
- **Toolbox and extensions**: internal React tools, iframe tools, Skill/Agent modules, and plugin runtime support.
- **PPT and content workflows**: frame slideshows, PPT export, Markdown/Mermaid conversion, and media editing.

## Local Development

### Requirements

- Node.js 20+
- pnpm 10.21.0, preferably via Corepack

### Install and Run

```bash
corepack enable pnpm
pnpm install
pnpm start
```

Open `http://localhost:7200` after the dev server starts.

### Common Commands

```bash
pnpm start             # Start Web dev server
pnpm build:web         # Build the Web app
pnpm build             # Build the workspace
pnpm check             # typecheck + lint
pnpm test              # Run unit tests
pnpm e2e:smoke         # Run smoke E2E tests
pnpm check:cycles      # Check circular dependencies
pnpm manual:build      # Generate user manual
```

## Deployment

The repository keeps several supported deployment paths:

- Vercel / Netlify: use the one-click buttons above or the included static hosting config.
- Docker: build the static-site image with the root `Dockerfile`.
- Hybrid CDN + self-hosting: see [NPM CDN Deploy](./docs/NPM_CDN_DEPLOY.md) and [CDN Deployment](./docs/CDN_DEPLOYMENT.md).

## Repository Structure

```text
aitu/
├── apps/
│   ├── web/                 # Opentu Web app and Service Worker
│   └── web-e2e/             # Playwright E2E and manual generation
├── packages/
│   ├── drawnix/             # Canvas workspace core
│   ├── react-board/         # Plait React board adapter
│   ├── react-text/          # Text rendering components
│   └── utils/               # Shared utilities and workflow parsing
├── docs/                    # Current development documentation
├── openspec/                # Requirements and change proposals
└── scripts/                 # Build, release, manual, and deploy scripts
```

## Documentation

- [Development docs](./docs/README.md)
- [Contributing guide](./CONTRIBUTING.md)
- [OpenSpec instructions](./openspec/AGENTS.md)

## License

MIT
