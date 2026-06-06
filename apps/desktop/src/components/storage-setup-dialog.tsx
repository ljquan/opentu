/**
 * 首次启动存储路径设置对话框
 * 在应用首次启动时显示，允许用户选择生成产物的存放位置
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  isTauriEnvironment,
  getMediaRootPath,
  setMediaRootPath,
  pickMediaFolder,
} from '../utils/tauri-api';

export interface StorageSetupDialogProps {
  visible: boolean;
  onComplete: (selectedPath: string) => void;
  container?: HTMLElement | null;
}

const StorageSetupDialog: React.FC<StorageSetupDialogProps> = ({
  visible,
  onComplete,
  container,
}) => {
  const [currentPath, setCurrentPath] = useState('');
  const [inputPath, setInputPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // 加载当前路径
  useEffect(() => {
    if (!visible || !isTauriEnvironment()) {
      return;
    }

    getMediaRootPath()
      .then((path) => {
        setCurrentPath(path);
        setInputPath(path);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[StorageSetup] Failed to get media root path:', err);
        setIsLoading(false);
      });
  }, [visible]);

  // 选择文件夹
  const handleBrowse = useCallback(async () => {
    try {
      const selectedPath = await pickMediaFolder();
      if (selectedPath) {
        setInputPath(selectedPath);
        setError('');
      }
    } catch (err) {
      console.error('[StorageSetup] Failed to pick folder:', err);
      setError('无法打开文件夹选择器');
    }
  }, []);

  // 确认选择
  const handleConfirm = useCallback(async () => {
    if (!inputPath.trim()) {
      setError('请输入有效的文件夹路径');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const savedPath = await setMediaRootPath(inputPath.trim());
      onComplete(savedPath);
    } catch (err) {
      console.error('[StorageSetup] Failed to set media root path:', err);
      setError('无法设置存储路径，请检查路径是否有效');
      setIsSaving(false);
    }
  }, [inputPath, onComplete]);

  // 使用默认路径
  const handleUseDefault = useCallback(async () => {
    setIsSaving(true);
    setError('');

    try {
      const savedPath = await setMediaRootPath(currentPath);
      onComplete(savedPath);
    } catch (err) {
      console.error('[StorageSetup] Failed to use default path:', err);
      setError('无法使用默认路径');
      setIsSaving(false);
    }
  }, [currentPath, onComplete]);

  if (!visible) {
    return null;
  }

  return (
    <div className="storage-setup-overlay">
      <div className="storage-setup-dialog">
        <div className="storage-setup-header">
          <h2 className="storage-setup-title">欢迎使用 Opentu 开图</h2>
          <p className="storage-setup-subtitle">
            请选择生成产物的存放位置，图片和视频将分别存放在所选路径下的「图片」和「视频」文件夹中。
          </p>
        </div>

        <div className="storage-setup-body">
          {isLoading ? (
            <div className="storage-setup-loading">
              <span>正在加载配置...</span>
            </div>
          ) : (
            <>
              <div className="storage-setup-field">
                <label className="storage-setup-label">存储路径</label>
                <div className="storage-setup-path-row">
                  <input
                    type="text"
                    className="storage-setup-input"
                    value={inputPath}
                    onChange={(e) => {
                      setInputPath(e.target.value);
                      setError('');
                    }}
                    placeholder="输入或选择文件夹路径..."
                    disabled={isSaving}
                  />
                  <button
                    type="button"
                    className="storage-setup-browse-btn"
                    onClick={handleBrowse}
                    disabled={isSaving}
                  >
                    浏览...
                  </button>
                </div>
                <p className="storage-setup-hint">
                  生成的文件将保存在此路径下：
                  <br />
                  <span className="storage-setup-subdirs">
                    {inputPath || '...'}\图片\ — 存放生成的图片
                    <br />
                    {inputPath || '...'}\视频\ — 存放生成的视频
                    <br />
                    {inputPath || '...'}\音频\ — 存放生成的音频
                  </span>
                </p>
              </div>

              {error && (
                <div className="storage-setup-error">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="storage-setup-footer">
          <button
            type="button"
            className="storage-setup-btn storage-setup-btn--secondary"
            onClick={handleUseDefault}
            disabled={isSaving || isLoading}
          >
            使用默认位置
          </button>
          <button
            type="button"
            className="storage-setup-btn storage-setup-btn--primary"
            onClick={handleConfirm}
            disabled={isSaving || isLoading || !inputPath.trim()}
          >
            {isSaving ? '保存中...' : '确认'}
          </button>
        </div>
      </div>

      <style>{`
        .storage-setup-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
        }

        .storage-setup-dialog {
          width: 520px;
          max-width: 90vw;
          max-height: 85vh;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .storage-setup-header {
          padding: 28px 28px 16px;
          text-align: center;
        }

        .storage-setup-title {
          margin: 0 0 8px;
          font-size: 20px;
          font-weight: 600;
          color: #1a1a1a;
        }

        .storage-setup-subtitle {
          margin: 0;
          font-size: 14px;
          color: #666;
          line-height: 1.6;
        }

        .storage-setup-body {
          padding: 16px 28px;
          flex: 1;
        }

        .storage-setup-loading {
          text-align: center;
          padding: 24px;
          color: #999;
        }

        .storage-setup-field {
          margin-bottom: 16px;
        }

        .storage-setup-label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }

        .storage-setup-path-row {
          display: flex;
          gap: 8px;
        }

        .storage-setup-input {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          font-size: 14px;
          color: #333;
          background: #f9fafb;
          outline: none;
          transition: border-color 0.2s;
        }

        .storage-setup-input:focus {
          border-color: #7c3aed;
          background: #fff;
        }

        .storage-setup-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .storage-setup-browse-btn {
          padding: 10px 16px;
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          font-size: 14px;
          color: #333;
          background: #fff;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;
        }

        .storage-setup-browse-btn:hover:not(:disabled) {
          border-color: #7c3aed;
          color: #7c3aed;
        }

        .storage-setup-browse-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .storage-setup-hint {
          margin: 10px 0 0;
          font-size: 12px;
          color: #999;
          line-height: 1.6;
        }

        .storage-setup-subdirs {
          color: #666;
          font-family: 'Consolas', 'Monaco', monospace;
          font-size: 11px;
        }

        .storage-setup-error {
          padding: 10px 14px;
          margin-top: 8px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #dc2626;
          font-size: 13px;
        }

        .storage-setup-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 28px 24px;
          border-top: 1px solid #f0f0f0;
        }

        .storage-setup-btn {
          padding: 10px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .storage-setup-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .storage-setup-btn--primary {
          background: #7c3aed;
          color: #fff;
        }

        .storage-setup-btn--primary:hover:not(:disabled) {
          background: #6d28d9;
        }

        .storage-setup-btn--secondary {
          background: #f3f4f6;
          color: #374151;
        }

        .storage-setup-btn--secondary:hover:not(:disabled) {
          background: #e5e7eb;
        }
      `}</style>
    </div>
  );
};

export default StorageSetupDialog;