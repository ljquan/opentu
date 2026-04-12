# Change: update audio playback speed control

## Why
当前悬浮播放控件和音乐播放器工具缺少统一的播放速度入口，语音朗读的语速又单独存在于设置面板，导致用户无法在播放时直接调整速度，也容易出现播放控件与设置值不一致的问题。

## What Changes
- 为悬浮播放控件和音乐播放器工具新增统一的播放速度入口
- 在共享播放服务中增加普通音频与语音朗读的独立速率状态
- 让语音朗读速率与设置中的 `tts.rate` 双向同步

## Impact
- Affected specs: `canvas-audio-playback`
- Affected code:
  - `packages/drawnix/src/services/canvas-audio-playback-service.ts`
  - `packages/drawnix/src/components/audio-node-element/CanvasAudioPlayer.tsx`
  - `packages/drawnix/src/tools/tools/music-player/MusicPlayerTool.tsx`
