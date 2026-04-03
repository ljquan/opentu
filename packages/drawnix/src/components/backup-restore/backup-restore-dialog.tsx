/**
 * Backup & Restore Dialog
 *
 * 备份恢复对话框组件
 * 支持多选导出（提示词、项目、素材库）和增量导入
 */

import { Dialog, DialogContent } from '../dialog/dialog';
import { useState, useRef, useCallback } from 'react';
import { Checkbox, MessagePlugin, Progress, DialogPlugin } from 'tdesign-react';
import { UploadIcon } from 'tdesign-icons-react';
import {
  backupRestoreService,
  BackupOptions,
  ImportResult,
  BackupWorkspaceState,
  ExportResult,
} from '../../services/backup-restore';
import { workspaceService } from '../../services/workspace-service';
import { safeReload } from '../../utils/active-tasks';
import './backup-restore-dialog.scss';

export interface BackupRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: HTMLElement | null;
  /** 切换画板的回调（用于恢复备份时的画布状态） */
  onSwitchBoard?: (boardId: string, viewport?: BackupWorkspaceState['viewport']) => void;
  /** 导入前的回调（用于保存当前画板数据到 IndexedDB） */
  onBeforeImport?: () => Promise<void>;
}

type TabType = 'backup' | 'restore';

export const BackupRestoreDialog = ({
  open,
  onOpenChange,
  container,
  onSwitchBoard,
  onBeforeImport,
}: BackupRestoreDialogProps) => {
  const toInputDateTime = (timestamp?: number | null): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };

  const fromInputDateTime = (value: string): number | null => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const [activeTab, setActiveTab] = useState<TabType>('backup');
  const [backupOptions, setBackupOptions] = useState<BackupOptions>({
    includePrompts: true,
    includeProjects: true,
    includeAssets: true,
    includeKnowledgeBase: true,
    timeRangeStart: null,
    timeRangeEnd: null,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  // 待恢复的工作区状态（用于延迟处理画布切换）
  const [pendingWorkspaceState, setPendingWorkspaceState] = useState<BackupWorkspaceState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 处理画布切换逻辑
   * - 如果当前是空白画布，自动切换到备份时的画布
   * - 如果当前不是空白画布，弹窗询问用户
   */
  const handleWorkspaceRestore = useCallback(async (workspaceState: BackupWorkspaceState) => {
    if (!workspaceState.currentBoardId || !onSwitchBoard) return;

    // 检查备份的画板是否存在
    const targetBoard = workspaceService.getBoard(workspaceState.currentBoardId);
    if (!targetBoard) {
      // 画板不存在，可能是增量导入时没有导入该画板
      return;
    }

    // 获取当前画板
    const currentBoard = workspaceService.getCurrentBoard();
    
    // 检查当前画布是否为空白（没有元素或只有默认元素）
    const isCurrentBoardEmpty = !currentBoard || 
      !currentBoard.elements || 
      currentBoard.elements.length === 0;

    if (isCurrentBoardEmpty) {
      // 当前是空白画布，自动切换
      await onSwitchBoard(workspaceState.currentBoardId, workspaceState.viewport);
      MessagePlugin.success(`已切换到画板「${targetBoard.name}」`);
    } else {
      // 当前不是空白画布，弹窗询问
      const dialogInstance = DialogPlugin.confirm({
        header: '恢复画布状态',
        body: `备份时正在编辑画板「${workspaceState.currentBoardName || targetBoard.name}」，是否切换到该画板？`,
        confirmBtn: '切换',
        cancelBtn: '取消',
        onConfirm: async () => {
          await onSwitchBoard(workspaceState.currentBoardId!, workspaceState.viewport);
          MessagePlugin.success(`已切换到画板「${targetBoard.name}」`);
          dialogInstance.destroy();
        },
        onCancel: () => {
          dialogInstance.destroy();
        },
      });
    }
  }, [onSwitchBoard]);

  const handleClose = useCallback(async () => {
    if (!isProcessing) {
      // 如果有待恢复的工作区状态，处理画布切换（需要等待完成）
      if (pendingWorkspaceState) {
        await handleWorkspaceRestore(pendingWorkspaceState);
        setPendingWorkspaceState(null);
      }

      // 如果有导入结果且导入了任务数据，刷新页面以确保任务队列生效
      if (importResult && importResult.tasks && importResult.tasks.imported > 0) {
        safeReload();
        return;
      }
      
      onOpenChange(false);
      // 重置状态
      setProgress(0);
      setProgressMessage('');
      setImportResult(null);
    }
  }, [isProcessing, onOpenChange, importResult, pendingWorkspaceState, handleWorkspaceRestore]);

  const handleBackup = useCallback(async () => {
    // 检查是否至少选择了一项
    if (!backupOptions.includePrompts && !backupOptions.includeProjects && !backupOptions.includeAssets && !backupOptions.includeKnowledgeBase) {
      MessagePlugin.warning('请至少选择一项要备份的内容');
      return;
    }
    if (
      backupOptions.timeRangeStart &&
      backupOptions.timeRangeEnd &&
      backupOptions.timeRangeStart > backupOptions.timeRangeEnd
    ) {
      MessagePlugin.warning('开始时间不能晚于结束时间');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressMessage('正在准备...');

    try {
      const result: ExportResult = await backupRestoreService.exportToZip(
        backupOptions,
        (p, msg) => {
          setProgress(p);
          setProgressMessage(msg);
        }
      );

      MessagePlugin.success(
        `备份成功！分片 ${result.totalParts} 个，素材 ${result.stats.assetCount} 个`
      );
      handleClose();
    } catch (error) {
      console.error('[BackupRestore] Export failed:', error);
      MessagePlugin.error('备份失败，请重试');
    } finally {
      setIsProcessing(false);
    }
  }, [backupOptions, handleClose]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.name.endsWith('.zip')) {
      MessagePlugin.warning('请选择 ZIP 格式的备份文件');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressMessage('正在保存当前画板...');
    setImportResult(null);

    try {
      // 导入前先保存当前画板数据，确保合并时使用最新数据
      if (onBeforeImport) {
        await onBeforeImport();
      }

      setProgressMessage('正在读取文件...');
      const result = await backupRestoreService.importFromZip(
        file,
        (p, msg) => {
          setProgress(p);
          setProgressMessage(msg);
        }
      );

      setImportResult(result);

      // 保存工作区状态，关闭对话框时处理
      if (result.workspaceState?.currentBoardId) {
        setPendingWorkspaceState(result.workspaceState);
      }

      if (result.success) {
        MessagePlugin.success('导入成功！');
      } else if (result.errors.length > 0) {
        MessagePlugin.warning('导入完成，但有部分错误');
      }
    } catch (error) {
      console.error('[BackupRestore] Import failed:', error);
      MessagePlugin.error('导入失败，请检查文件格式');
    } finally {
      setIsProcessing(false);
      // 清空文件输入
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [onBeforeImport]);

  const handleOptionChange = useCallback((key: keyof BackupOptions, checked: boolean) => {
    setBackupOptions((prev) => ({ ...prev, [key]: checked }));
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="backup-restore-dialog" container={container} data-testid="backup-restore-dialog">
        <h2 className="backup-restore-dialog__title">备份 / 恢复</h2>

        {/* 标签页切换 */}
        <div className="backup-restore-dialog__tabs">
          <button
            className={`backup-restore-dialog__tab ${activeTab === 'backup' ? 'backup-restore-dialog__tab--active' : ''}`}
            onClick={() => setActiveTab('backup')}
            disabled={isProcessing}
          >
            备份
          </button>
          <button
            className={`backup-restore-dialog__tab ${activeTab === 'restore' ? 'backup-restore-dialog__tab--active' : ''}`}
            onClick={() => setActiveTab('restore')}
            disabled={isProcessing}
          >
            恢复
          </button>
        </div>

        {/* 备份面板 */}
        {activeTab === 'backup' && (
          <div className="backup-restore-dialog__panel">
            <p className="backup-restore-dialog__description">
              选择要备份的内容，将导出为 ZIP 压缩包：
            </p>

            <div className="backup-restore-dialog__options">
              <Checkbox
                checked={backupOptions.includePrompts}
                onChange={(checked) => handleOptionChange('includePrompts', checked as boolean)}
                disabled={isProcessing}
              >
                <div className="backup-restore-dialog__option-content">
                  <span className="backup-restore-dialog__option-title">提示词</span>
                  <span className="backup-restore-dialog__option-desc">包含图片和视频生成的历史提示词</span>
                </div>
              </Checkbox>

              <Checkbox
                checked={backupOptions.includeProjects}
                onChange={(checked) => handleOptionChange('includeProjects', checked as boolean)}
                disabled={isProcessing}
              >
                <div className="backup-restore-dialog__option-content">
                  <span className="backup-restore-dialog__option-title">项目</span>
                  <span className="backup-restore-dialog__option-desc">包含所有文件夹和画板</span>
                </div>
              </Checkbox>

              <Checkbox
                checked={backupOptions.includeAssets}
                onChange={(checked) => handleOptionChange('includeAssets', checked as boolean)}
                disabled={isProcessing}
              >
                <div className="backup-restore-dialog__option-content">
                  <span className="backup-restore-dialog__option-title">素材库</span>
                  <span className="backup-restore-dialog__option-desc">包含所有本地上传的图片和视频</span>
                </div>
              </Checkbox>

              <Checkbox
                checked={backupOptions.includeKnowledgeBase}
                onChange={(checked) => handleOptionChange('includeKnowledgeBase', checked as boolean)}
                disabled={isProcessing}
              >
                <div className="backup-restore-dialog__option-content">
                  <span className="backup-restore-dialog__option-title">知识库</span>
                  <span className="backup-restore-dialog__option-desc">包含所有目录、笔记和标签</span>
                </div>
              </Checkbox>
            </div>

            <div className="backup-restore-dialog__time-range">
              <div className="backup-restore-dialog__time-range-title">图片导出时间范围（可选）</div>
              <div className="backup-restore-dialog__time-range-row">
                <label className="backup-restore-dialog__time-range-field">
                  <span>开始时间</span>
                  <input
                    type="datetime-local"
                    value={toInputDateTime(backupOptions.timeRangeStart)}
                    disabled={isProcessing}
                    onChange={(e) => setBackupOptions(prev => ({
                      ...prev,
                      timeRangeStart: fromInputDateTime(e.target.value),
                    }))}
                  />
                </label>
                <label className="backup-restore-dialog__time-range-field">
                  <span>结束时间</span>
                  <input
                    type="datetime-local"
                    value={toInputDateTime(backupOptions.timeRangeEnd)}
                    disabled={isProcessing}
                    onChange={(e) => setBackupOptions(prev => ({
                      ...prev,
                      timeRangeEnd: fromInputDateTime(e.target.value),
                    }))}
                  />
                </label>
              </div>
            </div>

            {isProcessing && (
              <div className="backup-restore-dialog__progress">
                <Progress percentage={progress} theme="line" />
                <span className="backup-restore-dialog__progress-text">{progressMessage}</span>
              </div>
            )}

            <div className="backup-restore-dialog__actions">
              <button
                className="backup-restore-dialog__button backup-restore-dialog__button--cancel"
                onClick={handleClose}
                disabled={isProcessing}
              >
                取消
              </button>
              <button
                className="backup-restore-dialog__button backup-restore-dialog__button--primary"
                onClick={handleBackup}
                disabled={isProcessing}
              >
                {isProcessing ? '正在备份...' : '开始备份'}
              </button>
            </div>
          </div>
        )}

        {/* 恢复面板 */}
        {activeTab === 'restore' && (
          <div className="backup-restore-dialog__panel">
            <p className="backup-restore-dialog__description">
              选择备份文件进行恢复，数据将增量导入（不会覆盖现有内容）：
            </p>

            <div
              className="backup-restore-dialog__dropzone"
              onClick={handleFileSelect}
            >
              <UploadIcon className="backup-restore-dialog__dropzone-icon" />
              <span className="backup-restore-dialog__dropzone-text">
                点击选择备份文件 (.zip)
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>

            {isProcessing && (
              <div className="backup-restore-dialog__progress">
                <Progress percentage={progress} theme="line" />
                <span className="backup-restore-dialog__progress-text">{progressMessage}</span>
              </div>
            )}

            {importResult && (
              <div className="backup-restore-dialog__result">
                <h4 className="backup-restore-dialog__result-title">
                  {importResult.success ? '导入完成' : '导入完成（有错误）'}
                </h4>
                <ul className="backup-restore-dialog__result-list">
                  {(importResult.prompts.imported > 0 || importResult.prompts.skipped > 0) && (
                    <li>
                      提示词：导入 {importResult.prompts.imported} 条，跳过 {importResult.prompts.skipped} 条
                    </li>
                  )}
                  {(importResult.projects.folders > 0 || importResult.projects.boards > 0 || importResult.projects.merged > 0) && (
                    <li>
                      项目：导入 {importResult.projects.folders} 个文件夹，{importResult.projects.boards} 个画板
                      {importResult.projects.merged > 0 && `，合并 ${importResult.projects.merged} 个画板`}
                    </li>
                  )}
                  {(importResult.assets.imported > 0 || importResult.assets.skipped > 0) && (
                    <li>
                      素材：导入 {importResult.assets.imported} 个，跳过 {importResult.assets.skipped} 个
                    </li>
                  )}
                  {importResult.knowledgeBase && (importResult.knowledgeBase.notes > 0 || importResult.knowledgeBase.directories > 0) && (
                    <li>
                      知识库：导入 {importResult.knowledgeBase.directories} 个目录，{importResult.knowledgeBase.notes} 篇笔记，{importResult.knowledgeBase.tags} 个标签
                    </li>
                  )}
                  {importResult.tasks && (importResult.tasks.imported > 0 || importResult.tasks.skipped > 0) && (
                    <li>
                      任务：导入 {importResult.tasks.imported} 个，跳过 {importResult.tasks.skipped} 个
                    </li>
                  )}
                </ul>
                {importResult.errors.length > 0 && (
                  <div className="backup-restore-dialog__result-errors">
                    <strong>错误信息：</strong>
                    <ul>
                      {importResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="backup-restore-dialog__actions">
              <button
                className="backup-restore-dialog__button backup-restore-dialog__button--cancel"
                onClick={handleClose}
                disabled={isProcessing}
              >
                {importResult 
                  ? (importResult.tasks?.imported > 0 ? '完成并刷新' : '完成')
                  : '取消'}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
