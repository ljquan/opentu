import type {
  LyricsRewriteResult,
  LyricsVersion,
  MusicAnalysisRecord,
} from './types';
import type { MusicAnalysisData } from '../../services/music-analysis-service';
import type { ModelConfig } from '../../constants/model-config';
import { createModelRef, type ModelRef } from '../../utils/settings-manager';
import { SUNO_METATAG_GUIDE } from '../../services/music-analysis-service';

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
    // noop
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

export function buildLyricsRewritePrompt(params: {
  analysis?: MusicAnalysisData | null;
  userPrompt: string;
  currentLyrics?: string;
  originalPrompt?: string;
  mode?: 'rewrite' | 'create';
}): string {
  const { analysis, userPrompt, currentLyrics, originalPrompt, mode = 'rewrite' } = params;
  const isCreateMode = mode === 'create';
  const normalizedOriginalPrompt = String(originalPrompt || '').trim();
  const normalizedUserPrompt = String(userPrompt || '').trim();
  const shouldIncludeOriginalPrompt =
    !!normalizedOriginalPrompt &&
    normalizedOriginalPrompt !== normalizedUserPrompt;

  return `你是一个擅长做“爆款音乐拆解与歌词创作”的创作助手。请基于${analysis ? '音频分析结果' : '用户要求'}${isCreateMode ? '创作一版全新歌词草稿' : '改写歌词'}，并确保输出结果可以直接用于 Suno。

${SUNO_METATAG_GUIDE}

${analysis ? `音频分析结果：\n${JSON.stringify(analysis, null, 2)}\n` : ''}

下游会把你的输出直接用于 Suno 音乐生成，因此你必须同时补齐：
- title: 适合歌曲发布与生成的标题
- styleTags: 适合 Suno 的精简风格标签
- lyricsDraft: 带结构标签、可直接粘贴到 Suno 的歌词正文

${isCreateMode ? '用户创作要求' : '用户改写要求'}：
${userPrompt || (isCreateMode ? '围绕用户描述补全一首完整、上口、可演唱的歌曲。' : '保留这首歌最抓人的情绪和节奏记忆点，重写成更容易传播的版本。')}

${shouldIncludeOriginalPrompt ? `第一步创作提示词：\n${normalizedOriginalPrompt}\n` : ''}

${currentLyrics ? `当前已有歌词草稿：\n${currentLyrics}\n` : ''}

请输出一个 JSON 对象，字段如下：
- title: 推荐歌名
- styleTags: 适合 Suno 的风格标签数组，保持精简
- lyricsDraft: 可直接粘贴到 Suno 的歌词正文，使用合适的结构标签，标签独立成行

输出要求：
1. 只返回合法 JSON，不要 markdown。
2. styleTags 中不要出现完整句子。
3. lyricsDraft 要区分结构标签与歌词正文。
4. 如果需要结构标签，优先使用 [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro] 等通用标签。
5. ${isCreateMode ? '如果用户只给了主题、情绪、乐器或人声信息，你需要主动补全合理的歌曲结构、段落推进与 hook。' : '改写时优先保留原有情绪核心、记忆点与适合传播的 hook。'}`;
}

export function isSunoLyricsModel(modelId: string): boolean {
  return /suno/i.test(modelId);
}

export function collectLyricsDraftModels(
  textModels: ModelConfig[],
  audioModels: ModelConfig[]
): ModelConfig[] {
  const sunoLyricsModels = audioModels.filter((item) => /suno/i.test(item.id));
  const mergedModels: ModelConfig[] = [];
  const seenModelKeys = new Set<string>();

  for (const model of [...textModels, ...sunoLyricsModels]) {
    const modelKey = model.selectionKey || model.id;
    if (seenModelKeys.has(modelKey)) {
      continue;
    }
    seenModelKeys.add(modelKey);
    mergedModels.push(model);
  }

  return mergedModels;
}

export function parseLyricsRewriteResult(text: string): LyricsRewriteResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('响应中未找到有效 JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]) as Partial<LyricsRewriteResult>;
  return {
    title: String(parsed.title || '').trim(),
    styleTags: Array.isArray(parsed.styleTags)
      ? parsed.styleTags.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    lyricsDraft: String(parsed.lyricsDraft || '').trim(),
  };
}

export function getDefaultRewritePrompt(
  record: MusicAnalysisRecord
): string {
  const mood = record.analysis?.mood || '原曲情绪';
  return (
    record.rewritePrompt ||
    `保留”${mood}”的感染力，强化 hook 和记忆点，输出更适合短视频传播的版本。`
  );
}

// ── 歌词版本管理 ──

const MAX_LYRICS_VERSIONS = 10;

export const ORIGINAL_VERSION_ID = 'original';

/** 从当前歌词状态创建一个版本快照 */
export function createLyricsVersion(
  record: MusicAnalysisRecord,
  label: string,
  prompt?: string
): LyricsVersion {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    label,
    prompt,
    title: record.title || '',
    styleTags: [...(record.styleTags || [])],
    lyricsDraft: record.lyricsDraft || '',
  };
}

/** 将新版本追加到记录，同时更新歌词字段 + activeVersionId，返回 patch */
export function addLyricsVersionToRecord(
  record: MusicAnalysisRecord,
  version: LyricsVersion
): Partial<MusicAnalysisRecord> {
  const versions = [version, ...(record.lyricsVersions || [])].slice(0, MAX_LYRICS_VERSIONS);
  return {
    lyricsVersions: versions,
    activeVersionId: version.id,
    title: version.title,
    styleTags: version.styleTags,
    lyricsDraft: version.lyricsDraft,
  };
}

/** 切换到指定版本，返回 record patch；版本不存在返回 null */
export function switchToLyricsVersion(
  record: MusicAnalysisRecord,
  versionId: string
): Partial<MusicAnalysisRecord> | null {
  if (versionId === ORIGINAL_VERSION_ID) {
    // 回到原始分析结果或 scratch 初始值
    const analysis = record.analysis;
    return {
      activeVersionId: ORIGINAL_VERSION_ID,
      title:
        analysis?.sunoTitle ||
        analysis?.titleSuggestions?.[0] ||
        record.creationPrompt?.slice(0, 20) ||
        '',
      styleTags:
        analysis?.sunoStyleTags?.length
          ? [...analysis.sunoStyleTags]
          : analysis?.genreTags
          ? [...analysis.genreTags]
          : [],
      lyricsDraft: analysis?.sunoLyricsDraft || '',
    };
  }
  const version = record.lyricsVersions?.find(v => v.id === versionId);
  if (!version) return null;
  return {
    activeVersionId: versionId,
    title: version.title,
    styleTags: [...version.styleTags],
    lyricsDraft: version.lyricsDraft,
  };
}
