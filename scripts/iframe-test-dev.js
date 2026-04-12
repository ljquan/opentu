const { spawn, spawnSync } = require('child_process');

const HOST = process.env.AITU_IFRAME_TEST_HOST || 'http://localhost:7201';
const TARGET = process.env.AITU_IFRAME_TEST_TARGET || 'http://localhost:7200';
const HEALTH_URL = `${HOST}/iframe-test.html`;
const PAGE_URL = `${HEALTH_URL}?target=${encodeURIComponent(TARGET)}`;
const START_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 500;

let serverProcess = null;
let appProcess = null;
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isUrlReady(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUrlReady(url)) {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function openBrowser(url) {
  if (process.platform === 'darwin') {
    return spawnSync('open', [url], { stdio: 'inherit' });
  }

  if (process.platform === 'win32') {
    return spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'inherit' });
  }

  return spawnSync('xdg-open', [url], { stdio: 'inherit' });
}

function isLocalTarget(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.port === '7200'
    );
  } catch {
    return false;
  }
}

function startAppServer() {
  appProcess = spawn('pnpm', ['start'], {
    stdio: 'inherit',
  });

  appProcess.on('exit', (code, signal) => {
    appProcess = null;
    if (shuttingDown) {
      return;
    }
    if (signal) {
      console.log(`[iframe:test] 主应用已退出，signal=${signal}`);
    } else {
      console.log(`[iframe:test] 主应用已退出，code=${code}`);
    }
    process.exit(code || 0);
  });
}

function startStaticServer() {
  serverProcess = spawn('python3', ['-m', 'http.server', '7201', '-d', 'apps/web/public'], {
    stdio: 'inherit',
  });

  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    if (shuttingDown) {
      return;
    }
    if (signal) {
      console.log(`[iframe:test] 静态服务已退出，signal=${signal}`);
    } else {
      console.log(`[iframe:test] 静态服务已退出，code=${code}`);
    }
    process.exit(code || 0);
  });
}

function registerExitHooks() {
  const shutdown = () => {
    shuttingDown = true;
    if (appProcess) {
      appProcess.kill('SIGINT');
    }
    if (serverProcess) {
      serverProcess.kill('SIGINT');
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  registerExitHooks();

  const targetReady = await isUrlReady(TARGET);
  if (!targetReady && isLocalTarget(TARGET)) {
    console.log('[iframe:test] 启动 7200 主应用...');
    startAppServer();

    const appReady = await waitForUrl(TARGET, START_TIMEOUT_MS);
    if (!appReady) {
      console.error('[iframe:test] 7200 主应用启动超时');
      process.exit(1);
    }
  } else if (targetReady) {
    console.log('[iframe:test] 检测到 7200 目标已存在，直接复用');
  } else {
    console.log(`[iframe:test] 目标地址未就绪，但不是本地 7200，跳过自动启动: ${TARGET}`);
  }

  const alreadyReady = await isUrlReady(HEALTH_URL);
  if (!alreadyReady) {
    console.log('[iframe:test] 启动 7201 父页面静态服务...');
    startStaticServer();

    const ready = await waitForUrl(HEALTH_URL, START_TIMEOUT_MS);
    if (!ready) {
      console.error('[iframe:test] 7201 父页面启动超时');
      process.exit(1);
    }
  } else {
    console.log('[iframe:test] 检测到 7201 父页面已存在，直接复用');
  }

  console.log(`[iframe:test] 打开页面: ${PAGE_URL}`);
  const openResult = openBrowser(PAGE_URL);
  if (openResult.status && openResult.status !== 0) {
    process.exit(openResult.status);
  }

  if (!serverProcess) {
    return;
  }

  console.log('[iframe:test] 开发服务运行中，按 Ctrl+C 退出');
}

main().catch((error) => {
  console.error('[iframe:test] 启动失败:', error);
  process.exit(1);
});
