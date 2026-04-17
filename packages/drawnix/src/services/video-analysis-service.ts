import type { MCPResult } from '../mcp/types';
import {
  type ModelRef,
} from '../utils/settings-manager';
import { callGoogleGenerateContentWithLog } from '../utils/gemini-api/logged-calls';
import type { GeminiMessage } from '../utils/gemini-api/types';
import { buildGenerateContentConfig, extractJsonObjects } from './analysis-core';

export type VideoShotType = 'opening' | 'product' | 'detail' | 'scene' | 'cta' | 'other';
export type TransitionHint = 'cut' | 'dissolve' | 'match_cut' | 'fade_to_black';

export interface VideoShot {
  id: string;
  startTime: number;
  endTime: number;
  description: string;
  type: VideoShotType;
  label: string;
  narration?: string;
  dialogue?: string;
  dialogue_speakers?: string;
  speech_relation?: 'none' | 'narration_only' | 'dialogue_only' | 'both';
  first_frame_prompt?: string;
  last_frame_prompt?: string;
  camera_movement?: string;
  duration?: number;
  transition_hint?: TransitionHint;
  generated_first_frame_url?: string;
  generated_last_frame_url?: string;
  generated_video_url?: string;
}

export interface VideoAnalysisData {
  totalDuration: number;
  productExposureDuration: number;
  productExposureRatio: number;
  shotCount: number;
  firstProductAppearance: number;
  suggestion: string;
  video_style?: string;
  bgm_mood?: string;
  aspect_ratio?: string;
  shots: VideoShot[];
}

export interface VideoAnalyzeParams {
  videoData?: string;
  mimeType?: string;
  youtubeUrl?: string;
  videoCacheUrl?: string;
  prompt?: string;
  model?: string;
  modelRef?: ModelRef | null;
  taskLabel?: string;
  videoAnalyzerSource?: 'upload' | 'youtube';
  videoAnalyzerSourceLabel?: string;
  videoAnalyzerSourceSnapshot?: Record<string, unknown>;
}

export const DEFAULT_ANALYSIS_PROMPT = `请逐帧分析这个视频，并提供结构化的拆解。
我需要一个包含以下字段的JSON响应：
- totalDuration: 视频总时长（秒）
- productExposureDuration: 产品露出时长（秒）
- productExposureRatio: 产品露出占比（0-100）
- shotCount: 镜头总数
- firstProductAppearance: 产品首次出现的时间（秒）
- aspect_ratio: 视频画面比例，从以下选项中选择最接近的：'16x9'（横屏）、'9x16'（竖屏）、'1x1'（方形）
- video_style: 整体视频风格。描述光影、色调、美术风格。
- bgm_mood: 背景音乐情绪。
- suggestion: 优化建议
- shots: 镜头详细信息数组，每个对象包含：
  - id: 唯一标识符
  - startTime: 开始时间（秒）
  - endTime: 结束时间（秒）
  - duration: 该镜头时长（秒），等于 endTime - startTime
  - description: 画面描述，包含视觉主体、动作/状态、场景环境、屏幕文字
  - first_frame_prompt: 首帧图片生成提示词，强调本镜头起始瞬间的构图、主体位置、光线、背景细节
  - last_frame_prompt: 尾帧图片生成提示词，强调本镜头结束瞬间的构图、主体位置、动作定格、背景细节
  - camera_movement: 运镜方式
  - type: 'opening' | 'product' | 'detail' | 'scene' | 'cta'
  - label: 标签（例如”开场口播”、”产品展示”）
  - narration: 旁白内容（画外音/解说词），无旁白则为空字符串
  - dialogue: 角色说话内容，无角色对白则为空字符串；多角色时按”角色名: 台词”逐行输出
  - dialogue_speakers: 对白角色标识。单角色时填角色名；多角色用”角色A|角色B”按发言顺序列出；无对白填空字符串
  - speech_relation: 旁白与角色说话关系，必须是 'none' | 'narration_only' | 'dialogue_only' | 'both' 之一
  - transition_hint: 到下一个镜头的转场建议，从 'cut'(硬切)、'dissolve'(交叉溶解)、'match_cut'(匹配切)、'fade_to_black'(淡出到黑) 中选择，最后一个镜头设为 'fade_to_black'

输出要求：
1. 只返回有效的JSON对象，不要包含markdown格式。
2. first_frame_prompt 与 last_frame_prompt 必须可直接用于文生图模型，信息完整、语言自然、可视化强。
3. 若存在 narration 则 narration 必须是画外音，不要把角色口播写进 narration；若存在 dialogue 则必须包含角色归属（角色名）。
4. 当 narration 与 dialogue 同时存在时，speech_relation 必须是 'both'；只存在其一时必须与字段一致；都不存在则为 'none'。
5. 所有字段统一使用同一种语言输出，语言与视频中的口播/文字语言保持一致。
`;

export async function executeVideoAnalysis(
  params: VideoAnalyzeParams
): Promise<MCPResult> {
  const { videoData, mimeType, youtubeUrl, prompt, model, modelRef } = params;

  if (!videoData && !youtubeUrl) {
    return {
      success: false,
      error: '需要提供 videoData 或 youtubeUrl',
      type: 'error',
    };
  }

  try {
    const analysisPrompt = prompt || DEFAULT_ANALYSIS_PROMPT;
    const messages: GeminiMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
          videoData
            ? { type: 'inline_data', mimeType: mimeType || 'video/mp4', data: videoData }
            : { type: 'file_uri', fileUri: youtubeUrl! },
        ],
      },
    ];

    const config = await buildGenerateContentConfig(model, modelRef);
    const response = await callGoogleGenerateContentWithLog(
      config,
      messages,
      { stream: false },
      { taskType: 'video', prompt: analysisPrompt }
    );

    const text = response.choices?.[0]?.message?.content;
    if (!text) {
      return { success: false, error: 'API 未返回有效响应', type: 'error' };
    }

    const jsonObjects = extractJsonObjects(text);
    if (jsonObjects.length === 0) {
      return { success: false, error: '响应中未找到有效 JSON', type: 'error' };
    }

    let analysis: VideoAnalysisData | null = null;
    for (const jsonStr of jsonObjects) {
      try {
        const parsed = JSON.parse(jsonStr) as VideoAnalysisData;
        if (parsed.shots && (!analysis || parsed.shots.length > analysis.shots.length)) {
          analysis = parsed;
        }
      } catch {
        // noop
      }
    }

    if (!analysis) {
      return { success: false, error: '响应中未找到有效的分析数据', type: 'error' };
    }

    return {
      success: true,
      data: { analysis },
      type: 'text',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '视频分析失败',
      type: 'error',
    };
  }
}
