/**
 * SessionList Component
 *
 * Displays a list of chat sessions with new session button.
 */

import React, { useCallback } from 'react';
import { AddIcon } from 'tdesign-icons-react';
import { SessionItem } from './SessionItem';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import type { SessionListProps, ChatSession } from '../../types/chat.types';

export const SessionList: React.FC<SessionListProps> = React.memo(
  ({ sessions, activeSessionId, onSelectSession, onNewSession, onDeleteSession, onRenameSession }) => {
    const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

    const handleSelect = useCallback(
      (sessionId: string) => {
        onSelectSession(sessionId);
      },
      [onSelectSession]
    );

    const handleDeleteClick = useCallback((sessionId: string) => {
      setPendingDeleteId(sessionId);
    }, []);

    const handleDeleteConfirm = useCallback(() => {
      if (pendingDeleteId) {
        onDeleteSession(pendingDeleteId);
        setPendingDeleteId(null);
      }
    }, [pendingDeleteId, onDeleteSession]);

    const handleDeleteCancel = useCallback(() => {
      setPendingDeleteId(null);
    }, []);

    const handleRename = useCallback(
      (sessionId: string, newTitle: string) => {
        onRenameSession(sessionId, newTitle);
      },
      [onRenameSession]
    );

    return (
      <div className="session-list">
        <div className="session-list__header">
          <span className="session-list__title">会话列表</span>
          <button
            className="session-list__new-btn"
            data-track="chat_click_session_new"
            onClick={onNewSession}
            aria-label="新建会话"
          >
            <AddIcon size={14} />
            <span>新建</span>
          </button>
        </div>
        <div className="session-list__items">
          {sessions.length === 0 ? (
            <div className="session-list__empty">暂无会话</div>
          ) : (
            sessions.map((session: ChatSession) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => handleSelect(session.id)}
                onDelete={() => handleDeleteClick(session.id)}
                onRename={(newTitle) => handleRename(session.id, newTitle)}
              />
            ))
          )}
        </div>

        <ConfirmDialog
          open={pendingDeleteId !== null}
          title="删除会话"
          description="确定删除此会话吗？删除后无法恢复。"
          confirmText="删除"
          cancelText="取消"
          danger
          onOpenChange={(open) => {
            if (!open) {
              handleDeleteCancel();
            }
          }}
          onConfirm={handleDeleteConfirm}
        />
      </div>
    );
  }
);

SessionList.displayName = 'SessionList';
