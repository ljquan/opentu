/**
 * 爆款MV生成器 - 工具函数
 */

import type { MVRecord, StoryboardVersion, VideoShot, VideoCharacter } from './types';
import { computeSegmentPlan } from '../../utils/segment-plan';
import { getVideoModelConfig } from '../../constants/video-model-config';

// ── 分镜版本管理 ──

const MAX_STORYBOARD_VERSIONS = 10;

export function createStoryboardVersion(
  shots: VideoShot[],
  label: string,
  prompt?: string
): StoryboardVersion {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    label,
    prompt,
    shots: structuredClone(shots),
  };
}

export function addStoryboardVersionToRecord(
  record: MVRecord,
  version: StoryboardVersion
): Partial<MVRecord> {
  const versions = [version, ...(record.storyboardVersions || [])].slice(
    0,
    MAX_STORYBOARD_VERSIONS
  );
  return {
    storyboardVersions: versions,
    activeVersionId: version.id,
    editedShots: version.shots,
  };
}

export const ORIGINAL_VERSION_ID = 'original';

export function switchToVersion(
  record: MVRecord,
  versionId: string
): Partial<MVRecord> | null {
  if (versionId === ORIGINAL_VERSION_ID) {
    const firstVersion = record.storyboardVersions?.[record.storyboardVersions.length - 1];
    return firstVersion
      ? { activeVersionId: ORIGINAL_VERSION_ID, editedShots: [...firstVersion.shots] }
      : null;
  }
  const version = record.storyboardVersions?.find(v => v.id === versionId);
  if (!version) return null;
  return {
    activeVersionId: versionId,
    editedShots: version.shots,
  };
}

export function updateActiveShotsInRecord(
  record: MVRecord,
  updatedShots: VideoShot[]
): Partial<MVRecord> {
  const patch: Partial<MVRecord> = { editedShots: updatedShots };
  if (record.activeVersionId && record.storyboardVersions) {
    patch.storyboardVersions = record.storyboardVersions.map(v =>
      v.id === record.activeVersionId ? { ...v, shots: updatedShots } : v
    );
  }
  return patch;
}

// ── AI 分镜 Prompt ──

