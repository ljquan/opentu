/**
 * 同步设置面板组件
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Dialog, MessagePlugin, Button, Switch, Loading, Avatar, Tooltip } from 'tdesign-react';
import {
  CloudIcon,
  CheckCircleFilledIcon,
  CloseCircleFilledIcon,
  LinkIcon,
  DeleteIcon,
  RefreshIcon,
  HelpCircleIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
} from 'tdesign-icons-react';
import { useGitHubSync, GistInfo } from '../../contexts/GitHubSyncContext';
import { tokenService, syncPasswordService } from '../../services/github-sync';
import { TokenGuide } from './TokenGuide';
import { RecycleBin } from './RecycleBin';
import { ConfirmDialog, useConfirmDialog } from '../dialog/ConfirmDialog';
import { LockOnIcon, LockOffIcon } from 'tdesign-icons-react';
import { safeReload } from '../../utils/active-tasks';
import './sync-settings.scss';

/** Props */
interface SyncSettingsProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 格式化时间
 */
function formatTime(timestamp: number | null): string {
  if (!timestamp) return '从未';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化日期字符串
 */
function formatDateString(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 同步设置面板
 */
export function SyncSettings({ visible, onClose }: SyncSettingsProps) {
  const {
    isConnected,
    syncStatus,
    isSyncing,
    lastSyncTime,
    userInfo,
    error,
    setToken,
    clearToken,
    sync,
    pullFromRemote,
    pushToRemote,
    gistUrl,
    config,
    updateConfig,
    listGists,
    deleteGist,
  } = useGitHubSync();

  const [tokenInput, setTokenInput] = useState('');
  const [isSettingToken, setIsSettingToken] = useState(false);
  const [showTokenGuide, setShowTokenGuide] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isLocalSyncing, setIsLocalSyncing] = useState(false);
  
  // Gist 管理状态
  const [showGistManager, setShowGistManager] = useState(false);
  const [gists, setGists] = useState<GistInfo[]>([]);
  const [isLoadingGists, setIsLoadingGists] = useState(false);
  const [deleteConfirmGist, setDeleteConfirmGist] = useState<GistInfo | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  
  // 加密密码状态
  const [customPassword, setCustomPassword] = useState('');
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [storedPassword, setStoredPassword] = useState(''); // 完整的已存储密码
  const [showStoredPassword, setShowStoredPassword] = useState(false); // 是否显示完整密码
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  
  /** 创建掩码密码（显示前后各2位） */
  const maskPassword = (password: string): string => {
    if (password.length <= 4) {
      return '*'.repeat(password.length);
    }
    const prefix = password.slice(0, Math.floor(password.length/4));
    const suffix = password.slice(-Math.floor(password.length/4));
    const masked = '*'.repeat(Math.min(password.length - 4, 6));
    return `${prefix}${masked}${suffix}`;
  };
  
  /** 获取显示的密码（根据显示/隐藏状态） */
  const displayPassword = showStoredPassword ? storedPassword : maskPassword(storedPassword);

  // 加载 Gist 列表
  const loadGists = useCallback(async () => {
    if (!isConnected) return;
    
    setIsLoadingGists(true);
    try {
      const gistList = await listGists();
      setGists(gistList);
    } catch (err) {
      console.error('Failed to load gists:', err);
      MessagePlugin.error('获取 Gist 列表失败');
    } finally {
      setIsLoadingGists(false);
    }
  }, [isConnected, listGists]);

  // 当展开 Gist 管理器时加载列表
  useEffect(() => {
    if (showGistManager && isConnected) {
      loadGists();
    }
  }, [showGistManager, isConnected, loadGists]);

  // 加载已存储的密码状态
  useEffect(() => {
    if (visible && isConnected) {
      syncPasswordService.getPassword().then((password) => {
        setHasStoredPassword(!!password);
        setStoredPassword(password || '');
        setShowStoredPassword(false); // 重置为隐藏状态
      });
    }
  }, [visible, isConnected]);

  // 保存自定义密码
  const handleSavePassword = useCallback(async () => {
    setIsSavingPassword(true);
    try {
      await syncPasswordService.savePassword(customPassword);
      setHasStoredPassword(!!customPassword);
      setStoredPassword(customPassword || '');
      setShowStoredPassword(false);
      if (customPassword) {
        MessagePlugin.success('加密密码已保存');
      } else {
        MessagePlugin.info('已恢复使用默认加密');
      }
      setCustomPassword('');
    } catch (err) {
      MessagePlugin.error('保存密码失败');
    } finally {
      setIsSavingPassword(false);
    }
  }, [customPassword]);

  // 清除自定义密码
  const handleClearPassword = useCallback(async () => {
    setIsSavingPassword(true);
    try {
      await syncPasswordService.savePassword('');
      setHasStoredPassword(false);
      setCustomPassword('');
      MessagePlugin.info('已恢复使用默认加密');
    } finally {
      setIsSavingPassword(false);
    }
  }, []);

  // 保存 Token
  const handleSaveToken = useCallback(async () => {
    if (!tokenInput.trim()) {
      MessagePlugin.warning('请输入 Token');
      return;
    }

    setIsSettingToken(true);
    try {
      const success = await setToken(tokenInput.trim());
      if (success) {
        MessagePlugin.success('Token 配置成功');
        setTokenInput('');
      }
    } finally {
      setIsSettingToken(false);
    }
  }, [tokenInput, setToken]);

  // 执行同步（双向，已废弃，保留兼容）
  const handleSync = useCallback(async () => {
    if (isSyncing || isLocalSyncing) {
      return;
    }
    
    setIsLocalSyncing(true);
    try {
      const result = await sync();
      if (result.success) {
        // 构建详细的同步结果消息
        const parts: string[] = ['同步完成'];
        
        // 统计上传、下载和删除
        const uploaded = result.uploaded.boards + result.uploaded.prompts + result.uploaded.tasks;
        const downloaded = result.downloaded.boards + result.downloaded.prompts + result.downloaded.tasks;
        const deleted = result.deleted 
          ? result.deleted.boards + result.deleted.prompts + result.deleted.tasks
          : 0;
        
        if (uploaded > 0 || downloaded > 0 || deleted > 0) {
          const details: string[] = [];
          if (uploaded > 0) details.push(`上传 ${uploaded} 项`);
          if (downloaded > 0) details.push(`下载 ${downloaded} 项`);
          if (deleted > 0) details.push(`删除 ${deleted} 项`);
          parts.push(`(${details.join(', ')})`);
        }
        
        // 如果有合并的冲突
        const mergedConflicts = result.conflicts.filter(c => c.merged);
        if (mergedConflicts.length > 0) {
          parts.push(`，已自动合并 ${mergedConflicts.length} 个画板`);
        }
        
        MessagePlugin.success(parts.join(''));
        
        // 刷新 Gist 列表
        if (showGistManager) {
          loadGists();
        }
      } else if (result.error && result.error !== '同步正在进行中') {
        MessagePlugin.error(result.error);
      }
    } catch (err) {
      console.error('[SyncSettings] Sync error:', err);
      MessagePlugin.error('同步失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLocalSyncing(false);
    }
  }, [sync, isSyncing, isLocalSyncing, showGistManager, loadGists]);

  // 以远程为准同步（下载远程数据）
  const handlePullFromRemote = useCallback(async () => {
    console.log('[SyncSettings] handlePullFromRemote called');
    if (isSyncing || isLocalSyncing) {
      console.log('[SyncSettings] Already syncing, aborting');
      return;
    }
    
    const confirmed = await confirm({
      title: '确认下载覆盖',
      description: '以远程为准同步将下载云端数据覆盖本地。\n\n确定要继续吗？',
      confirmText: '继续下载',
      cancelText: '取消',
      danger: true,
    });

    if (!confirmed) {
      return;
    }
    
    setIsLocalSyncing(true);
    try {
      console.log('[SyncSettings] Calling pullFromRemote...');
      const result = await pullFromRemote();
      console.log('[SyncSettings] pullFromRemote result:', result);
      
      if (result.success) {
        const downloaded = result.downloaded.boards + result.downloaded.prompts + result.downloaded.tasks;
        const deleted = result.deleted 
          ? result.deleted.boards + result.deleted.prompts + result.deleted.tasks
          : 0;
        
        // 构建结果消息
        const parts: string[] = ['下载完成'];
        const details: string[] = [];
        if (downloaded > 0) details.push(`下载 ${downloaded} 项`);
        if (deleted > 0) details.push(`删除 ${deleted} 项`);
        if (details.length > 0) {
          parts.push(`(${details.join(', ')})`);
        }
        parts.push('，即将刷新页面...');
        
        MessagePlugin.success(parts.join(''));
        
        // 刷新页面以加载新数据
        setTimeout(() => {
          console.log('[SyncSettings] Refreshing page...');
          safeReload();
        }, 1000);
      } else if (result.needsPassword) {
        // 需要输入密码
        MessagePlugin.warning('远程数据使用了加密密码，请在下方设置正确的密码后重试');
      } else if (result.error && result.error !== '同步正在进行中') {
        MessagePlugin.error(result.error);
      }
    } catch (err) {
      console.error('[SyncSettings] Pull error:', err);
      MessagePlugin.error('下载失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLocalSyncing(false);
    }
  }, [confirm, pullFromRemote, isSyncing, isLocalSyncing]);

  // 以本地为准同步（上传本地数据）
  const handlePushToRemote = useCallback(async () => {
    console.log('[SyncSettings] handlePushToRemote called', { isSyncing, isLocalSyncing });
    if (isSyncing || isLocalSyncing) {
      console.log('[SyncSettings] Already syncing, aborting push');
      return;
    }
    
    const confirmed = await confirm({
      title: '确认上传覆盖',
      description: '以本地为准同步将上传本地数据覆盖云端。\n\n确定要继续吗？',
      confirmText: '继续上传',
      cancelText: '取消',
      danger: true,
    });

    if (!confirmed) {
      console.log('[SyncSettings] User cancelled push');
      return;
    }
    
    console.log('[SyncSettings] Starting push...');
    setIsLocalSyncing(true);
    try {
      console.log('[SyncSettings] Calling pushToRemote...');
      const result = await pushToRemote();
      console.log('[SyncSettings] pushToRemote result:', result);
      if (result.success) {
        const uploaded = result.uploaded.boards + result.uploaded.prompts + result.uploaded.tasks;
        MessagePlugin.success(`上传完成 (${uploaded} 项)`);
        
        // 刷新 Gist 列表
        if (showGistManager) {
          loadGists();
        }
      } else if (result.error && result.error !== '同步正在进行中') {
        MessagePlugin.error(result.error);
      }
    } catch (err) {
      console.error('[SyncSettings] Push error:', err);
      MessagePlugin.error('上传失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLocalSyncing(false);
    }
  }, [confirm, pushToRemote, isSyncing, isLocalSyncing, showGistManager, loadGists]);
  
  // 综合同步状态
  const syncingState = isSyncing || isLocalSyncing;

  // 断开连接
  const handleDisconnect = useCallback(() => {
    clearToken();
    setShowDisconnectConfirm(false);
    setShowGistManager(false);
    setGists([]);
    MessagePlugin.info('已断开连接');
  }, [clearToken]);

  // 切换自动同步
  const handleAutoSyncChange = useCallback(async (checked: boolean) => {
    await updateConfig({ autoSync: checked });
  }, [updateConfig]);

  // 打开 Gist 页面
  const handleOpenGist = useCallback(() => {
    if (gistUrl) {
      window.open(gistUrl, '_blank');
    }
  }, [gistUrl]);

  // 删除 Gist
  const handleDeleteGist = useCallback(async (gist: GistInfo) => {
    try {
      await deleteGist(gist.id);
      MessagePlugin.success('Gist 已删除');
      setDeleteConfirmGist(null);
      loadGists();
    } catch (err) {
      MessagePlugin.error('删除失败');
    }
  }, [deleteGist, loadGists]);

  // 获取 Token 创建链接
  const tokenCreationUrl = tokenService.getTokenCreationUrl();

  return (
    <>
      <Dialog
        visible={visible}
        onClose={onClose}
        header="云端同步"
        footer={null}
        width={520}
        className="sync-settings-dialog"
      >
        <div className="sync-settings">
          {/* 顶部状态栏 */}
          <div className="sync-settings__header">
            {isConnected ? (
              <div className="sync-settings__user-card">
                <div className="sync-settings__user-info">
                  {userInfo?.avatar_url && (
                    <Avatar image={userInfo.avatar_url} size="24px" />
                  )}
                  <span className="sync-settings__username">
                    {userInfo?.name || userInfo?.login || 'GitHub 用户'}
                  </span>
                  <span className="sync-settings__status-badge">
                    <CheckCircleFilledIcon className="sync-settings__status-icon--success" />
                    已连接
                  </span>
                </div>
                <Button
                  variant="text"
                  size="small"
                  className="sync-settings__disconnect-btn"
                  onClick={() => setShowDisconnectConfirm(true)}
                >
                  断开
                </Button>
              </div>
            ) : (
              <div className="sync-settings__not-connected">
                <CloudIcon className="sync-settings__cloud-icon" />
                <span>使用 GitHub Gist 同步数据</span>
              </div>
            )}
          </div>

          {/* Token 配置（未连接时显示） */}
          {!isConnected && (
            <div className="sync-settings__token-section">
              <div className="sync-settings__token-label">
                <span>GitHub Token</span>
                <Button
                  variant="text"
                  size="small"
                  icon={<HelpCircleIcon />}
                  onClick={() => setShowTokenGuide(true)}
                >
                  如何获取？
                </Button>
              </div>
              <form
                className="sync-settings__token-input-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveToken();
                }}
              >
                <input
                  type="password"
                  className="sync-settings__token-input"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxx"
                  autoComplete="off"
                />
                <Button
                  theme="primary"
                  loading={isSettingToken}
                  type="submit"
                  disabled={!tokenInput.trim()}
                >
                  连接
                </Button>
              </form>
              {error && (
                <div className="sync-settings__error">
                  <CloseCircleFilledIcon />
                  <span>{error}</span>
                </div>
              )}
              <a
                href={tokenCreationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sync-settings__token-link"
              >
                <LinkIcon />
                在 GitHub 创建 Token
              </a>
            </div>
          )}

          {/* 同步操作（已连接时显示） */}
          {isConnected && (
            <>
              <div className="sync-settings__sync-section">
                <div className="sync-settings__sync-stats">
                  <div className="sync-settings__stat-row">
                    <span className="sync-settings__stat-label">同步状态</span>
                    <div className="sync-settings__stat-content">
                      <span className="sync-settings__stat-value">
                        {syncStatus === 'synced' && '已同步'}
                        {syncStatus === 'local_changes' && '有待同步'}
                        {syncStatus === 'syncing' && '同步中...'}
                        {syncStatus === 'error' && '同步出错'}
                      </span>
                      <span className="sync-settings__stat-divider">·</span>
                      <span className="sync-settings__stat-time">
                        {formatTime(lastSyncTime)}
                      </span>
                      {config?.gistId && (
                        <>
                          <span className="sync-settings__stat-divider">·</span>
                          <Tooltip content={config.gistId} theme="light">
                            <span className="sync-settings__stat-gist">
                              {config.gistId.substring(0, 6)}...
                            </span>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="sync-settings__sync-actions">
                  <div className="sync-settings__sync-buttons">
                    <Tooltip content="下载云端数据到本地（覆盖本地）" theme="light">
                      <Button
                        theme="primary"
                        variant="outline"
                        icon={syncingState ? <Loading /> : <CloudDownloadIcon />}
                        onClick={handlePullFromRemote}
                        disabled={syncingState}
                      >
                        {syncingState ? '同步中...' : '下载远程'}
                      </Button>
                    </Tooltip>
                    <Tooltip content="上传本地数据到云端（覆盖云端）" theme="light">
                      <Button
                        theme="primary"
                        icon={syncingState ? <Loading /> : <CloudUploadIcon />}
                        onClick={handlePushToRemote}
                        disabled={syncingState}
                      >
                        {syncingState ? '同步中...' : '上传本地'}
                      </Button>
                    </Tooltip>
                  </div>
                </div>

                {syncingState && (
                  <div className="sync-settings__info">
                    <Loading size="small" />
                    <span>同步正在进行中</span>
                  </div>
                )}

                {error && !syncingState && (
                  <div className="sync-settings__error">
                    <CloseCircleFilledIcon />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* Gist 管理器 */}
              <div className="sync-settings__gist-manager">
                <div 
                  className="sync-settings__gist-manager-header"
                  onClick={() => setShowGistManager(!showGistManager)}
                >
                  {showGistManager ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  <span>Gist 管理</span>
                  {gistUrl && !showGistManager && (
                    <span className="sync-settings__gist-mini-id">
                      {config?.gistId?.substring(0, 6)}...
                    </span>
                  )}
                </div>
                
                {showGistManager && (
                  <div className="sync-settings__gist-list">
                    {isLoadingGists ? (
                      <div className="sync-settings__gist-loading">
                        <Loading size="small" />
                        <span>加载中...</span>
                      </div>
                    ) : gists.length === 0 ? (
                      <div className="sync-settings__gist-empty">
                        暂无同步 Gist
                      </div>
                    ) : (
                      gists.map(gist => (
                        <div 
                          key={gist.id} 
                          className={`sync-settings__gist-item ${gist.isCurrent ? 'sync-settings__gist-item--current' : ''}`}
                        >
                          <div className="sync-settings__gist-item-info">
                            <div className="sync-settings__gist-item-header">
                              {gist.isMaster && (
                                <span className="sync-settings__gist-master-badge">主数据库</span>
                              )}
                              {gist.isCurrent && (
                                <span className="sync-settings__gist-current-badge">当前</span>
                              )}
                              <span className="sync-settings__gist-id">
                                {gist.id.length > 16 
                                  ? `${gist.id.substring(0, 6)}...${gist.id.substring(gist.id.length - 6)}`
                                  : gist.id}
                              </span>
                            </div>
                            <div className="sync-settings__gist-item-meta">
                              <span>{gist.filesCount} 个文件</span>
                              <span>更新于 {formatDateString(gist.updatedAt)}</span>
                            </div>
                          </div>
                          <div className="sync-settings__gist-item-actions">
                            <Tooltip content="在 GitHub 查看" theme="light">
                              <Button
                                variant="text"
                                size="small"
                                icon={<LinkIcon />}
                                onClick={() => window.open(gist.url, '_blank')}
                              />
                            </Tooltip>
                            <Tooltip content="删除" theme="light">
                              <Button
                                variant="text"
                                size="small"
                                className="sync-settings__delete-btn"
                                icon={<DeleteIcon />}
                                onClick={() => setDeleteConfirmGist(gist)}
                              />
                            </Tooltip>
                          </div>
                        </div>
                      ))
                    )}
                    
                    <div className="sync-settings__gist-actions">
                      <Button
                        variant="text"
                        size="small"
                        icon={<RefreshIcon />}
                        onClick={loadGists}
                        disabled={isLoadingGists}
                      >
                        刷新列表
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* 回收站 */}
              <RecycleBin 
                isConnected={isConnected} 
                onRefresh={() => {
                  // 恢复画板后刷新页面
                  safeReload();
                }}
              />

              {/* 同步选项 */}
              <div className="sync-settings__options-section">
                <div className="sync-settings__option">
                  <div className="sync-settings__option-info">
                    <span className="sync-settings__option-label">自动同步</span>
                    <span className="sync-settings__option-desc">
                      画板变更后 30 秒自动同步
                    </span>
                  </div>
                  <Switch
                    value={config?.autoSync ?? true}
                    onChange={handleAutoSyncChange}
                  />
                </div>
              </div>

              {/* 加密密码设置 */}
              <div className="sync-settings__password-section">
                <div className="sync-settings__password-header">
                  {hasStoredPassword ? <LockOnIcon /> : <LockOffIcon />}
                  <span>加密密码</span>
                  {hasStoredPassword && (
                    <span className="sync-settings__password-badge">已设置</span>
                  )}
                </div>
                <p className="sync-settings__password-desc">
                  默认使用 Gist ID 加密数据。设置自定义密码后，需在其他设备输入相同密码才能解密。
                </p>
                <div className="sync-settings__password-input-row">
                  <input
                    type="text"
                    className="sync-settings__password-input"
                    value={customPassword}
                    onChange={(e) => setCustomPassword(e.target.value)}
                    placeholder={hasStoredPassword 
                      ? `当前: ${displayPassword}，输入新密码以更换`
                      : '设置自定义加密密码（可选）'}
                    autoComplete="new-password"
                  />
                  {hasStoredPassword && (
                    <Button
                      variant="text"
                      size="small"
                      onClick={() => setShowStoredPassword(!showStoredPassword)}
                    >
                      {showStoredPassword ? '隐藏' : '显示'}
                    </Button>
                  )}
                  <Button
                    theme="primary"
                    variant="base"
                    size="small"
                    loading={isSavingPassword}
                    onClick={handleSavePassword}
                    disabled={!customPassword.trim()}
                  >
                    {hasStoredPassword ? '更换' : '设置'}
                  </Button>
                  {hasStoredPassword && (
                    <Button
                      variant="text"
                      size="small"
                      onClick={handleClearPassword}
                      disabled={isSavingPassword}
                    >
                      清除
                    </Button>
                  )}
                </div>
                <p className="sync-settings__security-hint">
                  ⚠️ Secret Gist 不公开但知道链接的人仍可访问，建议设置加密密码保护隐私。
                </p>
              </div>
            </>
          )}

          {/* 说明 */}
          <div className="sync-settings__footer">
            <div className="sync-settings__info-block">
              <div className="sync-settings__info-header">
                <HelpCircleIcon />
                <span>同步说明</span>
              </div>
              <p>
                数据存储在 <strong>Secret Gist</strong> 中，并使用 AES-256 加密。
                同步包括画板、提示词和任务记录。媒体文件需在素材库中手动同步。
              </p>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Token 创建引导 */}
      <TokenGuide
        visible={showTokenGuide}
        onClose={() => setShowTokenGuide(false)}
      />

      {/* 断开连接确认 */}
      <ConfirmDialog
        open={showDisconnectConfirm}
        title="断开连接"
        confirmText="确认断开"
        cancelText="取消"
        danger
        onOpenChange={setShowDisconnectConfirm}
        onConfirm={handleDisconnect}
      >
        <p>断开后，本地数据不会被删除，但将停止与云端同步。</p>
        <p>您可以随时重新连接恢复同步。</p>
      </ConfirmDialog>

      {/* 删除 Gist 确认 */}
      <ConfirmDialog
        open={!!deleteConfirmGist}
        title="删除 Gist"
        confirmText="确认删除"
        cancelText="取消"
        danger
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmGist(null);
          }
        }}
        onConfirm={() => deleteConfirmGist ? handleDeleteGist(deleteConfirmGist) : undefined}
      >
        <p>确定要删除此 Gist 吗？</p>
        <p>此操作不可撤销，Gist 中的数据将被永久删除。</p>
        {deleteConfirmGist?.isCurrent && (
          <p style={{ color: '#e34d59' }}>
            警告：您正在删除当前使用的 Gist，删除后需要重新选择或创建新的 Gist。
          </p>
        )}
      </ConfirmDialog>
      {confirmDialog}
    </>
  );
}
