/**
 * PPT 生成 MCP 工具
 *
 * 功能：根据用户主题，调用 AI 生成结构化 PPT 大纲，然后自动创建多个 PPT Frame 并填充整页图片提示词。
 *
 * 工作流程：
 * 1. 调用文本模型生成 PPT 大纲 JSON
 * 2. 逐页创建 Frame（1920x1080）并横向排列
 * 3. 将整页图片提示词存储到 Frame 的 pptMeta 扩展属性中
 * 4. 聚焦视口到第一个 Frame
 * 5. 展开 PPT 编辑并切换到大纲视图，等待用户确认后再批量生图
 */

import type { MCPTool, MCPResult, MCPExecuteOptions } from '../types';
import type { PlaitBoard, PlaitElement, Point } from '@plait/core';
import {
  Transforms,
  BoardTransforms,
  PlaitBoard as PlaitBoardUtils,
  RectangleClient,
} from '@plait/core';
import { getBoard } from './shared';
import { FrameTransforms } from '../../plugins/with-frame';
import { PlaitFrame, isFrameElement } from '../../types/frame.types';
import { defaultGeminiClient } from '../../utils/gemini-api';
import { geminiSettings } from '../../utils/settings-manager';
import type { GeminiMessage } from '../../utils/gemini-api/types';
import {
  appendImagePartsToLastUserMessage,
  buildImagePartsFromUrls,
} from '../../utils/gemini-api/message-utils';
import {
  getTextBindingMaxImageCount,
  resolveInvocationPlanFromRoute,
  supportsTextBindingImageInput,
} from '../../services/provider-routing';
import { analytics } from '../../utils/posthog-analytics';
import {
  type PPTGenerationParams,
  type PPTOutline,
  type PPTPageSpec,
  type PPTFrameMeta,
  generateOutlineSystemPrompt,
  generateOutlineUserPrompt,
  generateSlideImagePrompt,
  formatPPTCommonPrompt,
  normalizePPTReferenceImages,
  parseOutlineResponse,
  PPT_FRAME_WIDTH,
  PPT_FRAME_HEIGHT,
  calcPPTFrameInsertionStartPosition,
  getPPTFrameGridPositions,
  loadPPTFrameLayoutColumns,
  requestOpenPPTEditor,
} from '../../services/ppt';

function isPPTFrame(
  element: PlaitElement
): element is PlaitFrame & { pptMeta: PPTFrameMeta } {
  return (
    isFrameElement(element) && !!(element as { pptMeta?: unknown }).pptMeta
  );
}

