import type { AnalysisRecord, ProductInfo, ScriptVersion, VideoAnalysisData, VideoShot, VideoCharacter } from './types';
import { createModelRef, type ModelRef } from '../../utils/settings-manager';
import { computeSegmentPlan } from '../../utils/segment-plan';
import { getVideoModelConfig } from '../../constants/video-model-config';

/** 去除字符串末尾的中英文句号 */
function trimTrailingPeriod(s: string): string {
  return s.replace(/[。.]+$/, '');
}

/** 将镜头的多个字段融合为完整的视频生成 prompt */
export function buildVideoPrompt(
  shot: VideoShot,
  analysis?: VideoAnalysisData,
  productInfo?: ProductInfo | null,
): string {
  const description = shot.description ? trimTrailingPeriod(shot.description) : '';
  const cameraMovement = shot.camera_movement
    ? trimTrailingPeriod(shot.camera_movement)
    : '';
  const firstFramePrompt = shot.first_frame_prompt
    ? trimTrailingPeriod(shot.first_frame_prompt)
    : '';
  const lastFramePrompt = shot.last_frame_prompt
    ? trimTrailingPeriod(shot.last_frame_prompt)
    : '';
  const transitionHint = shot.transition_hint
    ? trimTrailingPeriod(shot.transition_hint)
    : '';
  const narration = shot.narration
    ? trimTrailingPeriod(shot.narration)
    : '';
  const dialogue = shot.dialogue ? trimTrailingPeriod(shot.dialogue) : '';
  const dialogueSpeakers = shot.dialogue_speakers
    ? trimTrailingPeriod(shot.dialogue_speakers)
    : '';
  const speechRelation = shot.speech_relation
    ? trimTrailingPeriod(shot.speech_relation)
    : narration && dialogue
    ? 'both'
    : narration
    ? 'narration_only'
    : dialogue
    ? 'dialogue_only'
    : 'none';
  const narrationPrompt = narration ? `旁白：${narration}` : '';
  const dialoguePrompt = dialogue
    ? dialogueSpeakers
      ? `角色对白：由${dialogueSpeakers}发言。对白内容：${dialogue}`
      : `角色对白：${dialogue}`
    : '';

  // 全局风格信息（优先使用用户编辑值）
  const styleParts: string[] = [];
  const videoStyle = productInfo?.videoStyle || analysis?.video_style;
  const bgmMood = productInfo?.bgmMood || analysis?.bgm_mood;
  if (videoStyle) styleParts.push(`画面风格：${trimTrailingPeriod(videoStyle)}`);
  if (bgmMood) styleParts.push(`BGM情绪：${trimTrailingPeriod(bgmMood)}`);

  // 角色一致性锚定：若有角色描述，在每个镜头 prompt 中注入"the same [角色描述]"
  const characterAnchor = shot.character_description
    ? `The same ${trimTrailingPeriod(shot.character_description)}`
    : '';

  const parts = [
    '请生成一个真实自然、上下文连贯的单镜头短视频',
    ...styleParts,
    characterAnchor ? `角色一致性：${characterAnchor}` : '',
    description ? `镜头主题：${description}` : '',
    narrationPrompt,
    dialoguePrompt,
    `语音关系：${speechRelation}`,
    firstFramePrompt ? `开场关键帧：${firstFramePrompt}` : '',
    lastFramePrompt ? `结束关键帧：${lastFramePrompt}` : '',
    cameraMovement ? `运镜方式：${cameraMovement}` : '',
    transitionHint ? `转场建议：${transitionHint}` : '',
    '要求主体动作连贯、时序自然、画面风格统一，避免突兀跳变与闪烁',
  ].filter(Boolean);

  return parts.join('。');
}

/** 为图片生成 prompt 添加全局风格前缀 */
export function buildFramePrompt(
  shotPrompt: string,
  analysis?: VideoAnalysisData,
  productInfo?: ProductInfo | null,
): string {
  const videoStyle = productInfo?.videoStyle || analysis?.video_style;
  if (!videoStyle || !shotPrompt) return shotPrompt;
  return `${trimTrailingPeriod(videoStyle)}。${shotPrompt}`;
}

