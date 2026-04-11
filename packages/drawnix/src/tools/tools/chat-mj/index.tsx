import React from 'react';
import type { ToolPluginModule } from '../../registry';
import { ToolCategory } from '../../../types/toolbox.types';
import { MessageIcon } from '../../../components/icons';

export const chatMjTool: ToolPluginModule = {
  manifest: {
    id: 'chat-mj',
    name: 'Chat-MJ',
    description: 'ChatGPT Web 聊天界面，支持 Midjourney 绘图代理',
    icon: React.createElement(MessageIcon),
    category: ToolCategory.AI_TOOLS,
    url: 'https://vercel.ddaiai.com/#/?settings={"key":"${apiKey}","url":"https://api.tu-zi.com"}',
    defaultWidth: 1000,
    defaultHeight: 700,
    permissions: [
      'allow-scripts',
      'allow-same-origin',
      'allow-popups',
      'allow-forms',
      'allow-top-navigation-by-user-activation',
    ],
  },
};