function collectReferencedPPTElementIds(frame: PlaitFrame): string[] {
  const pptMeta = (frame as PlaitFrame & { pptMeta?: PPTFrameMeta }).pptMeta;
  if (!pptMeta) return [];

  return [
    pptMeta.slideImageElementId,
    ...(pptMeta.slideImageHistory || []).map((item) => item.elementId),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function deleteElementsById(board: PlaitBoard, elementIds: Set<string>): void {
  for (let index = board.children.length - 1; index >= 0; index -= 1) {
    if (elementIds.has(board.children[index].id)) {
      Transforms.removeNode(board, [index]);
    }
  }
}

function removePPTFrames(
  board: PlaitBoard,
  existingPPTFrames: Array<PlaitFrame & { pptMeta: PPTFrameMeta }>
): number {
  if (existingPPTFrames.length === 0) {
    return 0;
  }

  const frameIds = new Set(existingPPTFrames.map((frame) => frame.id));
  const elementsToDelete = FrameTransforms.getFrameContents(board, frameIds);
  const existingDeleteIds = new Set(
    elementsToDelete.map((element) => element.id)
  );

  for (const frame of existingPPTFrames) {
    for (const elementId of collectReferencedPPTElementIds(frame)) {
      existingDeleteIds.add(elementId);
    }
  }

  deleteElementsById(board, existingDeleteIds);
  return existingPPTFrames.length;
}

function replaceExistingPPTOutline(board: PlaitBoard): number {
  return removePPTFrames(board, board.children.filter(isPPTFrame));
}

export function removePptExplainerOwnedOutline(
  board: PlaitBoard,
  pptExplainerJobId: string
): number {
  const owner = pptExplainerJobId.trim();
  if (!owner) return 0;

  return removePPTFrames(
    board,
    board.children
      .filter(isPPTFrame)
      .filter((frame) => frame.pptMeta.pptExplainerJobId?.trim() === owner)
  );
}

/**
 * 聚焦视口到指定 Frame
 */
function focusOnFrame(board: PlaitBoard, frame: PlaitFrame): void {
  const rect = RectangleClient.getRectangleByPoints(frame.points);
  const padding = 80;

  const container = PlaitBoardUtils.getBoardContainer(board);
  const viewportWidth = container?.clientWidth ?? 1920;
  const viewportHeight = container?.clientHeight ?? 1080;

  // 计算缩放比例，让 Frame 适应视口
  const scaleX = viewportWidth / (rect.width + padding * 2);
  const scaleY = viewportHeight / (rect.height + padding * 2);
  const zoom = Math.min(scaleX, scaleY, 1);

  // 计算 Frame 中心点
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  // 计算 origination：使 Frame 中心对齐视口中心
  const origination: [number, number] = [
    centerX - viewportWidth / 2 / zoom,
    centerY - viewportHeight / 2 / zoom,
  ];

  BoardTransforms.updateViewport(board, origination, zoom);
}

/**
 * 调用文本模型生成 PPT 大纲
 */
async function generatePPTOutline(
  topic: string,
  options: PPTGenerationParams,
  signal?: AbortSignal
): Promise<PPTOutline> {
  const settings = geminiSettings.get();
  const textModel =
    options.textModelRef ||
    options.textModel ||
    options.modelRef ||
    options.model ||
    settings.textModelName;

  const systemPrompt = generateOutlineSystemPrompt({
    pageCount: options.pageCount,
    language: options.language,
    extraRequirements: options.extraRequirements,
  });
  const userPrompt = generateOutlineUserPrompt(topic, options);
  const referenceImages = (options.referenceImages || []).filter(Boolean);

  let messages: GeminiMessage[] = [
    {
      role: 'system',
      content: [{ type: 'text', text: systemPrompt }],
    },
    {
      role: 'user',
      content: [{ type: 'text', text: userPrompt }],
    },
  ];

  if (referenceImages.length > 0) {
    let textPlan: ReturnType<typeof resolveInvocationPlanFromRoute> = null;
    try {
      textPlan = resolveInvocationPlanFromRoute('text', textModel);
    } catch {
      textPlan = null;
    }
    if (supportsTextBindingImageInput(textPlan?.binding)) {
      try {
        const imageParts = await buildImagePartsFromUrls(
          referenceImages,
          getTextBindingMaxImageCount(textPlan?.binding)
        );
        messages = appendImagePartsToLastUserMessage(messages, imageParts);
      } catch (error) {
        console.warn('[PPT] Failed to attach reference images:', error);
      }
    }
  }

  let fullResponse = '';

  // PPT 大纲是结构化 JSON，必须等待模型完整返回后再解析。
  // 传入 onChunk 会强制走流式调用，部分供应商可能提前结束并返回半截 JSON。
  const response = await defaultGeminiClient.sendChat(
    messages,
    undefined,
    signal,
    textModel
  );

  if (response.choices && response.choices.length > 0) {
    fullResponse = response.choices[0].message.content || fullResponse;
  }

  return parseOutlineResponse(fullResponse, options);
}

/**
 * 创建单个 PPT 页面（Frame + 整页图片元数据）
 */
function createPPTPage(
  board: PlaitBoard,
  outline: PPTOutline,
  pageSpec: PPTPageSpec,
  pageIndex: number,
  framePosition: Point,
  generateOptions: PPTGenerationParams,
  pptExplainerJobId?: string
): { frame: PlaitFrame; slidePrompt: string } {
  const referenceImages = normalizePPTReferenceImages(
    generateOptions.referenceImages
  );
  const promptOptions: PPTGenerationParams = {
    ...generateOptions,
    referenceImages,
  };
  // 1. 创建 Frame
  const framePoints: [Point, Point] = [
    framePosition,
    [framePosition[0] + PPT_FRAME_WIDTH, framePosition[1] + PPT_FRAME_HEIGHT],
  ];
  const frameName = pageSpec.title || `Slide ${pageIndex}`;
  const frame = FrameTransforms.insertFrame(board, framePoints, frameName);

  // 4. 设置 pptMeta 扩展属性
  const slidePrompt = generateSlideImagePrompt(
    outline,
    pageSpec,
    pageIndex,
    promptOptions
  );
  const pptMeta: PPTFrameMeta = {
    ...(pptExplainerJobId ? { pptExplainerJobId } : {}),
    deckTitle: outline.title,
    layout: pageSpec.layout,
    pageIndex,
    slidePrompt,
    styleSpec: outline.styleSpec,
    commonPrompt: formatPPTCommonPrompt(outline.styleSpec, promptOptions),
    slideImageStatus: 'placeholder',
    imageStatus: 'placeholder',
  };
  if (referenceImages.length > 0) {
    pptMeta.referenceImages = referenceImages;
  }
  if (pageSpec.imagePrompt) {
    pptMeta.imagePrompt = pageSpec.imagePrompt;
  }
  if (pageSpec.notes) {
    pptMeta.notes = pageSpec.notes;
  }

  // 查找 frame 在 board.children 中的索引并设置属性
  const frameIndex = board.children.findIndex((el) => el.id === frame.id);
  if (frameIndex !== -1) {
    Transforms.setNode(board, { pptMeta } as any, [frameIndex]);
  }

  return { frame, slidePrompt };
}

export interface MaterializePPTOutlineOptions {
  pptExplainerJobId?: string;
  replaceExistingPpt?: boolean;
  signal?: AbortSignal;
  focusFirstFrame?: boolean;
  openEditor?: boolean;
  onReplaced?: (count: number) => void;
  onPageCreated?: (created: number, total: number) => void;
}

export interface MaterializedPPTOutline {
  frames: PlaitFrame[];
  replacedFrameCount: number;
}

/**
 * Materialize an already validated outline without another model call.
 * Existing PPT pages are replaced by default for backward compatibility.
 */
export function materializePPTOutline(
  board: PlaitBoard,
  outline: PPTOutline,
  generateOptions: PPTGenerationParams,
  options: MaterializePPTOutlineOptions = {}
): MaterializedPPTOutline {
  options.signal?.throwIfAborted();
  const replacedFrameCount =
    options.replaceExistingPpt === false ? 0 : replaceExistingPPTOutline(board);
  options.onReplaced?.(replacedFrameCount);

  const startPosition = calcPPTFrameInsertionStartPosition(board);
  const framePositions = getPPTFrameGridPositions(
    outline.pages.length,
    startPosition,
    loadPPTFrameLayoutColumns()
  );
  const frames: PlaitFrame[] = new Array(outline.pages.length);

  for (let index = 0; index < outline.pages.length; index += 1) {
    options.signal?.throwIfAborted();
    const { frame } = createPPTPage(
      board,
      outline,
      outline.pages[index],
      index + 1,
      framePositions[index],
      generateOptions,
      options.pptExplainerJobId
    );
    frames[index] = frame;
    options.onPageCreated?.(index + 1, outline.pages.length);
  }

  if (options.focusFirstFrame !== false && frames[0]) {
    focusOnFrame(board, frames[0]);
  }
  if (options.openEditor !== false) {
    requestOpenPPTEditor({ viewMode: 'outline' });
  }
  return { frames, replacedFrameCount };
}

/**
 * 执行 PPT 生成
 */
async function executePPTGeneration(
  params: PPTGenerationParams,
  options: MCPExecuteOptions,
  context: {
    pptExplainerJobId?: string;
    replaceExistingPpt?: boolean;
  } = {}
): Promise<MCPResult> {
  const { topic, pageCount, language, extraRequirements } = params;
  const startTime = Date.now();

  if (!topic || typeof topic !== 'string') {
    analytics.trackPPTAction({
      action: 'generate_outline',
      source: 'mcp_generate_ppt',
      status: 'failed',
      error: 'MissingTopic',
    });
    return {
      success: false,
      error: '缺少必填参数 topic（PPT 主题）',
      type: 'error',
    };
  }

  const board = getBoard();
  if (!board) {
    analytics.trackPPTAction({
      action: 'generate_outline',
      source: 'mcp_generate_ppt',
      status: 'failed',
      prompt: topic,
      error: 'BoardUnavailable',
    });
    return {
      success: false,
      error: '画布未初始化，请先打开画布',
      type: 'error',
    };
  }

  try {
    const rawReferenceImages = (params.referenceImages || []).filter(Boolean);
    const referenceImages = normalizePPTReferenceImages(params.referenceImages);
    const generationParams: PPTGenerationParams = {
      ...params,
      referenceImages,
    };
    const settings = geminiSettings.get();
    const textModel =
      params.textModelRef ||
      params.textModel ||
      params.modelRef ||
      params.model ||
      settings.textModelName;
    const analyticsTextModel =
      typeof textModel === 'string'
        ? textModel
        : textModel?.modelId || settings.textModelName;
    analytics.trackPPTAction({
      action: 'generate_outline',
      source: 'mcp_generate_ppt',
      status: 'start',
      model: analyticsTextModel,
      prompt: topic,
      metadata: {
        page_count_option: pageCount || 'normal',
        has_extra_requirements: Boolean(extraRequirements?.trim()),
        reference_image_count: referenceImages.length,
        language,
      },
    });
    // 通知开始生成
    options.onChunk?.(`🎯 正在为「${topic}」生成 PPT 大纲...\n\n`);
    if (referenceImages.length > 0) {
      options.onChunk?.(
        `已关联 ${referenceImages.length} 张参考图片作为配图参考。\n\n`
      );
    }

    // 1. 生成大纲
    const outline = await generatePPTOutline(
      topic,
      {
        ...params,
        referenceImages: rawReferenceImages,
      },
      options.signal
    );
    options.signal?.throwIfAborted();

    options.onChunk?.(`\n\n✓ 大纲生成完成，共 ${outline.pages.length} 页\n\n`);
    options.onChunk?.(`📑 **PPT 结构**：\n`);

    // 显示大纲结构
    outline.pages.forEach((page, index) => {
      const hasImage = page.imagePrompt ? ' 🖼️' : '';
      options.onChunk?.(
        `${index + 1}. ${page.title} (${page.layout})${hasImage}\n`
      );
    });

    options.onChunk?.(`\n正在创建 PPT 页面并填充提示词...\n\n`);
    const { frames: createdFrames, replacedFrameCount } = materializePPTOutline(
      board,
      outline,
      generationParams,
      {
        pptExplainerJobId: context.pptExplainerJobId,
        replaceExistingPpt: context.replaceExistingPpt,
        signal: options.signal,
        onReplaced: (count) => {
          if (count > 0) {
            options.onChunk?.(
              `\n已替换画布中原有 ${count} 个 PPT 页面及其内容。\n`
            );
          }
        },
        onPageCreated: (created, total) => {
          options.onChunk?.(`✓ 第 ${created}/${total} 页已创建\n`);
        },
      }
    );
    const createdCount = createdFrames.length;
    analytics.trackPPTAction({
      action: 'generate_outline',
      source: 'mcp_generate_ppt',
      status: 'success',
      pageCount: createdCount,
      frameCount: createdCount,
      durationMs: Date.now() - startTime,
      model: analyticsTextModel,
      prompt: topic,
      metadata: {
        replaced_frame_count: replacedFrameCount,
        layout_count: outline.pages.reduce<Record<string, number>>(
          (acc, page) => {
            acc[page.layout] = (acc[page.layout] || 0) + 1;
            return acc;
          },
          {}
        ),
        reference_image_count: referenceImages.length,
      },
    });

    options.onChunk?.(`\n🎉 **PPT 大纲已生成！**\n`);
    options.onChunk?.(`- 共创建 ${createdCount} 个 Frame\n`);
    options.onChunk?.(`- 已填充公共提示词和每页 PPT 提示词\n`);
    options.onChunk?.(`\n💡 **提示**：\n`);
    options.onChunk?.(`- 已切换到左侧「PPT 编辑」的大纲视图\n`);
    options.onChunk?.(`- 确认或修改提示词后，可选择串行/并行生成图片\n`);

    return {
      success: true,
      data: {
        title: outline.title,
        pageCount: createdCount,
        imageTaskCount: 0,
        outline,
      },
      type: 'text',
    };
  } catch (error: any) {
    console.error('[PPT] Generation failed:', error);
    analytics.trackPPTAction({
      action: 'generate_outline',
      source: 'mcp_generate_ppt',
      status: 'failed',
      durationMs: Date.now() - startTime,
      prompt: topic,
      error: error instanceof Error ? error.name || 'Error' : typeof error,
    });
    return {
      success: false,
      error: error.message || 'PPT 生成失败',
      type: 'error',
    };
  }
}

/**
 * generate_ppt MCP 工具定义
 */
export const pptGenerationTool: MCPTool = {
  name: 'generate_ppt',
  description: `生成 PPT 演示文稿大纲工具。根据用户提供的主题或内容描述，自动生成结构化 PPT 大纲、公共风格提示词和每页整图提示词。

使用场景：
- 用户想要创建 PPT、演示文稿、幻灯片
- 用户提供了一个主题，想要生成对应的演示内容
- 关键词：PPT、演示文稿、幻灯片、presentation、slides

工作原理：
1. 调用 AI 生成 PPT 大纲（包含版式、标题、正文和视觉提示）
2. 自动创建多个 Frame（1920x1080），每个 Frame 代表一页
3. 为每页写入整页图片提示词，并写入整套 PPT 公共风格提示词
4. 视口自动聚焦到第一页，打开 PPT 编辑并切换到大纲视图
5. 用户确认大纲后再从大纲视图批量生成图片

支持的版式：
- cover: 封面页
- toc: 目录页
- title-body: 标题正文页
- image-text: 图文页
- comparison: 对比页
- ending: 结尾页

生成说明：
- 每页 PPT 由一张完整图片构成，文字、背景和视觉设计都包含在图片内
- 此工具只生成大纲和提示词，不会立即提交图片任务
- 可在「PPT 编辑」大纲视图修改提示词并选择串行/并行生成`,

  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'PPT 主题或内容描述',
      },
      pageCount: {
        type: 'string',
        description: '页数控制：short(5-7页), normal(8-12页), long(13-18页)',
        enum: ['short', 'normal', 'long'],
        default: 'normal',
      },
      language: {
        type: 'string',
        description: '输出语言，默认中文',
        default: '中文',
      },
      extraRequirements: {
        type: 'string',
        description: '额外要求，如风格、重点内容等',
      },
      textModel: {
        type: 'string',
        description: 'PPT 大纲生成文本模型，默认使用输入栏当前文本模型',
      },
      referenceImages: {
        type: 'array',
        description: '参考图片 URL 列表，用于规划 PPT 配图和后续页面生图参考',
        items: { type: 'string' },
      },
    },
    required: ['topic'],
  },

  supportedModes: ['async'],

  promptGuidance: {
    whenToUse:
      '当用户想要创建 PPT、演示文稿、幻灯片时使用。关键词：PPT、演示文稿、幻灯片、presentation、slides、做个汇报、生成演示。',

    parameterGuidance: {
      topic:
        '用户的 PPT 主题或内容描述。可以是一个简单的主题词，也可以是详细的内容大纲。',
      pageCount:
        '根据用户需求选择：short 适合简短汇报(5-7页)，normal 适合常规演示(8-12页)，long 适合详细讲解(13-18页)。',
      language:
        '根据用户语言偏好设置，默认中文。如果用户用英文交流，可以设为 English。',
      extraRequirements:
        '用户的额外要求，如"简洁风格"、"重点突出数据"、"适合技术分享"等。',
    },

    bestPractices: [
      '将用户的描述直接作为 topic 传递，工具会自动规划内容结构',
      '如果用户提到"简短"、"快速"，使用 pageCount: "short"',
      '如果用户提到"详细"、"完整"，使用 pageCount: "long"',
      '生成完成后提醒用户先检查大纲提示词，再在 PPT 编辑面板生成图片',
    ],

    examples: [
      {
        input: '帮我做一个关于人工智能发展的 PPT',
        args: {
          topic: '人工智能发展',
          pageCount: 'normal',
          language: '中文',
        },
      },
      {
        input: '生成一个简短的产品介绍幻灯片',
        args: {
          topic: '产品介绍',
          pageCount: 'short',
          language: '中文',
        },
      },
      {
        input: 'Create a detailed presentation about climate change',
        args: {
          topic: 'Climate Change',
          pageCount: 'long',
          language: 'English',
        },
      },
      {
        input: '做一个关于团队年度总结的 PPT，要突出数据和成果',
        args: {
          topic: '团队年度总结',
          pageCount: 'normal',
          language: '中文',
          extraRequirements: '突出数据展示和成果呈现',
        },
      },
    ],

    warnings: [
      'PPT 生成需要几秒钟时间，请耐心等待',
      '此工具只创建页面和提示词，不会立即生图',
      '一个画布只保留一套 PPT；每次生成会替换已有 PPT 页面及其内容',
    ],
  },

  execute: async (
    params: Record<string, unknown>,
    options?: MCPExecuteOptions
  ): Promise<MCPResult> => {
    const typedParams = params as unknown as PPTGenerationParams;
    return executePPTGeneration(typedParams, options || {});
  },
};

/**
 * 便捷方法：生成 PPT
 */
export async function generatePPT(
  params: PPTGenerationParams,
  options?: Omit<MCPExecuteOptions, 'mode'> & {
    /** Trusted main-thread ownership marker; never exposed in the MCP schema. */
    pptExplainerJobId?: string;
    /** PPT explainer may preserve other decks on the same board. */
    replaceExistingPpt?: boolean;
  }
): Promise<MCPResult> {
  const { pptExplainerJobId, replaceExistingPpt, ...executeOptions } =
    options || {};
  return executePPTGeneration(
    params,
    { ...executeOptions, mode: 'async' },
    { pptExplainerJobId, replaceExistingPpt }
  );
}