export function buildScriptRewritePrompt(params: {
  recordAnalysis: VideoAnalysisData;
  productInfo: ProductInfo;
  videoModel: string;
  characterDescription?: string;
  characters?: VideoCharacter[];
}): string {
  const { recordAnalysis, productInfo, videoModel, characterDescription, characters } = params;
  const hasCharacters = (characters && characters.length > 0) || !!characterDescription;
  const originalShots = JSON.stringify(recordAnalysis.shots.map(s => ({
    id: s.id,
    label: s.label,
    type: s.type,
    startTime: s.startTime,
    endTime: s.endTime,
    duration: s.duration,
    description: s.description,
    narration: s.narration,
    dialogue: s.dialogue || '',
    dialogue_speakers: s.dialogue_speakers,
    speech_relation: s.speech_relation || 'none',
    first_frame_prompt: s.first_frame_prompt,
    last_frame_prompt: s.last_frame_prompt,
    camera_movement: s.camera_movement,
    character_ids: s.character_ids || [],
  })));

  const cfg = getVideoModelConfig(videoModel);
  const selectedSegmentDuration =
    productInfo.segmentDuration ||
    parseInt(cfg.defaultDuration, 10) ||
    8;
  const singleOption = [
    { label: `${selectedSegmentDuration}秒`, value: String(selectedSegmentDuration) },
  ];
  const targetDur = productInfo.targetDuration || recordAnalysis.totalDuration;
  const segmentPlan = computeSegmentPlan(targetDur, singleOption);
  const { segments, actualTotal, isFixed, overflow } = segmentPlan;
  const segmentCount = segments.length;

  const durationInfo = isFixed
    ? `当前视频模型（${videoModel}）为固定时长模型，每段固定 ${segments[0]} 秒。
实际可用视频总时长：${actualTotal} 秒（${segmentCount} 段 × ${segments[0]} 秒/段）${overflow > 0 ? `，比目标 ${targetDur} 秒多出 ${overflow} 秒` : ''}。
请按 ${actualTotal} 秒总时长分配内容节奏。`
    : `目标视频总时长：${targetDur} 秒。
分段方案：${segments.map((d, i) => `第${i + 1}段 ${d}s`).join('、')}，实际总时长 ${actualTotal} 秒。
每个镜头的 duration 必须等于对应段的可用时长。`;

  return `你是一个短视频脚本改编专家。请基于以下原始视频脚本，改编脚本。

原始视频信息：
- 总时长：${recordAnalysis.totalDuration}秒
- 风格：${recordAnalysis.video_style || '未知'}
- BGM 情绪：${recordAnalysis.bgm_mood || '未知'}
- 画面比例：${recordAnalysis.aspect_ratio || '16x9'}
${hasCharacters && characters && characters.length > 0 ? `
角色信息（改编时必须保持角色外貌一致）：
${characters.map(c => `- ${c.id}（${c.name}）：${c.description}`).join('\n')}
` : ''}
原始镜头脚本：
${originalShots}

用户提示词：
${productInfo.prompt || '未指定'}

视频生成约束：
- 使用的视频模型：${videoModel}
- ${durationInfo}
- 需要 ${segmentCount} 个视频片段拼接成完整视频

改编要求（所有字段必须使用与用户提示词相同的语言）：
1. **description（画面描述）**：根据用户提示词”${productInfo.prompt || ''}”改编画面内容，详细描述场景、人物、动作、光线、色调${characterDescription ? `；若画面中有角色，必须保持角色描述与”${characterDescription}”一致` : ''}
2. **narration（旁白）**：画外音/解说词，无旁白则为空字符串
3. **dialogue（角色说话）**：角色台词，无角色说话则为空字符串；多角色请按”角色名: 台词”分行输出
4. **dialogue_speakers（对白角色）**：单角色填角色名，多角色用”角色A|角色B”按发言顺序列出；无对白填空字符串
5. **speech_relation（旁白与对白关系）**：必须是 'none' | 'narration_only' | 'dialogue_only' | 'both' 之一，并与 narration/dialogue 是否为空严格一致
6. **first_frame_prompt（首帧图片提示词）**：用于生成镜头开场画面，需精确描述主体位置、动作起始状态、构图、光线与背景${hasCharacters ? `；若该镜头有角色（character_ids 非空），必须在 prompt 中包含对应角色的完整外貌描述` : ''}
7. **last_frame_prompt（尾帧图片提示词）**：用于生成镜头结尾画面，需精确描述主体位置、动作定格状态、构图、光线与背景${hasCharacters ? `；若该镜头有角色（character_ids 非空），必须在 prompt 中包含对应角色的完整外貌描述` : ''}
8. **camera_movement（运镜方式）**：根据新内容适当调整
9. **character_ids（角色 ID 列表）**：保留原镜头的 character_ids，若改编后该镜头不再涉及角色则设为空数组 []
${characterDescription ? `10. **character_description（角色描述）**：所有镜头统一填写”${characterDescription}”，不得修改` : ''}

拼接衔接要求（极其重要！）：
1. 视觉锚点：相邻镜头之间必须有一个共同的视觉元素（同一商品、同一场景、同一手部动作），确保画面连贯
2. 运镜方向延续：如果一个镜头结尾是向右平移(pan right)，下一个镜头开头应继续向右或保持静止，不能突然反向
3. 色调一致性：所有镜头统一使用相同的色调和光线风格
4. 动作连贯：如果一个镜头结尾主体正在做某个动作，下一个镜头开头要延续这个动作

每个镜头的额外输出字段：
- **transition_hint**：到下一个镜头的转场方式，从 'cut'(硬切)、'dissolve'(交叉溶解)、'match_cut'(匹配切)、'fade_to_black'(淡出到黑) 中选择。同场景内推荐 'cut'，跨场景推荐 'dissolve'，最后一个镜头设为 'fade_to_black'

重要：所有字段的值必须使用与用户提示词相同的语言，保持语言一致性。

返回一个 JSON 数组，每个元素包含：id、startTime、endTime、duration、description、narration、dialogue、dialogue_speakers、speech_relation、first_frame_prompt、last_frame_prompt、camera_movement、label、type、transition_hint、character_ids${characterDescription ? '、character_description' : ''} 字段。
只返回 JSON 数组，不要 markdown 格式。`;
}

