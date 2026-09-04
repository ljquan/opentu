<div align="center">
  <h1>Opentu (opentu.ai)</h1>
  <h3>Canvas-first AI Application Platform</h3>
  <p>Connect models, tools, assets, and knowledge flows so AI work keeps running in one workspace.</p>
  <p>
    <a href="https://github.com/ljquan/opentu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
    <a href="https://opentu.ai"><img src="https://img.shields.io/badge/demo-online-brightgreen.svg" alt="Demo"></a>
  </p>
  <p>
    <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fljquan%2Fopentu&project-name=opentu&repository-name=opentu"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>
    <a href="https://app.netlify.com/start/deploy?repository=https://github.com/ljquan/opentu"><img src="https://www.netlify.com/img/deploy/button.svg" alt="Deploy to Netlify"></a>
  </p>
</div>

[中文 README](./README.md)

## Live Apps

- Production: [opentu.ai](https://opentu.ai)
- Preview: [pr.opentu.ai](https://pr.opentu.ai)

## Official Install Notice

This repository does not publish official macOS DMG, Windows MSI/EXE, or Linux AppImage desktop installers. Do not run third-party one-line installers or download `Opentu-*.dmg` assets from unverified forks.

Use one of the supported paths instead:

- Terminal install:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/ljquan/opentu/main/scripts/install_opentu.sh | bash
  ```

- Web/PWA: open [opentu.ai](https://opentu.ai) and install it from your browser.
- Local development: follow the steps below.

The install script downloads the official source to `~/.opentu/app`, installs dependencies, creates the `~/.local/bin/opentu` launcher, and creates an `Opentu.app` launcher on macOS.

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
