import { getMediaTypeForTool, type MediaModelType } from '../../services/agent/media-model-routing';

export type SkillOutputType = 'image' | 'text' | 'video' | 'audio' | 'ppt';
export type SkillMediaType = MediaModelType;

export interface SkillMediaLike {
  id?: string;
  name?: string;
  mcpTool?: string;
  outputType?: SkillOutputType;
  description?: string;
  content?: string;
}

const MEDIA_TYPE_ORDER: SkillMediaType[] = ['image', 'video', 'audio'];

export function normalizeSkillOutputType(
  outputType?: SkillOutputType | null
): SkillMediaType | undefined {
  if (outputType === 'image' || outputType === 'video' || outputType === 'audio') {
    return outputType;
  }

  return undefined;
}

export function inferSkillMediaTypes(skill?: SkillMediaLike | null): SkillMediaType[] {
  if (!skill) {
    return [];
  }

  if (skill.mcpTool === 'generate_ppt_explainer_video') {
    return ['image', 'video', 'audio'];
  }

  const outputMediaType = normalizeSkillOutputType(skill.outputType);
  if (outputMediaType) {
    return [outputMediaType];
  }

  if (skill.outputType === 'text') {
    return [];
  }

  const detected = new Set<SkillMediaType>();
  const directToolType = getMediaTypeForTool(skill.mcpTool);
  if (directToolType) {
    detected.add(directToolType);
  }

  const searchableText = [
    skill.id,
    skill.name,
    skill.description,
    skill.content,
  ]
    .filter(Boolean)
    .join('\n');

  if (searchableText) {
    for (const mediaType of MEDIA_TYPE_ORDER) {
      const toolNames = getMediaToolNames(mediaType);
      if (toolNames.some((toolName) => searchableText.includes(toolName))) {
        detected.add(mediaType);
      }
    }
  }

  return MEDIA_TYPE_ORDER.filter((mediaType) => detected.has(mediaType));
}

function getMediaToolNames(mediaType: SkillMediaType): string[] {
  switch (mediaType) {
    case 'image':
      return [
        'generate_image',
        'generate_grid_image',
        'generate_photo_wall',
        'generate_inspiration_board',
        'generate_ppt_explainer_video',
      ];
    case 'video':
      return [
        'generate_video',
        'generate_long_video',
        'generate_ppt_explainer_video',
      ];
    case 'audio':
      return ['generate_audio', 'generate_ppt_explainer_video'];
  }
}
