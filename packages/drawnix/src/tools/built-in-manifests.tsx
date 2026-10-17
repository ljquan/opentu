import React from 'react';
import { History } from 'lucide-react';
import { BookOpenIcon } from '../components/icons';
import { ToolCategory, type ToolDefinition } from '../types/toolbox.types';

export const BUILT_IN_TOOL_MANIFESTS: ToolDefinition[] = [
  {
    id: 'prompt-history',
    name: '我的提示词',
    description: '按任务分类管理初始提示词、发送提示词和生成结果预览',
    icon: <History size={18} strokeWidth={1.75} />,
    category: ToolCategory.CONTENT_TOOLS,
    component: 'prompt-history',
    defaultWidth: 1120,
    defaultHeight: 680,
  },
  {
    id: 'knowledge-base',
    name: '知识库',
    description: '个人知识管理工具，支持目录分类、标签管理和 Markdown 编辑',
    icon: React.createElement(BookOpenIcon),
    category: ToolCategory.UTILITIES,
    component: 'knowledge-base',
    defaultWidth: 900,
    defaultHeight: 700,
  },
];