export function buildStoryboardPrompt(params: {
  creationPrompt: string;
  musicTitle?: string;
  musicStyleTags?: string[];
  musicLyrics?: string;
  clipDuration: number;
  videoModel: string;
  segmentDuration?: number;
  aspectRatio?: string;
  videoStyle?: string;
  hasAudio?: boolean;
}): string {
  const {
    creationPrompt,
    musicTitle,
    musicStyleTags,
    musicLyrics,
    clipDuration,
    videoModel,
    segmentDuration,
    aspectRatio,
    videoStyle,
    hasAudio,
  } = params;

  const cfg = getVideoModelConfig(videoModel);
  const selectedDuration = segmentDuration || parseInt(cfg.defaultDuration, 10) || 8;
  const singleOption = [{ label: `${selectedDuration}秒`, value: String(selectedDuration) }];
  const plan = computeSegmentPlan(clipDuration, singleOption);
  const { segments, actualTotal, isFixed, overflow } = plan;
  const segmentCount = segments.length;

  const durationInfo = isFixed
    ? `视频模型（${videoModel}）为固定时长模型，每段固定 ${segments[0]} 秒。实际总时长：${actualTotal} 秒（${segmentCount} 段）${overflow > 0 ? `，比音乐时长 ${clipDuration} 秒多出 ${overflow} 秒` : ''}。`
    : `分段方案：${segments.map((d, i) => `第${i + 1}段 ${d}s`).join('、')}，实际总时长 ${actualTotal} 秒。`;

  const musicInfo = [
    musicTitle ? `- 标题：${musicTitle}` : '',
    musicStyleTags?.length ? `- 风格标签：${musicStyleTags.join(', ')}` : '',
    `- 时长：${clipDuration}秒`,
    musicLyrics ? `- 歌词：\n${musicLyrics}` : '',
  ].filter(Boolean).join('\n');

  const audioInstruction = hasAudio
    ? `
⚠️ 重要：本次请求附带了音频文件。你必须先完整听完这段音乐，基于你听到的实际节奏、节拍、情绪变化来编排分镜，而不是仅凭歌词文本猜测。

第一步：音频分析（必须基于你听到的音乐）
- 听完整段音乐，标记关键时间节点：前奏结束时间、主歌开始/结束、副歌开始/结束、间奏、尾奏等
- 识别节拍变化：哪里节奏加快、哪里放缓、哪里有停顿或重音
- 识别情绪曲线：铺垫→推进→高潮→回落的精确时间点
- 如果有歌词，标注每句歌词对应的实际演唱时间`
    : `
第一步：歌词结构分析
- 将歌词按段落划分（Intro/Verse/Pre-Chorus/Chorus/Bridge/Outro 等）
- 估算每个段落在 ${clipDuration} 秒音乐中的大致时间位置
- 识别情绪曲线：哪里是铺垫、哪里是高潮、哪里是收尾`;

  return `你是一个专业的 MV 分镜导演。请根据音乐和创意描述，规划一组视频分镜脚本。

音乐信息：
${musicInfo}

创意描述：
${creationPrompt}

视频生成约束：
- 视频模型：${videoModel}
- ${durationInfo}
- 需要 ${segmentCount} 个视频片段
- 画面比例：${aspectRatio || '16x9'}
${videoStyle ? `- 画面风格：${videoStyle}` : ''}

角色提取要求（极其重要！）：
1. 分析创意描述中涉及的角色（人物、动物等有外貌特征的主体），无角色则 characters 为空数组
2. 为每个角色生成：id（"char_1", "char_2"...）、name（展示名）、description（英文外貌描述，包含发型、服装、体型、肤色等，可直接用于文生图）
3. 每个镜头标注 character_ids（该镜头涉及的角色 ID 列表，无角色则为空数组）
4. first_frame_prompt 和 last_frame_prompt 中若有角色，必须包含对应角色的完整外貌描述

分镜规划步骤（请严格按顺序执行）：
${audioInstruction}

第二步：时间轴对齐
- 将 ${segmentCount} 个视频片段（${segments.map((d, i) => `第${i + 1}段=${d}s`).join('、')}）映射到音乐时间轴上
- 每个镜头的切换点必须对齐音乐的节奏变化点（段落切换、节拍重音、情绪转折）
- 不允许镜头内容与音乐时间错位（例如：副歌在 30s 开始，对应镜头不能放在 10s）

第三步：逐镜头编排
- 每个镜头的 description 必须体现该时间段音乐的情感和节奏
- 前奏/无歌词段：氛围铺垫（环境、光影、空镜），节奏跟随音乐律动
- 主歌段：叙事性画面，运镜节奏匹配音乐节拍
- 副歌段：情绪爆发，运镜更强烈，色彩更饱满，剪辑节奏加快
- 间奏段：转折或留白，可用特写或抽象画面
- 尾奏段：情绪回落，运镜放缓，呼应开场

分镜格式要求：
1. 每个镜头的 duration 必须等于对应段的时长：${segments.map((d, i) => `第${i + 1}段=${d}s`).join('、')}
2. startTime 从 0 开始，每个镜头的 startTime = 上一个镜头的 endTime
3. 镜头之间要有视觉连贯性（共同视觉元素、运镜方向延续、色调一致）
4. 所有字段使用与创意描述相同的语言

每个镜头输出字段：
- id: 镜头ID（如 "shot_1"）
- startTime: 开始时间（秒）
- endTime: 结束时间（秒）
- duration: 时长（秒）
- label: 镜头标签（如"前奏 0:00-0:08"、"主歌A 0:08-0:16"），标注时间范围和对应歌词片段
- type: 镜头类型（opening/scene/detail/cta/other）
- description: 画面描述（详细描述场景、人物、动作、光线、色调，必须与该时间段的音乐节奏和歌词内容呼应）
- narration: 旁白（MV 通常为空字符串）
- camera_movement: 运镜方式（必须匹配该段音乐的节奏感）
- first_frame_prompt: 首帧图片提示词（精确描述主体位置、动作起始状态、构图、光线与背景；若该镜头有角色，必须包含对应角色的完整外貌描述）
- last_frame_prompt: 尾帧图片提示词（精确描述主体位置、动作定格状态、构图、光线与背景；若该镜头有角色，必须包含对应角色的完整外貌描述）
- transition_hint: 转场方式（cut/dissolve/match_cut/fade_to_black）
- character_ids: 该镜头涉及的角色 ID 列表（无角色则为空数组 []）

返回 JSON 对象（不要 markdown 格式），格式如下：
{
  "characters": [
    { "id": "char_1", "name": "角色名", "description": "English appearance description for text-to-image" }
  ],
  "shots": [ ...镜头数组... ]
}`;
}

// ── AI 脚本改编 Prompt ──

