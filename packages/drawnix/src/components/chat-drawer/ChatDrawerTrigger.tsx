/**
 * ChatDrawerTrigger Component
 *
 * Button to toggle the chat drawer open/closed.
 */

import React from 'react';

import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import { ChevronLeftIcon } from 'tdesign-icons-react';
import { HoverTip } from '../shared';

interface ChatDrawerTriggerProps {
  isOpen: boolean;
  onClick: () => void;
  drawerWidth?: number;
}

export const ChatDrawerTrigger: React.FC<ChatDrawerTriggerProps> = React.memo(
  ({ isOpen, onClick, drawerWidth }) => {
    // 抽屉打开时跟随抽屉左缘；工具栏贴右时，抽屉和关闭态把手都避开工具栏
    const style: React.CSSProperties = {
      right:
        isOpen && drawerWidth
          ? `calc(var(--aitu-toolbar-right-dock-width, 0px) + ${
              drawerWidth - 18
            }px)`
          : 'var(--aitu-toolbar-right-dock-width, 0px)',
    };

    return (
      <HoverTip content={isOpen ? '收起对话' : '展开对话'}>
        <button
          className={`chat-drawer-trigger ${ATTACHED_ELEMENT_CLASS_NAME} ${
            isOpen ? 'chat-drawer-trigger--active' : ''
          }`}
          data-track={
            isOpen ? 'chat_click_drawer_close' : 'chat_click_drawer_open'
          }
          onClick={onClick}
          aria-label={isOpen ? '收起对话' : '展开对话'}
          aria-expanded={isOpen}
          style={style}
        >
          <ChevronLeftIcon size={16} className="chat-drawer-trigger__icon" />
        </button>
      </HoverTip>
    );
  }
);

ChatDrawerTrigger.displayName = 'ChatDrawerTrigger';
