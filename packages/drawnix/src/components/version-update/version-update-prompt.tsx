
import React, { useState, useEffect } from 'react';
import { Button, Dialog } from 'tdesign-react';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import { RefreshIcon } from 'tdesign-icons-react';
import { useI18n } from '../../i18n';
import './version-update-prompt.scss';

export const VersionUpdatePrompt: React.FC = () => {
  const [updateAvailable, setUpdateAvailable] = useState<{
    version: string;
    releaseId?: string;
    changelog?: string[];
  } | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const { activeTasks } = useTaskQueue();
  // const { t } = useI18n(); // Assuming i18n is available, if not fallback to strings

  useEffect(() => {
    // Listen for custom event from main.tsx
    const handleUpdateAvailable = async (event: Event) => {
      const customEvent = event as CustomEvent;
      
      const newVersion = customEvent.detail?.version;
      
      // 产品版本可以不变，但每次部署的 releaseId 必须不同。
      // 老页面没有该 meta，视为需要升级，以完成一次性迁移。
      const currentReleaseMeta = document.querySelector(
        'meta[name="app-release-id"]'
      );
      const currentReleaseId = currentReleaseMeta?.getAttribute('content');

      if (currentReleaseId && newVersion === currentReleaseId) {
        return;
      }
      
      try {
        // Fetch detailed version info (changelog)
        const res = await fetch(`./version.json?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          
          if (currentReleaseId && data.releaseId === currentReleaseId) {
            return;
          }
          
          // SW 事件携带 releaseId；界面仍展示易读的产品版本。
          if (!newVersion || data.releaseId === newVersion) {
            setUpdateAvailable(data);
            return;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch version.json:', error);
      }

      // Fallback to event detail
      setUpdateAvailable(customEvent.detail);
    };

    window.addEventListener('sw-update-available', handleUpdateAvailable);

    // 调试辅助：在开发环境下挂载手动触发方法
    if (process.env.NODE_ENV === 'development') {
      (window as any).__debugTriggerUpdate = (version = '9.9.9') => {
        // console.log('[Debug] Triggering update prompt');
        window.dispatchEvent(new CustomEvent('sw-update-available', { 
          detail: { version } 
        }));
      };
      // console.log('[VersionUpdatePrompt] Debug mode: run window.__debugTriggerUpdate() to test');
    }

    return () => {
      window.removeEventListener('sw-update-available', handleUpdateAvailable);
    };
  }, []);

  const handleUpdate = () => {
    // Keep the prompt visible until the new SW actually takes over.
    // Otherwise a failed COMMIT_UPGRADE looks like a successful update.
    setShowChangelog(false);
    // Dispatch event to notify main.tsx to proceed with upgrade
    window.dispatchEvent(new CustomEvent('user-confirmed-upgrade'));
  };

  // Only show if update is available AND no active tasks
  if (!updateAvailable || activeTasks.length > 0) {
    return null;
  }

  return (
    <>
      <div className="version-update-prompt">
        <div className="version-update-prompt__content">
          <span className="version-update-prompt__text">
            新版本 v{updateAvailable.version} 已就绪
          </span>
          {updateAvailable.changelog && updateAvailable.changelog.length > 0 && (
            <Button
              theme="default"
              variant="text"
              size="small"
              onClick={() => setShowChangelog(true)}
            >
              查看更新内容
            </Button>
          )}
          <Button 
            theme="primary" 
            size="small" 
            onClick={handleUpdate}
            icon={<RefreshIcon />}
          >
            立即更新
          </Button>
        </div>
      </div>

      <Dialog
        header={`新版本 v${updateAvailable.version} 更新内容`}
        visible={showChangelog}
        onClose={() => setShowChangelog(false)}
        width={600}
        footer={
          <Button theme="primary" onClick={handleUpdate}>
            立即更新
          </Button>
        }
      >
        <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
          <ul style={{ paddingLeft: '20px', margin: 0 }}>
            {updateAvailable.changelog?.map((item, index) => (
              <li key={index} style={{ marginBottom: '4px', lineHeight: '1.5' }}>{index + 1}. {item}</li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
};
