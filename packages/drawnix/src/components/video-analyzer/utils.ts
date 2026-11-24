import type {
  AnalysisRecord,
  ProductInfo,
  ScriptVersion,
  VideoAnalysisData,
  VideoShot,
  VideoCharacter,
} from './types';
import { generateUUID } from '../../utils/runtime-helpers';
import { computeSegmentPlan } from '../../utils/segment-plan';
import {
  collectJsonObjects,
  extractJsonArray,
  extractJsonObject,
} from '../../utils/llm-json-extractor';
import { getVideoModelConfig } from '../../constants/video-model-config';
import {
  DEFAULT_ORIGINAL_VERSION_ID,
  appendVersionToRecord,
  switchVersionInRecord,
} from '../shared/workflow/versioned-record';
import {
  buildCharacterReferencePrompt,
  buildVideoReferenceImageDescriptions,
  buildVideoPrompt,
  buildFramePrompt,
} from '../shared/workflow/prompt-builders';
import {
  formatCreativeBriefPromptBlock,
  type CreativeBrief,
} from '../shared/workflow/creative-brief';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
} from '../shared/workflow/model-selection-storage';
import { updateActiveVersionShotsInRecord } from '../shared/workflow/versioned-shots';

export {
  buildVideoPrompt,
  buildFramePrompt,
  buildCharacterReferencePrompt,
  buildVideoReferenceImageDescriptions,
};
export { readStoredModelSelection, writeStoredModelSelection };

const ORIGINAL_CONTENT_GUARDRAIL =
  '原创性与合规要求：若用户输入、PDF 或上下文包含知名影视、动画、游戏、音乐、品牌、角色、商标、Logo、台词、歌词或受保护作品名称，不要复刻或仿写，不要使用原名称、标志性造型、独特服装、台词、歌词、镜头或世界观；请改写为原创的泛化角色、场景、音乐情绪和视觉元素，并保持商业可用。';

function toNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function buildVideoPromptGenerationPrompt(params: {
  userPrompt: string;
  pdfAttachmentName?: string;
  creativeBrief?: CreativeBrief | null;
  videoStyle?: string;
  videoModel?: string;
  targetDuration?: number;
  segmentDuration?: number;
}): string {
  const userPrompt = String(params.userPrompt || '').trim();
  const pdfAttachmentName = String(params.pdfAttachmentName || '').trim();
  const videoStyle = String(params.videoStyle || '').trim();
  const videoModel = String(params.videoModel || '').trim();
  const targetDuration = Number(params.targetDuration);
  const segmentDuration = Number(params.segmentDuration);
  const creativeBriefSection = formatCreativeBriefPromptBlock(
    params.creativeBrief,
    'popular_video'
  );
  const hasTargetDuration =
    Number.isFinite(targetDuration) && targetDuration > 0;
  const hasSegmentDuration =
    Number.isFinite(segmentDuration) && segmentDuration > 0;
  const segmentPlan =
    hasTargetDuration && hasSegmentDuration
      ? computeSegmentPlan(targetDuration, [
          { label: `${segmentDuration}秒`, value: String(segmentDuration) },
        ])
      : null;
  const videoParameterLines = [
    videoStyle ? `- 画面风格：${videoStyle}` : '',
    videoModel ? `- 视频模型：${videoModel}` : '',
    hasTargetDuration
      ? `- 目标视频总时长：${targetDuration} 秒`
      : '',
    hasSegmentDuration
      ? `- 单段视频时长：${segmentDuration} 秒；每个镜头都应能作为一个独立视频片段生成，shots[].duration 必须等于 ${segmentDuration}，totalDuration 必须等于 shotCount × ${segmentDuration}`
      : '',
    segmentPlan
      ? `- 分段规划：建议生成 ${segmentPlan.segments.length} 个镜头，实际总时长 ${segmentPlan.actualTotal} 秒${
          segmentPlan.overflow > 0
            ? `（比目标多 ${parseFloat(segmentPlan.overflow.toFixed(2))} 秒）`
            : ''
        }，内容节奏按实际总时长分配`
      : '',
  ].filter(Boolean);
  const videoParameterSection =
    videoParameterLines.length > 0
      ? `视频生成参数：\n${videoParameterLines.join('\n')}\n`
      : '';
  const contextSources = [
    '用户提示词',
    ...(creativeBriefSection ? ['专业创作 Brief'] : []),
    ...(videoParameterSection ? ['画面风格与视频参数'] : []),
    ...(pdfAttachmentName ? ['参考 PDF'] : []),
  ].join('、');
  const pdfSection = pdfAttachmentName
    ? [
        `参考 PDF：本次请求附带 PDF「${pdfAttachmentName}」。`,
        '- 请优先阅读 PDF 内容，提取品牌/产品定位、受众、卖点、事实信息、视觉线索和禁忌边界。',
        '- 用户提示词用于限定目标、风格和取舍；PDF 是主要上下文之一。若两者冲突，以用户提示词为准。',
        '- 不要复述 PDF 原文，要重组为适合短视频生成的镜头脚本。',
      ].join('\n')
    : '';

  return `你是爆款短视频脚本策划和视频生成提示词工程师。请根据${contextSources}，直接规划一个可进入视频生成流程的 VideoAnalysisData 兼容结构化短视频脚本，并只返回合法 JSON。

用户提示词：
${userPrompt || '围绕一个适合短视频传播的主题，策划一条完整视频。'}

${creativeBriefSection ? `${creativeBriefSection}\n` : ''}
${videoParameterSection ? `${videoParameterSection}\n` : ''}
${pdfSection ? `${pdfSection}\n` : ''}
${ORIGINAL_CONTENT_GUARDRAIL}

JSON 字段要求：
- totalDuration: 计划视频总时长（秒）
- productExposureDuration: 产品/主题核心露出时长（秒），没有具体产品时按核心主题出现时长估算
- productExposureRatio: 核心露出占比（0-100）
- shotCount: 镜头总数
- firstProductAppearance: 核心产品/主题首次出现时间（秒）
- aspect_ratio: 从 '16x9'、'9x16'、'1x1' 中选择最适合的平台比例
- video_style: 整体视频风格，包含光影、色调、美术风格
- bgm_mood: 背景音乐情绪
- suggestion: 后续生成建议
- characters: 固定角色列表，无角色则返回 []。每个角色包含 id、name、description，其中 description 必须是英文外貌描述
- shots: 镜头数组，每个镜头包含 id、startTime、endTime、duration、description、first_frame_prompt、last_frame_prompt、camera_movement、type、label、narration、dialogue、dialogue_speakers、speech_relation、transition_hint、character_ids；last_frame_prompt 允许为空字符串

规划要求：
1. 结构必须兼容视频分析结果，shots 的时间轴必须连续，duration 等于 endTime - startTime。
2. first_frame_prompt 必须可直接用于文生图模型，写清主体、构图、动作起始状态、光线、背景和必要文字；每个镜头必须写入本镜头独有的视觉锚点（动作阶段、主体位置、角色关系、道具状态、镜头角度或情绪节奏），避免不同片段只复用相同场景/角色/风格描述；若镜头包含角色，必须写入对应 characters[].description 中的同一人物身份、发型、脸部特征、体型、年龄感、完整服装款式、服装颜色、材质和配饰，不得重新设计衣服。
3. 用户提示词、PDF、创作 Brief 中的故事情节、相似案例、相似剧情和歌词意象只作为背景与风格参考；不要在 first_frame_prompt、last_frame_prompt 或 suggestion 中复述相似剧情，首尾帧必须服务当前镜头独有动作、构图和角色/参考图一致性。
4. narration 是画外音；dialogue 是角色台词。speech_relation 必须与 narration/dialogue 是否为空一致。
5. 相邻镜头要有可拼接的短视觉锚点、动作趋势或转场提示，不要把上一段剧情经过写进下一段 prompt。
6. 所有可读内容使用与用户提示词相同的语言；characters[].description 使用英文。
7. 若提供画面风格，video_style、description、first_frame_prompt、非空 last_frame_prompt 必须共同继承该风格，不要只写在总字段里；全局风格只能作为背景约束，不能覆盖每个镜头自己的核心动作和构图差异。
8. 若提供目标总时长、视频模型或单段时长，镜头数量、时间轴和每个镜头 prompt 必须服务于后续逐段生成，避免超长单镜头、复杂多场景同镜头和不可执行的跳切。
9. 视频模型单段通常只有 8-15 秒；若一个连续动作/场景超过单段时长，必须拆成多个连续 shots。连续拆分时，第 N+1 段的 first_frame_prompt 只描述当前段起始画面，可包含第 N 段结尾的短视觉锚点（主体位置、动作瞬间、光线方向），不要写上一段剧情经过；第 N 段 last_frame_prompt 应留空字符串；只有最后一段、非连续转场、明确需要独立结束定格时才填写 last_frame_prompt。
10. 不要为了字段完整强行生成尾帧提示词；没有独立尾帧需求时填 ""。
11. 非空 last_frame_prompt 若包含角色，必须沿用同一个 character_ids 对应角色的完整身份和服装锚点；只改变本镜头结尾姿态、表情、动作定格、构图、光线或背景，不得写下一镜头剧情，不得换脸、换发型、换衣服颜色或新增无关人物。
12. suggestion 只写稳定生成约束：风格、角色一致性、画幅、参考图使用、片段差异化锚点、生成禁忌和执行策略；不要写故事复盘、相邻剧情、剧情续写或“把 A 改成 B”这类编辑命令。
13. 只返回 JSON，不要 markdown。`;
}

