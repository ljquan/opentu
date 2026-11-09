import type { ImageGenerationRequest } from './types';

/** Add transport-only hints without changing the prompt stored on the task. */
export function buildImageRequestPrompt(
  request: Pick<ImageGenerationRequest, 'prompt' | 'background' | 'params'>,
  gif = false,
  gifAspectRatio?: string
): string {
  const hints = [
    ...(gif && gifAspectRatio ? [`GIF 每帧画面比例：${gifAspectRatio}`] : []),
    ...((request.background || request.params?.background) === 'transparent'
      ? ['透明图']
      : []),
    ...(gif ? ['生成 GIF 图'] : []),
  ];
  let prompt = request.prompt;
  for (const hint of hints) {
    if (!prompt.split(/\r?\n/).some((line) => line.trim() === hint)) {
      prompt = `${prompt.trimEnd()}\n${hint}`;
    }
  }
  return prompt;
}