export function buildMVScriptRewritePrompt(params: {
  record: MVRecord;
  currentShots: VideoShot[];
  rewritePrompt: string;
  videoModel: string;
  segmentDuration?: number;
  videoStyle?: string;
}): string {
  const { record, currentShots, rewritePrompt, videoModel, segmentDuration, videoStyle } = params;
  const clipDuration = record.selectedClipDuration || 30;
  const characters = record.characters || [];
  const hasCharacters = characters.length > 0;

  const cfg = getVideoModelConfig(videoModel);
  const selectedDuration = segmentDuration || parseInt(cfg.defaultDuration, 10) || 8;
  const singleOption = [{ label: `${selectedDuration}秒`, value: String(selectedDuration) }];
  const plan = computeSegmentPlan(clipDuration, singleOption);
  const { segments, actualTotal, isFixed, overflow } = plan;
  const segmentCount = segments.length;

  const durationInfo = isFixed
    ? `视频模型（${videoModel}）为固定时长模型，每段固定 ${segments[0]} 秒。实际总时长：${actualTotal} 秒（${segmentCount} 段）${overflow > 0 ? `，比音乐时长 ${clipDuration} 秒多出 ${overflow} 秒` : ''}。`
    : `分段方案：${segments.map((d, i) => `第${i + 1}段 ${d}s`).join('、')}，实际总时长 ${actualTotal} 秒。`;

  const musicInfo = [
    record.musicTitle ? `- 标题：${record.musicTitle}` : '',
    record.musicStyleTags?.length ? `- 风格标签：${record.musicStyleTags.join(', ')}` : '',
    `- 时长：${clipDuration}秒`,
    record.musicLyrics ? `- 歌词：\n${record.musicLyrics}` : '',
  ].filter(Boolean).join('\n');

  const shotsJson = JSON.stringify(currentShots.map(s => ({
    id: s.id, label: s.label, type: s.type,
    startTime: s.startTime, endTime: s.endTime, duration: s.duration,
    description: s.description, narration: s.narration || '',
    first_frame_prompt: s.first_frame_prompt, last_frame_prompt: s.last_frame_prompt,
    camera_movement: s.camera_movement, character_ids: s.character_ids || [],
  })));

  const effectiveStyle = videoStyle || record.videoStyle || '';

  return `你是一个专业的 MV 脚本改编专家。请基于以下 MV 分镜脚本，根据用户提示词进行改编。

音乐信息：
${musicInfo}

创意描述：
${record.creationPrompt || ''}
${effectiveStyle ? `\n画面风格：${effectiveStyle}` : ''}
${hasCharacters ? `
当前角色信息：
${characters.map((c: VideoCharacter) => `- ${c.id}（${c.name}）：${c.description}`).join('\n')}
` : ''}
当前分镜脚本：
${shotsJson}
${rewritePrompt ? `\n用户改编提示词：\n${rewritePrompt}` : ''}

视频生成约束：
- 视频模型：${videoModel}
- ${durationInfo}
- 需要 ${segmentCount} 个视频片段

改编要求（所有字段必须使用与用户提示词相同的语言）：
1. description（画面描述）：根据用户提示词改编画面内容，必须与该时间段的音乐节奏和歌词内容呼应${effectiveStyle ? `，画面风格统一为"${effectiveStyle}"` : ''}
2. narration（旁白）：MV 通常为空字符串
3. first_frame_prompt（首帧图片提示词）：精确描述主体位置、动作起始状态、构图、光线与背景${hasCharacters ? '；若该镜头有角色，必须包含对应角色的完整外貌描述' : ''}
4. last_frame_prompt（尾帧图片提示词）：精确描述主体位置、动作定格状态、构图、光线与背景${hasCharacters ? '；若该镜头有角色，必须包含对应角色的完整外貌描述' : ''}
5. camera_movement（运镜方式）：根据新内容和音乐节奏适当调整
6. character_ids（角色 ID 列表）：保留或调整角色出场

角色调整规则（极其重要！）：
- 如果用户提示词要求修改角色（如更换性别、年龄、外貌、服装等），必须在 characters 数组中更新对应角色的 description
- 如果用户提示词要求新增角色，在 characters 数组中添加新角色（id 格式 "char_N"）
- 如果用户提示词要求删除角色，从 characters 数组中移除，并清理相关镜头的 character_ids
- 角色的 description 必须是英文外貌描述，可直接用于文生图

拼接衔接要求：
1. 相邻镜头之间必须有共同的视觉元素，确保画面连贯
2. 运镜方向延续，不能突然反向
3. 所有镜头统一色调和光线风格
4. 动作连贯，上一镜头结尾动作延续到下一镜头开头

返回 JSON 对象（不要 markdown 格式），格式如下：
{
  "characters": [
    { "id": "char_1", "name": "角色名", "description": "English appearance description for text-to-image" }
  ],
  "shots": [ ...镜头数组，每个元素包含 id、startTime、endTime、duration、description、narration、first_frame_prompt、last_frame_prompt、camera_movement、label、type、transition_hint、character_ids 字段... ]
}`;
}
