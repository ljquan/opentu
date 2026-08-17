import React from 'react';
import classNames from 'classnames';
import { UserRound } from 'lucide-react';
import { HoverTip } from '../shared/hover';
import './account.scss';

export type AccountWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'expired'
  | 'revoked'
  | 'insufficient'
  | 'unavailable'
  | 'error';

export interface AccountToolbarButtonProps {
  displayName?: string | null;
  status: AccountWorkspaceStatus;
  selected?: boolean;
  onClick: () => void;
}

export function shouldShowOpenTuAccountControl(
  mode: 'embedded' | 'standalone',
  status: AccountWorkspaceStatus
): boolean {
  return !(mode === 'standalone' && status === 'unavailable');
}

function getInitial(displayName?: string | null): string {
  const normalized = displayName?.trim();
  return normalized ? normalized.slice(0, 1).toUpperCase() : '';
}

function getStatusLabel(status: AccountWorkspaceStatus): string {
  switch (status) {
    case 'ready':
      return '账户已连接';
    case 'loading':
      return '正在加载账户';
    case 'insufficient':
      return '余额不足';
    case 'expired':
      return '登录已失效';
    case 'revoked':
      return '设备授权已撤销';
    case 'error':
      return '账户加载失败';
    default:
      return '账户不可用';
  }
}

export const AccountToolbarButton: React.FC<AccountToolbarButtonProps> = ({
  displayName,
  status,
  selected = false,
  onClick,
}) => {
  const initial = getInitial(displayName);
  const statusLabel = getStatusLabel(status);

  return (
    <HoverTip content={statusLabel} placement="right" showArrow={false}>
      <button
        type="button"
        className={classNames('account-toolbar-button', {
          'account-toolbar-button--selected': selected,
          [`account-toolbar-button--${status}`]: true,
        })}
        aria-label={statusLabel}
        aria-pressed={selected}
        data-testid="toolbar-account"
        data-track="toolbar_click_account"
        onClick={onClick}
      >
        <span className="account-toolbar-button__avatar" aria-hidden="true">
          {initial || <UserRound size={17} />}
        </span>
        <span className="account-toolbar-button__status" aria-hidden="true" />
      </button>
    </HoverTip>
  );
};
