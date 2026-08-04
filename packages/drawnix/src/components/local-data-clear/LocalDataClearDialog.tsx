import React from 'react';
import { Input, MessagePlugin, Radio } from 'tdesign-react';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import {
  localDataClearService,
  type LocalDataClearMode,
  type LocalDataClearRisk,
} from '../../services/local-data-clear-service';
import './local-data-clear-dialog.scss';

const STRONG_CONFIRM_TEXT = '确认清除';

export interface LocalDataClearDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reloadPage?: () => void;
}

function formatRiskDescription(risk: LocalDataClearRisk): string {
  const details: string[] = [];
  if (risk.activeTaskCount > 0) {
    details.push(`${risk.activeTaskCount} 个活动任务`);
  }
  if (risk.activeWorkflowCount > 0) {
    details.push(`${risk.activeWorkflowCount} 个运行中工作流`);
  }
  if (risk.hasPendingSync) {
    details.push('未同步到远端的本地变更');
  }
  return details.join('、');
}

function isSameRisk(
  current: LocalDataClearRisk | null,
  latest: LocalDataClearRisk
): boolean {
  return (
    current?.activeTaskCount === latest.activeTaskCount &&
    current.activeWorkflowCount === latest.activeWorkflowCount &&
    current.hasPendingSync === latest.hasPendingSync
  );
}

export const LocalDataClearDialog: React.FC<LocalDataClearDialogProps> = ({
  open,
  onOpenChange,
  reloadPage = () => window.location.reload(),
}) => {
  const [mode, setMode] = React.useState<LocalDataClearMode>('cache');
  const [risk, setRisk] = React.useState<LocalDataClearRisk | null>(null);
  const [confirmText, setConfirmText] = React.useState('');
  const clearingRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    setMode('cache');
    setConfirmText('');
    clearingRef.current = false;
    setRisk(localDataClearService.getRisk());
  }, [open]);

  const requiresStrongConfirmation = mode === 'all';
  const confirmDisabled =
    requiresStrongConfirmation && confirmText !== STRONG_CONFIRM_TEXT;

  const handleConfirm = async () => {
    if (clearingRef.current) {
      return;
    }

    clearingRef.current = true;
    try {
      if (mode === 'all') {
        const latestRisk = localDataClearService.getRisk();
        if (!isSameRisk(risk, latestRisk)) {
          setRisk(latestRisk);
          setConfirmText('');
          await MessagePlugin.warning('本地状态已变化，请重新输入“确认清除”');
          return;
        }
      }
      await localDataClearService.clear(mode);
      reloadPage();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '清理失败，请稍后重试';
      await MessagePlugin.error(`清理失败：${message}`);
    } finally {
      clearingRef.current = false;
    }
  };

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && clearingRef.current) {
        return;
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const riskDescription = risk ? formatRiskDescription(risk) : '';

  return (
    <ConfirmDialog
      open={open}
      title="清理网站数据"
      description="选择需要清理的本地数据范围。清理成功后会刷新当前页面。"
      confirmText={mode === 'cache' ? '清除缓存' : '清除全部本地数据'}
      confirmTheme={mode === 'all' ? 'danger' : 'primary'}
      confirmDisabled={confirmDisabled}
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      className="local-data-clear-dialog"
    >
      <Radio.Group
        className="local-data-clear-dialog__modes"
        value={mode}
        onChange={(value) => {
          const nextMode = value as LocalDataClearMode;
          setMode(nextMode);
          setConfirmText('');
          if (nextMode === 'all') {
            setRisk(localDataClearService.getRisk());
          }
        }}
      >
        <Radio value="cache" className="local-data-clear-dialog__mode">
          <span>
            <strong>仅清除缓存</strong>
            <small>清除图片、媒体和头像缓存，不删除生成记录或本地文件。</small>
          </span>
        </Radio>
        <Radio
          value="all"
          className="local-data-clear-dialog__mode local-data-clear-dialog__mode--danger"
        >
          <span>
            <strong>清除全部本地数据</strong>
            <small>
              清除生成记录、聊天历史、素材和本地画板。主题、语言、模型配置和登录状态会保留。
            </small>
          </span>
        </Radio>
      </Radio.Group>

      {mode === 'all' ? (
        <div className="local-data-clear-dialog__warning" role="alert">
          全部本地数据清除后无法在本机恢复，正在运行或未同步的内容也会被放弃。已同步到远端的内容可能会在刷新后再次同步。
        </div>
      ) : null}

      {requiresStrongConfirmation ? (
        <div className="local-data-clear-dialog__strong-confirm">
          <p>
            {risk?.requiresStrongConfirmation
              ? `检测到${riskDescription || '尚未完成的本地内容'}。`
              : '本地生成记录和文件将被永久删除。'}
            请输入
            <strong>{STRONG_CONFIRM_TEXT}</strong> 后继续：
          </p>
          <Input
            value={confirmText}
            onChange={(value) => setConfirmText(value as string)}
            placeholder={`输入“${STRONG_CONFIRM_TEXT}”`}
            data-testid="local-data-clear-confirm-input"
          />
        </div>
      ) : null}
    </ConfirmDialog>
  );
};