export function parseVideoPromptGenerationResponse(
  text: string
): VideoAnalysisData {
  const parsed = extractJsonObject<Partial<VideoAnalysisData>>(
    text,
    value => Array.isArray((value as Partial<VideoAnalysisData>).shots)
  );
  const rawShots = Array.isArray(parsed.shots) ? parsed.shots : [];
  if (rawShots.length === 0) {
    throw new Error('响应中未找到有效镜头数据');
  }

  const shots = rawShots.map((shot, index) => {
    const fallbackStart =
      index === 0 ? 0 : toNumber(rawShots[index - 1]?.endTime, index * 5);
    const startTime = toNumber(shot.startTime, fallbackStart);
    const endTime = toNumber(shot.endTime, startTime + toNumber(shot.duration, 5));
    return {
      ...shot,
      id: String(shot.id || `shot_${index + 1}`),
      startTime,
      endTime,
      duration: toNumber(shot.duration, Math.max(0, endTime - startTime)),
      type: shot.type || 'scene',
      label: String(shot.label || `镜头 ${index + 1}`),
      description: String(shot.description || ''),
      narration: String(shot.narration || ''),
      dialogue: String(shot.dialogue || ''),
      dialogue_speakers: String(shot.dialogue_speakers || ''),
      speech_relation: shot.speech_relation || 'none',
      character_ids: Array.isArray(shot.character_ids) ? shot.character_ids : [],
    } as VideoShot;
  });
  const totalDuration = toNumber(
    parsed.totalDuration,
    shots[shots.length - 1]?.endTime || shots.length * 5
  );

  return {
    totalDuration,
    productExposureDuration: toNumber(parsed.productExposureDuration, totalDuration),
    productExposureRatio: toNumber(parsed.productExposureRatio, 100),
    shotCount: toNumber(parsed.shotCount, shots.length),
    firstProductAppearance: toNumber(parsed.firstProductAppearance, 0),
    suggestion: String(parsed.suggestion || ''),
    video_style: parsed.video_style,
    bgm_mood: parsed.bgm_mood,
    aspect_ratio: parsed.aspect_ratio || '9x16',
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    shots,
  };
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

${ORIGINAL_CONTENT_GUARDRAIL}

${formatCreativeBriefPromptBlock(productInfo.creativeBrief, 'popular_video')}

视频生成约束：
- 使用的视频模型：${videoModel}
- ${durationInfo}
- 需要 ${segmentCount} 个视频片段拼接成完整视频
${productInfo.videoStyle ? `- 画面风格：${productInfo.videoStyle}` : ''}
${productInfo.bgmMood ? `- BGM 情绪：${productInfo.bgmMood}` : ''}

改编要求（所有字段必须使用与用户提示词相同的语言）：
1. **description（画面描述）**：根据用户提示词”${productInfo.prompt || ''}”改编画面内容，详细描述场景、人物、动作、光线、色调${productInfo.videoStyle ? `，整体画面风格必须统一为”${productInfo.videoStyle}”` : ''}${characterDescription ? `；若画面中有角色，必须保持角色描述与”${characterDescription}”一致` : ''}
2. **narration（旁白）**：画外音/解说词，无旁白则为空字符串
3. **dialogue（角色说话）**：角色台词，无角色说话则为空字符串；多角色请按”角色名: 台词”分行输出
4. **dialogue_speakers（对白角色）**：单角色填角色名，多角色用”角色A|角色B”按发言顺序列出；无对白填空字符串
5. **speech_relation（旁白与对白关系）**：必须是 'none' | 'narration_only' | 'dialogue_only' | 'both' 之一，并与 narration/dialogue 是否为空严格一致
6. **first_frame_prompt（首帧图片提示词）**：用于生成镜头开场画面，需精确描述主体位置、动作起始状态、构图、光线与背景，并写入本镜头独有的视觉锚点、差异化动作起点、构图角度和角色关系，避免只复用同一角色外貌、同一场景和同一泛化风格${productInfo.videoStyle ? `，并写入画面风格”${productInfo.videoStyle}”` : ''}${hasCharacters ? `；若该镜头有角色（character_ids 非空），必须在 prompt 中包含对应角色的完整外貌描述，并明确沿用同一人物身份、脸型五官、发型、体型、年龄感、完整服装款式、服装颜色、材质和配饰，不得重新设计衣服` : ''}
7. **last_frame_prompt（尾帧图片提示词，可为空）**：只有该镜头必须独立生成结尾关键帧时才填写，需精确描述主体位置、动作定格状态、构图、光线与背景${productInfo.videoStyle ? `，并写入画面风格”${productInfo.videoStyle}”` : ''}${hasCharacters ? `；若该镜头有角色（character_ids 非空），必须在 prompt 中包含对应角色的完整外貌与服装锚点，和首帧保持同一人物、同一发型、同一套衣服、同一配饰，只改变结尾姿态、表情、动作、镜头角度或环境` : ''}；若下一段的首帧自然就是本段尾帧，则本字段填空字符串
8. **camera_movement（运镜方式）**：根据新内容适当调整
9. **character_ids（角色 ID 列表）**：根据改编后的角色出场重新设置；若改编后该镜头不再涉及角色则设为空数组 []
10. **characters（角色列表）**：如果用户提示词或原创性要求导致角色外貌、身份、服装、物种、数量发生变化，必须同步更新 characters 数组；如果不再需要角色，返回空数组 []
11. **suggestion（生成建议）**：必须根据改编后的最终脚本重写，用于第3步首帧/视频生成；只写稳定生成约束：风格、角色一致性、画幅、参考图使用、片段差异化锚点、生成禁忌和执行策略；不要写故事复盘、相邻剧情、剧情续写，不要复述“用户提示词/改编指令”本身
12. **bgm_mood（BGM 情绪）**：根据改编后的剧情节奏同步更新，不要沿用与新脚本不匹配的旧 BGM
13. **video_style（画面风格）**：根据改编后的视觉方向同步更新；如果用户指定了画面风格，则以用户指定为准
${characterDescription ? `14. **character_description（角色描述）**：所有镜头统一填写”${characterDescription}”，不得修改` : ''}

步骤衔接要求：
- 第3步生成首帧/视频时不会继续读取“用户提示词”原文；必须把用户改编意图落实到 description、first_frame_prompt、必要时的 last_frame_prompt、characters、video_style、bgm_mood 和 suggestion 中。
- 用户提示词中的故事情节、相似案例或相似剧情只用于理解改编方向，不要原样搬进 suggestion、first_frame_prompt 或 last_frame_prompt；每个镜头优先执行当前镜头任务、角色一致性和首尾关键帧画面。
- suggestion 只服务第3步生成稳定性，不要写成“把 A 改成 B”这类编辑命令。
- 改编后逐镜头检查 first_frame_prompt，不得高度相似；相邻镜头可以共享连续性元素，但必须有清晰不同的动作阶段、构图或角色关系。

拼接衔接要求（极其重要！）：
1. 视觉锚点：相邻镜头之间必须有一个共同的视觉元素（同一商品、同一场景、同一手部动作），确保画面连贯
2. 运镜方向延续：如果一个镜头结尾是向右平移(pan right)，下一个镜头开头应继续向右或保持静止，不能突然反向
3. 色调一致性：所有镜头统一使用相同的色调和光线风格
4. 动作连贯：如果一个镜头结尾主体正在做某个动作，下一个镜头开头要延续这个动作
5. 单段视频模型通常只能生成 8-15 秒；连续超过单段时长的内容应拆成多个连续片段。下一段 first_frame_prompt 只描述当前段起始画面，可包含上一段结尾的短视觉锚点（主体位置、动作瞬间、光线方向），不要写上一段剧情经过；此时上一段 last_frame_prompt 必须留空字符串，生成页会直接复用下一段首帧作为上一段尾帧。
6. 只有最后一段、非连续转场、明确需要独立结束定格或与下一段首帧不一致时，才填写 last_frame_prompt；不要为每段都强行生成尾帧图，非空尾帧只写本镜头结束画面，不写下一镜头剧情。

每个镜头的额外输出字段：
- **transition_hint**：到下一个镜头的转场方式，从 'cut'(硬切)、'dissolve'(交叉溶解)、'match_cut'(匹配切)、'fade_to_black'(淡出到黑) 中选择。同场景内推荐 'cut'，跨场景推荐 'dissolve'，最后一个镜头设为 'fade_to_black'

重要：所有字段的值必须使用与用户提示词相同的语言，保持语言一致性。

返回一个 JSON 对象，不要 markdown 格式，格式如下：
{
  "video_style": "改编后的整体画面风格",
  "bgm_mood": "改编后的 BGM 情绪",
  "suggestion": "给第3步生成首帧和视频使用的稳定生成建议",
  "characters": [
    { "id": "char_1", "name": "角色名", "description": "English appearance description for text-to-image" }
  ],
  "shots": [
    { "id": "shot_1", "startTime": 0, "endTime": 8, "duration": 8, "description": "...", "narration": "", "dialogue": "", "dialogue_speakers": "", "speech_relation": "none", "first_frame_prompt": "...", "last_frame_prompt": "", "camera_movement": "...", "label": "...", "type": "scene", "transition_hint": "cut", "character_ids": [] }
  ]
}`;
}

export interface ScriptRewriteParseResult {
  shots: VideoShot[];
  characters?: VideoCharacter[];
  hasCharacters: boolean;
  videoStyle?: string;
  bgmMood?: string;
  suggestion?: string;
}

export function parseRewriteShotUpdates(text: string): Array<Partial<VideoShot> & { id: string }> {
  try {
    return extractJsonArray<Partial<VideoShot> & { id: string }>(
      text,
      value => Array.isArray(value) && value.some(item => item && typeof item === 'object')
    );
  } catch {
    // JSON 被截断或混入思考文本，尝试提取已完成的对象
  }

  const objects = collectJsonObjects<Partial<VideoShot> & { id: string }>(
    text,
    value => !!(value as Partial<VideoShot>).id
  );
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

export function parseScriptRewriteResponse(
  text: string,
  currentShots: VideoShot[]
): ScriptRewriteParseResult {
  try {
    const parsed = extractJsonObject<{
      shots?: Array<Partial<VideoShot> & { id: string }>;
      editedShots?: Array<Partial<VideoShot> & { id: string }>;
      characters?: VideoCharacter[];
      video_style?: string;
      videoStyle?: string;
      bgm_mood?: string;
      bgmMood?: string;
      suggestion?: string;
    }>(text, value => {
      const candidate = value as {
        shots?: unknown;
        editedShots?: unknown;
      };
      return Array.isArray(candidate.shots) || Array.isArray(candidate.editedShots);
    });
    const rawShots = Array.isArray(parsed.shots)
      ? parsed.shots
      : Array.isArray(parsed.editedShots)
      ? parsed.editedShots
      : null;
    if (rawShots) {
      return {
        shots: applyRewriteShotUpdates(currentShots, rawShots),
        characters: Array.isArray(parsed.characters) ? parsed.characters : undefined,
        hasCharacters: Object.prototype.hasOwnProperty.call(parsed, 'characters'),
        videoStyle: String(parsed.video_style || parsed.videoStyle || '').trim() || undefined,
        bgmMood: String(parsed.bgm_mood || parsed.bgmMood || '').trim() || undefined,
        suggestion: String(parsed.suggestion || '').trim() || undefined,
      };
    }
  } catch {
    // Fall back to the legacy array-only contract.
  }

  return {
    shots: applyRewriteShotUpdates(currentShots, parseRewriteShotUpdates(text)),
    hasCharacters: false,
  };
}

// ── 脚本版本管理 ──

const MAX_SCRIPT_VERSIONS = 10;

/** 从当前 shots 创建一个版本快照 */
export function createScriptVersion(
  shots: VideoShot[],
  label: string,
  prompt?: string,
  snapshot?: {
    characters?: VideoCharacter[];
    productInfo?: ProductInfo;
  }
): ScriptVersion {
  return {
    id: generateUUID(),
    createdAt: Date.now(),
    label,
    prompt,
    shots: structuredClone(shots),
    ...(snapshot?.characters ? { characters: structuredClone(snapshot.characters) } : {}),
    ...(snapshot?.productInfo ? { productInfo: structuredClone(snapshot.productInfo) } : {}),
  };
}

/** 将新版本追加到记录，同时更新 editedShots + activeVersionId，返回 patch */
export function addVersionToRecord(
  record: AnalysisRecord,
  version: ScriptVersion
): Partial<AnalysisRecord> {
  return appendVersionToRecord(record, 'scriptVersions', version, MAX_SCRIPT_VERSIONS, {
    editedShots: version.shots,
  });
}

/** 原始分析版本的特殊 ID */
export const ORIGINAL_VERSION_ID = DEFAULT_ORIGINAL_VERSION_ID;

/** 切换到指定版本，返回 record patch；版本不存在返回 null */
export function switchToVersion(
  record: AnalysisRecord,
  versionId: string
): Partial<AnalysisRecord> | null {
  return switchVersionInRecord(record, 'scriptVersions', versionId, {
    getVersionPatch: (version) => ({
      editedShots: version.shots,
      ...(version.characters ? { characters: structuredClone(version.characters) } : {}),
      ...(version.productInfo ? { productInfo: structuredClone(version.productInfo) } : {}),
    }),
    getOriginalPatch: () => ({
      editedShots: [...record.analysis.shots],
    }),
    originalVersionId: ORIGINAL_VERSION_ID,
  });
}

/** 更新 editedShots 时同步更新 scriptVersions 中活跃版本的 shots */
export function updateActiveShotsInRecord(
  record: AnalysisRecord,
  updatedShots: VideoShot[]
): Partial<AnalysisRecord> {
  return updateActiveVersionShotsInRecord(record, 'scriptVersions', updatedShots);
}