export function parseRewriteShotUpdates(text: string): Array<Partial<VideoShot> & { id: string }> {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as Array<Partial<VideoShot> & { id: string }>;
    } catch {
      // JSON 被截断，尝试提取已完成的对象
    }
  }

  // 逐个提取完整的 JSON 对象（应对 AI 输出被截断的情况）
  const objects: Array<Partial<VideoShot> & { id: string }> = [];
  const objectPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && typeof obj === 'object' && obj.id) {
        objects.push(obj);
      }
    } catch {
      // 跳过不完整的对象
    }
  }

  if (objects.length > 0) return objects;
  throw new Error('响应中未找到有效 JSON（可能因输出过长被截断）');
}

export function applyRewriteShotUpdates(
  currentShots: VideoShot[],
  updates: Array<Partial<VideoShot> & { id: string }>
): VideoShot[] {
  if (updates.length > 0 && updates[0].startTime !== undefined) {
    return updates.map((update, index) => ({
      ...(currentShots.find(shot => shot.id === update.id) || currentShots[index] || {}),
      ...update,
      id: update.id || `shot_${index + 1}`,
    })) as VideoShot[];
  }

  return currentShots.map(shot => {
    const update = updates.find(item => item.id === shot.id);
    return update ? { ...shot, ...update } : shot;
  });
}

export function readStoredModelSelection(
  key: string,
  fallbackModel: string
): { modelId: string; modelRef: ModelRef | null } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { modelId: fallbackModel, modelRef: null };
    }

    const parsed = JSON.parse(raw) as {
      modelId?: string;
      profileId?: string | null;
    };

    if (typeof parsed.modelId === 'string' && parsed.modelId.trim()) {
      return {
        modelId: parsed.modelId.trim(),
        modelRef: createModelRef(parsed.profileId || null, parsed.modelId),
      };
    }
  } catch {
    // 兼容旧格式：直接存储 modelId 字符串
  }

  return {
    modelId: localStorage.getItem(key) || fallbackModel,
    modelRef: null,
  };
}

export function writeStoredModelSelection(
  key: string,
  modelId: string,
  modelRef?: ModelRef | null
): void {
  localStorage.setItem(
    key,
    JSON.stringify({
      modelId,
      profileId: modelRef?.profileId || null,
    })
  );
}

// ── 脚本版本管理 ──

const MAX_SCRIPT_VERSIONS = 10;

/** 从当前 shots 创建一个版本快照 */
export function createScriptVersion(
  shots: VideoShot[],
  label: string,
  prompt?: string
): ScriptVersion {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    label,
    prompt,
    shots: structuredClone(shots),
  };
}

/** 将新版本追加到记录，同时更新 editedShots + activeVersionId，返回 patch */
export function addVersionToRecord(
  record: AnalysisRecord,
  version: ScriptVersion
): Partial<AnalysisRecord> {
  const versions = [version, ...(record.scriptVersions || [])].slice(0, MAX_SCRIPT_VERSIONS);
  return {
    scriptVersions: versions,
    activeVersionId: version.id,
    editedShots: version.shots,
  };
}

/** 原始分析版本的特殊 ID */
export const ORIGINAL_VERSION_ID = 'original';

/** 切换到指定版本，返回 record patch；版本不存在返回 null */
export function switchToVersion(
  record: AnalysisRecord,
  versionId: string
): Partial<AnalysisRecord> | null {
  if (versionId === ORIGINAL_VERSION_ID) {
    return {
      activeVersionId: ORIGINAL_VERSION_ID,
      editedShots: [...record.analysis.shots],
    };
  }
  const version = record.scriptVersions?.find(v => v.id === versionId);
  if (!version) return null;
  return {
    activeVersionId: versionId,
    editedShots: version.shots,
  };
}

/** 更新 editedShots 时同步更新 scriptVersions 中活跃版本的 shots */
export function updateActiveShotsInRecord(
  record: AnalysisRecord,
  updatedShots: VideoShot[]
): Partial<AnalysisRecord> {
  const patch: Partial<AnalysisRecord> = { editedShots: updatedShots };
  if (record.activeVersionId && record.scriptVersions) {
    patch.scriptVersions = record.scriptVersions.map(v =>
      v.id === record.activeVersionId ? { ...v, shots: updatedShots } : v
    );
  }
  return patch;
}
