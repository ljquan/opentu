/**
 * 视频拆解器内部类型定义
 */

import type { VideoAnalysisData, VideoShot } from '../../mcp/tools/video-analyze';

export type { VideoAnalysisData, VideoShot };

/** 页面标识 */
export type PageId = 'analyze' | 'script' | 'generate' | 'history';

/** 商品信息 */
export interface ProductInfo {
  name: string;
  category: string;
  sellingPoints: string;
  /** 目标视频时长（秒），默认为原视频时长 */
  targetDuration?: number;
  /** 视频生成模型 ID */
  videoModel?: string;
}

/** 分析记录（持久化到 IndexedDB） */
export interface AnalysisRecord {
  id: string;
  createdAt: number;
  source: 'upload' | 'youtube';
  sourceLabel: string;
  model: string;
  analysis: VideoAnalysisData;
  /** 用户编辑后的脚本 */
  editedShots?: VideoShot[];
  /** 商品信息 */
  productInfo?: ProductInfo;
  /** 关联的生成任务 batchId */
  batchId?: string;
  /** 是否收藏 */
  starred: boolean;
}

/** 镜头类型颜色映射 */
export const SHOT_TYPE_COLORS: Record<string, string> = {
  opening: '#3B82F6',
  product: '#F59E0B',
  detail: '#8B5CF6',
  scene: '#10B981',
  cta: '#EF4444',
  other: '#6B7280',
};

/** aspect_ratio → 视频尺寸 */
export function aspectRatioToVideoSize(ratio?: string): string {
  switch (ratio) {
    case '9x16': return '720x1280';
    case '1x1': return '1024x1024';
    default: return '1280x720';
  }
}

/** 将镜头列表格式化为完整的 Markdown 脚本（用于插入画布） */
export function formatShotsMarkdown(
  shots: VideoShot[],
  analysis: VideoAnalysisData,
  productInfo?: ProductInfo | null
): string {
  const shotsMd = shots.map((s, i) => {
    const lines = [
      `### ${i + 1}. ${s.label} (${s.startTime}s-${s.endTime}s)`,
      ``,
      `**画面描述：** ${s.description || '-'}`,
      ``,
      `**文案：** ${s.script || '-'}`,
      s.camera_movement ? `\n**运镜：** ${s.camera_movement}` : '',
      s.visual_prompt ? `\n**图片 Prompt：** ${s.visual_prompt}` : '',
      s.video_prompt ? `\n**视频 Prompt：** ${s.video_prompt}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }).join('\n\n---\n\n');

  const headerParts = [`# 视频脚本`];
  if (productInfo?.name) headerParts.push(`\n**商品：** ${productInfo.name}`);
  if (productInfo?.category) headerParts.push(` | **品类：** ${productInfo.category}`);
  if (productInfo?.sellingPoints) headerParts.push(` | **卖点：** ${productInfo.sellingPoints}`);
  const dur = productInfo?.targetDuration || analysis.totalDuration;
  headerParts.push(`\n**时长：** ${dur}s | **画面比例：** ${analysis.aspect_ratio || '16x9'}`);
  if (analysis.video_style) headerParts.push(` | **风格：** ${analysis.video_style}`);
  if (analysis.bgm_mood) headerParts.push(` | **BGM：** ${analysis.bgm_mood}`);
  if (analysis.suggestion) headerParts.push(`\n\n> ${analysis.suggestion}`);

  return `${headerParts.join('')}\n\n${shotsMd}`;
}
