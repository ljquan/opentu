import React from 'react';
import type { ToolPluginModule } from '../../registry';
import { ToolCategory } from '../../../types/toolbox.types';
import { Music4 } from 'lucide-react';
import { MusicPlayerTool } from './MusicPlayerTool';
import { MUSIC_PLAYER_TOOL_ID } from '../../tool-ids';

export const MusicPlayerToolComponent = MusicPlayerTool;

export const musicPlayerTool: ToolPluginModule = {
  manifest: {
    id: MUSIC_PLAYER_TOOL_ID,
    name: '音乐播放器',
    description: '从素材库选择音频并后台播放，可与画布播放控件联动',
    icon: <Music4 size={18} strokeWidth={1.75} />,
    category: ToolCategory.UTILITIES,
    component: 'music-player',
    defaultWidth: 520,
    defaultHeight: 640,
  },
  Component: MusicPlayerToolComponent,
};
