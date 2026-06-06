import '../web/src/utils/permissions-policy-fix';
import { isTauriEnvironment, getLocalSetting, setLocalSetting } from './utils/tauri-api';

function updateBootProgress(progress: number) {
  const fill = document.getElementById('boot-progress-fill');
  const value = document.getElementById('boot-progress-value');
  if (fill) fill.style.width = progress + '%';
  if (value) value.textContent = progress + '%';
}

function hideBootScreen() {
  const bootRoot = document.getElementById('app-boot-loading');
  if (bootRoot) {
    bootRoot.classList.add('is-leaving');
    setTimeout(() => {
      if (bootRoot.parentNode) {
        bootRoot.parentNode.removeChild(bootRoot);
      }
    }, 360);
  }
}

async function checkFirstRun(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return false;
  }
  try {
    const hasRun = await getLocalSetting('first_run_completed');
    return hasRun !== 'true';
  } catch {
    return true;
  }
}

async function markFirstRunCompleted(): Promise<void> {
  try {
    await setLocalSetting('first_run_completed', 'true');
  } catch {
    // 忽略保存失败
  }
}

async function showStorageSetup(): Promise<void> {
  return new Promise((resolve) => {
    // 动态导入 React 和组件
    import('react').then((React) => {
      import('react-dom/client').then((ReactDOM) => {
        import('./components/storage-setup-dialog').then((module) => {
          const StorageSetupDialog = module.default;

          // 创建一个挂载点
          const mountPoint = document.createElement('div');
          mountPoint.id = 'storage-setup-root';
          document.body.appendChild(mountPoint);

          const root = ReactDOM.createRoot(mountPoint);

          const handleComplete = async () => {
            await markFirstRunCompleted();
            root.unmount();
            mountPoint.remove();
            resolve();
          };

          root.render(
            React.createElement(StorageSetupDialog, {
              visible: true,
              onComplete: handleComplete,
            })
          );
        });
      });
    });
  });
}

async function bootstrap() {
  updateBootProgress(30);

  // 检查是否为首次运行
  const isFirstRun = await checkFirstRun();

  if (isFirstRun) {
    // 隐藏启动画面，显示设置向导
    hideBootScreen();
    await showStorageSetup();
  }

  updateBootProgress(60);

  import('../web/src/app/bootstrap').then(() => {
    updateBootProgress(100);
    if (!isFirstRun) {
      setTimeout(hideBootScreen, 200);
    }
  }).catch((error) => {
    console.error('[Desktop] Failed to load app bootstrap:', error);
    updateBootProgress(100);
    if (!isFirstRun) {
      const tip = document.querySelector('.app-boot-tip');
      if (tip) tip.textContent = '启动失败，请重启应用';
    }
  });
}

bootstrap();