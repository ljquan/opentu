<div align="center">
  <h1>Opentu (opentu.ai)</h1>
  <h3>开图 · 以画布为核心的 AI 应用平台</h3>
  <p>连接多模型生成、工具、素材与知识流，让 AI 任务在同一工作区持续执行。</p>
  <p>
    <a href="https://github.com/ljquan/opentu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
    <a href="https://opentu.ai"><img src="https://img.shields.io/badge/demo-online-brightgreen.svg" alt="Demo"></a>
  </p>
  <p>
    <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fljquan%2Fopentu&project-name=opentu&repository-name=opentu"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>
    <a href="https://app.netlify.com/start/deploy?repository=https://github.com/ljquan/opentu"><img src="https://www.netlify.com/img/deploy/button.svg" alt="Deploy to Netlify"></a>
  </p>
</div>

[English README](./README_en.md)

## 在线体验

- 正式站点：[opentu.ai](https://opentu.ai)
- 预览实例：[pr.opentu.ai](https://pr.opentu.ai)

## 官方安装说明

当前仓库未发布官方 macOS DMG、Windows MSI/EXE 或 Linux AppImage 桌面安装包。请不要执行第三方 fork 提供的一键安装脚本，也不要从未核验来源下载 `Opentu-*.dmg` 等安装资产。

推荐使用：

- 终端安装：

  ```bash
  curl -fsSL https://raw.githubusercontent.com/ljquan/opentu/main/scripts/install_opentu.sh | bash
  ```

- Web/PWA：访问 [opentu.ai](https://opentu.ai)，在浏览器中安装为应用。
- 本地开发：按下方“本地开发”步骤启动。

安装脚本会下载官方源码到 `~/.opentu/app`，安装依赖，创建 `~/.local/bin/opentu` 启动命令；在 macOS 上还会创建 `Opentu.app` 启动器。

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
