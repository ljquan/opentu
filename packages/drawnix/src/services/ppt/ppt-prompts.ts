/**
 * PPT 大纲生成提示词模块
 *
 * 参考 banana-slides 8.2 节和 LandPPT 5.3 节设计
 * 输出严格 JSON（PPTOutline），内置语言控制和页数控制
 */

import type {
  PPTGenerateOptions,
  PPTLayoutType,
  PPTOutline,
  PPTPageSpec,
  PPTStyleSpec,
} from './ppt.types';
import { collectJsonSources } from '../../utils/llm-json-extractor';

/** 页数范围映射 */
const PAGE_COUNT_RANGES: Record<string, { min: number; max: number }> = {
  short: { min: 5, max: 7 },
  normal: { min: 8, max: 12 },
  long: { min: 13, max: 18 },
};

/** 版式类型描述 */
const LAYOUT_DESCRIPTIONS: Record<PPTLayoutType, string> = {
  cover: '封面页 - 用于PPT开头，包含主标题和副标题',
  toc: '目录页 - 展示PPT的章节结构',
  'title-body': '标题正文页 - 最常用的版式，标题 + 要点列表',
  'image-text': '图文页 - 同时包含文字信息和视觉表达',
  comparison: '对比页 - 左右对比两个概念或事物',
  ending: '结尾页 - 用于PPT结尾，包含感谢语或总结',
};

const VALID_LAYOUTS: PPTLayoutType[] = [
  'cover',
  'toc',
  'title-body',
  'image-text',
  'comparison',
  'ending',
];

const LAYOUT_GUIDANCE: Record<PPTLayoutType, string> = {
  cover:
    '建立整套 PPT 的主视觉基调：一个强视觉锚点、少量大字标题、充足留白，避免信息堆叠。',
  toc: '使用清晰的章节导航结构：编号、分组线或轨道式布局，目录项节奏统一，并延续封面视觉母题。',
  'title-body':
    '使用稳定内容页版式：标题区、正文区、视觉锚点区明确分层，要点可转为卡片、标签或步骤块。',
  'image-text':
    '使用图文平衡版式：一侧承载视觉锚点，另一侧承载文字层级，两侧对齐到同一网格。',
  comparison:
    '使用左右或上下对比结构：两组信息尺寸、间距和组件样式对称，差异用同一强调色体系标注。',
  ending:
    '做收束页：回扣核心视觉母题，保留一个总结性视觉锚点和简洁行动/结束语，不新增新画风。',
};

const STYLE_FIELD_TEXT_LIMIT = 480;
const STYLE_REQUIREMENT_TEXT_LIMIT = 280;
const PPT_REFERENCE_IMAGE_LIMIT = 3;
const PPT_REFERENCE_IMAGE_URL_LIMIT = 4096;
const PROMPT_ONLY_LABEL_PATTERN =
  /^(?:封面页?|目录页?|大纲|PPT\s*大纲|页面标题|标题|副标题|页面要点|要点|核心要点|视觉概念|页面描述|内容描述)$/i;
const PROMPT_ONLY_LABEL_PREFIX_PATTERN =
  /^\s*(?:封面页?|目录页?|大纲|PPT\s*大纲|幻灯片|第\s*[一二三四五六七八九十\d]+\s*页|页面标题|标题|副标题|页面要点|要点|核心要点|视觉概念|页面描述|内容描述)\s*[：:｜|—-]\s*/i;
const PROMPT_ONLY_TITLE_SUFFIX_PATTERN =
  /\s*(?:[：:｜|—-]\s*)?(?:PPT\s*大纲|演示文稿\s*大纲)$/i;

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizePPTReferenceImages(
  referenceImages: string[] = []
): string[] {
  const uniqueImages = new Set<string>();

  for (const rawUrl of referenceImages) {
    const url = normalizeInlineText(rawUrl || '');
    const lowerUrl = url.toLowerCase();
    if (
      !url ||
      lowerUrl.startsWith('data:') ||
      url.length > PPT_REFERENCE_IMAGE_URL_LIMIT
    ) {
      continue;
    }
    uniqueImages.add(url);
    if (uniqueImages.size >= PPT_REFERENCE_IMAGE_LIMIT) {
      break;
    }
  }

  return Array.from(uniqueImages);
}

function sanitizeVisiblePPTText(value?: string): string {
  let normalized = normalizeInlineText(value || '');
  if (!normalized) return '';

  for (let i = 0; i < 3; i++) {
    const next = normalized
      .replace(PROMPT_ONLY_LABEL_PREFIX_PATTERN, '')
      .trim();
    if (next === normalized) break;
    normalized = next;
  }

  normalized = normalized.replace(PROMPT_ONLY_TITLE_SUFFIX_PATTERN, '').trim();

  return PROMPT_ONLY_LABEL_PATTERN.test(normalized) ? '' : normalized;
}

/**
 * 默认 PPT 全局风格规格。
 * 只保存短文本，不保存图片或 base64，避免增大画布元数据。
 */
export function createDefaultPPTStyleSpec(
  options: PPTGenerateOptions = {}
): PPTStyleSpec {
  const extraRequirements = options.extraRequirements?.trim()
    ? truncateText(
        options.extraRequirements.trim(),
        STYLE_REQUIREMENT_TEXT_LIMIT
      )
    : '';
  const visualStyle = extraRequirements
    ? `professional modern premium presentation design, incorporate this user style requirement consistently: ${extraRequirements}`
    : 'professional modern premium presentation design, clean keynote style, polished SaaS editorial look';

  return {
    visualStyle,
    colorPalette:
      'warm white or very light neutral background as 70% base, deep charcoal text, one consistent accent color as 10% highlight, muted supporting colors as 20% surfaces, no random palette changes',
    typography:
      'consistent geometric sans-serif, bold concise titles, clear body hierarchy, same font mood, size scale, and weight system on every slide',
    layout:
      'stable 16:9 grid, generous margins, repeated header/title rhythm, reusable cards/charts/content blocks, balanced whitespace, one clear visual anchor per slide',
    decorativeElements:
      'subtle geometric shapes, thin dividers, soft shadows, restrained icons, repeated visual motif and component style across slides',
    avoid:
      'do not switch art styles, do not change color families between slides, do not use mismatched fonts, do not create busy backgrounds',
  };
}

function readStyleField(
  styleSpec: Record<string, unknown>,
  key: keyof PPTStyleSpec,
  fallback: string | undefined
): string | undefined {
  const value = styleSpec[key];
  return typeof value === 'string' && value.trim()
    ? truncateText(value.trim(), STYLE_FIELD_TEXT_LIMIT)
    : fallback;
}

export function normalizePPTStyleSpec(
  styleSpec: unknown,
  options: PPTGenerateOptions = {}
): PPTStyleSpec {
  const fallback = createDefaultPPTStyleSpec(options);
  if (!styleSpec || typeof styleSpec !== 'object') {
    return fallback;
  }

  const s = styleSpec as Record<string, unknown>;
  return {
    visualStyle: readStyleField(s, 'visualStyle', fallback.visualStyle)!,
    colorPalette: readStyleField(s, 'colorPalette', fallback.colorPalette)!,
    typography: readStyleField(s, 'typography', fallback.typography)!,
    layout: readStyleField(s, 'layout', fallback.layout)!,
    decorativeElements: readStyleField(
      s,
      'decorativeElements',
      fallback.decorativeElements
    )!,
    avoid: readStyleField(s, 'avoid', fallback.avoid),
  };
}

function normalizeOutlineStyle(
  outline: PPTOutline,
  options: PPTGenerateOptions = {}
): PPTOutline {
  return {
    ...outline,
    styleSpec: normalizePPTStyleSpec(outline.styleSpec, options),
  };
}

/**
 * 生成 PPT 大纲的系统提示词
 */
export function generateOutlineSystemPrompt(
  options: PPTGenerateOptions = {}
): string {
  const { pageCount = 'normal', language = '中文' } = options;
  const exactPageCount =
    typeof pageCount === 'number' &&
    Number.isSafeInteger(pageCount) &&
    pageCount > 0
      ? pageCount
      : undefined;
  const range =
    typeof pageCount === 'string'
      ? PAGE_COUNT_RANGES[pageCount] || PAGE_COUNT_RANGES.normal
      : PAGE_COUNT_RANGES.normal;
  const pageCountRequirement = exactPageCount
    ? `总计严格 ${exactPageCount} 页（包含封面页和结尾页）`
    : `${range.min}-${range.max}页（不含封面和结尾）`;

  return `你是一位专业的PPT大纲设计师。请根据用户提供的主题，生成一份结构清晰、逻辑严密、内容丰富的PPT大纲。

## 输出要求
1. 输出格式：严格JSON，符合 PPTOutline 接口定义
2. 输出语言：所有文本内容使用${language}
3. 页数控制：${pageCountRequirement}
4. 必须以封面页(cover)开头，结尾页(ending)结尾

## 可用版式类型
${Object.entries(LAYOUT_DESCRIPTIONS)
  .map(([type, desc]) => `- ${type}: ${desc}`)
  .join('\n')}

## PPTOutline JSON Schema
\`\`\`typescript
interface PPTOutline {
  title: string;          // PPT总标题，只写演示主题，不要包含“PPT大纲/大纲”等任务标签
  styleSpec: PPTStyleSpec; // 整套PPT共用的全局风格规格
  pages: PPTPageSpec[];   // 所有页面
}

interface PPTStyleSpec {
  visualStyle: string;        // 整体视觉风格，具体且可复用
  colorPalette: string;       // 背景色、主色、辅助色、强调色、色板比例和用途
  typography: string;         // 字体气质、字号层级、字重规则
  layout: string;             // 网格、留白、组件复用、版面节奏、视觉锚点规则
  decorativeElements: string; // 重复出现的图形、图标、纹理、组件样式或视觉母题
  avoid?: string;             // 禁止漂移项
}

interface PPTPageSpec {
  layout: "cover" | "toc" | "title-body" | "image-text" | "comparison" | "ending";
  title: string;          // 页面标题（控制在10个中文字符以内，不要写“封面：”“大纲：”等结构标签）
  subtitle?: string;      // 副标题（cover/ending页使用）
  bullets?: string[];     // 页面要点：除 cover/ending 外必须提供，toc 为目录项
  imagePrompt?: string;   // 视觉概念描述（可选，英文）
  notes?: string;         // 演讲者备注（可选）
}
\`\`\`

## 视觉概念规则
- imagePrompt 是可选视觉概念，不是单独配图任务；可为需要更强画面指引的页面生成
- imagePrompt 使用英文描述，便于图片生成模型理解
- 描述应具体、可视化，包含主体、风格、氛围等要素
- imagePrompt 必须服从全局 styleSpec，不得为单页创造新的画风、色板或字体体系
- 示例："A futuristic city with flying cars and holographic billboards, professional flat design illustration, clean and modern style"

## 全局风格规格规则
1. 必须生成 styleSpec，且所有页面都必须共享同一套 styleSpec
2. styleSpec 要具体到可执行的视觉规则，不能只写 generic、modern、clean 这类泛词
3. 若额外要求中包含风格要求，必须融合进 styleSpec
4. 各页允许版式变化，但颜色、字体气质、组件样式、装饰母题必须一致

## 设计系统生成规则
1. styleSpec 必须是一套可复用设计系统，而不是零散风格标签；它要让后续公共提示词和每页提示词都能继承。
2. visualStyle 写清楚主题气质、行业感、画面材质和整体表现方式，避免只写“高级”“现代”“简洁”。
3. colorPalette 必须包含背景色、主文字色、主色、辅助色、强调色和色板比例（建议 70% 背景/20% 辅助/10% 强调），并说明各自用途。
4. typography 必须包含标题、正文、数字/标签的字体气质、字号层级和字重规则，确保每页字体继承一致。
5. layout 必须包含 16:9 网格、边距、标题区位置、内容区节奏、组件复用规则和每页视觉锚点规则。
6. decorativeElements 必须定义重复视觉母题、图标/线条/卡片/图表的统一样式，不要每页随机换装饰。
7. avoid 必须列出禁止漂移项，例如更换色板、换字体体系、混用写实照片和扁平插画、背景过密、文字低对比。

## 结构标签规则
1. title、subtitle、bullets 只写最终应出现在幻灯片上的正文，不要写提示词字段名或结构标签
2. PPT 总标题是演示主题，不是任务名称；禁止把“生成PPT大纲”“PPT大纲”“演示文稿大纲”作为标题或标题后缀
3. layout 已经表达页面角色，禁止在 title 中再写“封面：”“封面页：”“大纲：”“页面标题：”等前缀
4. imagePrompt 只写视觉概念，不要写入会被渲染到画面上的文字说明

## 页面要点硬性规则
1. 除 cover 和 ending 外，每一页都必须包含非空 bullets 数组
2. toc 页 bullets 填 3-7 个目录项；title-body/image-text 页填 4-6 个正文要点
3. comparison 页必须填 6 个要点，前 3 个代表左侧，后 3 个代表右侧
4. 每个 bullet 必须是具体内容，10-24 个中文字符，不能只写概念名
5. 禁止在 bullets 中输出“无”“暂无”“待补充”“N/A”或空字符串
6. 如果主题信息较少，也要基于主题合理补全页面要点，不允许省略

## 设计原则
1. **标题精简**：每页标题控制在 10 个中文字符以内（约 20 个英文字符），避免在幻灯片上换行
2. **内容充实**：每页 4-6 个要点，每个要点 10-20 字，信息密度适中
3. **视觉完整**：每页都应能被图片模型生成成完整幻灯片画面
4. **逻辑清晰**：内容有明确的起承转合
5. **版式多样**：合理搭配不同版式，避免连续多页相同版式
6. **对比页要点**：comparison 版式需要 6 个要点（左右各 3 个），方便排版

## 输出格式
直接输出JSON对象，不要包含markdown代码块标记。`;
}

/**
 * 生成用户提示词
 */
export function generateOutlineUserPrompt(
  topic: string,
  options: PPTGenerateOptions = {}
): string {
  const { extraRequirements, referenceImages = [] } = options;

  let prompt = `请为以下主题生成PPT大纲：

主题：${topic}`;

  if (extraRequirements) {
    prompt += `

额外要求：${extraRequirements}`;
  }

  if (referenceImages.length > 0) {
    prompt += `

参考图片：用户已提供 ${referenceImages.length} 张参考图片。请优先从参考图片中提取可用的配图主体、视觉风格、色彩和构图线索；生成 image-text 或关键内容页时，把参考图片规划为页面配图或视觉锚点，但不要把“参考图片”等说明文字写进幻灯片可见文字。`;
  }

  prompt += `

请直接输出JSON格式的PPT大纲。`;
  prompt += `
注意：除 cover 和 ending 外，所有页面都必须生成 bullets，不能让页面要点为空或为“无”。`;

  return prompt;
}

function formatReferenceBullets(bullets?: string[]): string {
  const items = bullets?.map(sanitizeVisiblePPTText).filter(Boolean) || [];
  return items.length > 0 ? items.join('；') : '无';
}

function quoteVisibleText(value: string): string {
  return `- ${JSON.stringify(value)}`;
}

function formatVisibleSlideTexts(
  outlineTitle: string,
  page: PPTPageSpec
): string {
  const title =
    sanitizeVisiblePPTText(page.title) || sanitizeVisiblePPTText(outlineTitle);
  const subtitle = sanitizeVisiblePPTText(page.subtitle);
  const bullets =
    page.bullets?.map(sanitizeVisiblePPTText).filter(Boolean) || [];
  const texts: string[] = [];

  if (title) texts.push(title);
  if (subtitle) texts.push(subtitle);
  if (page.layout !== 'cover') {
    texts.push(...bullets);
  }

  return texts.length > 0
    ? texts.map(quoteVisibleText).join('\n')
    : '- 本页不渲染文字，只生成符合页面用途的专业视觉画面';
}

function formatStyleSpec(styleSpec: PPTStyleSpec): string {
  return `- 整体视觉风格：${styleSpec.visualStyle}
- 色板规则：${styleSpec.colorPalette}
- 字体规则：${styleSpec.typography}
- 布局规则：${styleSpec.layout}
- 装饰元素：${styleSpec.decorativeElements}
- 禁止事项：${styleSpec.avoid || '不得偏离上述全局风格规格'}`;
}

function formatDeckConsistencyRules(): string {
  return `## 设计一致性规则
- 整套 PPT 必须像同一套模板：继承同一色板、字体气质、网格、组件样式和重复视觉母题。
- 色板比例：优先保持约 70% 背景/20% 辅助面/10% 强调色；强调色只用于关键数字、标签、连接线或当前页视觉锚点。
- 字体继承：标题、正文、标签、数字分别沿用同一字形气质、字号层级和字重关系，不得单页换字体体系。
- 组件复用：卡片、图表、图标、分隔线、按钮状标签、数据芯片的圆角、描边、阴影和间距保持一致。
- 视觉母题复用：每页都可以有不同构图，但要重复使用同一类图形语言、纹理、线条或图标风格。
- 对比度与留白：文字必须高对比、清晰可读；页面边距和元素间距稳定，避免文字贴边或拥挤。
- 每页必须有一个视觉锚点：可以是主图形、关键数字、流程节点、对比焦点或图文主体，用于建立清晰焦点。`;
}

function formatReferenceImageRules(options: PPTGenerateOptions = {}): string {
  const referenceImages = normalizePPTReferenceImages(options.referenceImages);
  if (referenceImages.length === 0) {
    return '';
  }

  return `## 参考图片配图规则
- 已提供 ${referenceImages.length} 张参考图片。生成每页幻灯片时，优先把参考图片作为配图、主视觉或风格参考。
- 参考图片可以被裁切、缩放、融入卡片或图文版式，但不要机械铺满整页，也不要破坏整套 PPT 的统一风格。
- 如当前页不适合直接展示参考图片，也要延续其色彩、材质、构图或视觉母题。`;
}

function formatCoreRequirements(options: PPTGenerateOptions = {}): string {
  const { language = '中文' } = options;
  return `## 核心要求
- 输出必须是一整页幻灯片设计，不要只生成插画、背景图或局部元素。
- 幻灯片内只能直接包含单页提示词“画面可见文字”中列出的文本，不需要额外叠加文本。
- 文字语言：${language}
- 画面比例：16:9，留白合理，层级清晰，适合正式演示。
- 所有页面必须严格遵守公共提示词，不得为单页另起一套画风、色板、字体或组件样式。
- 各页可以有不同版式，但必须像同一套 PPT 模板中的一页。
- 每页必须有明确视觉锚点，并与标题信息形成主次关系。
- 不得把提示词字段名、结构标签、引号、冒号、JSON/Markdown 标记或列表编号渲染到幻灯片画面中。`;
}

function formatSlideBoundaryRules(): string {
  return `## 单页设计边界
- 每页只根据单页提示词选择构图、视觉锚点和内容层级；不要复制或改写生成时拼接的全套设计规则。
- 必须继承生成时拼接的全套设计约束，不得为任何单页创造新色板、新字体体系、新画风或新组件样式。
- 可以根据当前版式改变信息摆放，但边距、对齐、图标/卡片/线条风格要与整套 PPT 保持一致。`;
}

function formatRenderingGuardrails(): string {
  return `## 禁止事项
- 不得在画面中出现“封面”“封面页”“大纲”“PPT大纲”“页面标题”“页面要点”“视觉概念”“当前页面角色”等提示词字段或结构标签，除非它们是“画面可见文字”中的真实内容。
- 不得把任何提示词说明句、字段名、列表编号、JSON/Markdown 标记复制到幻灯片中。
- 开场主视觉页只呈现主题、品牌名或副标题，不要出现“封面：xxx”或“xxx PPT 大纲”。`;
}

export function formatPPTCommonPrompt(
  styleSpec: unknown,
  options: PPTGenerateOptions = {}
): string {
  return `整套 PPT 公共提示词，所有页面都必须遵守：

${formatCoreRequirements(options)}

${formatDeckConsistencyRules()}

${formatSlideBoundaryRules()}

${formatRenderingGuardrails()}

${formatReferenceImageRules(options)}

## 全局风格规格
${formatStyleSpec(normalizePPTStyleSpec(styleSpec, options))}`;
}

export function buildPPTImageGenerationPrompt(
  commonPrompt: string,
  slidePrompt: string
): string {
  return [commonPrompt.trim(), slidePrompt.trim()]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export function normalizePPTSlidePrompt(prompt?: string): string {
  const normalized = prompt?.trim() || '';
  if (!normalized) return '';

  const separatorIndex = normalized.indexOf('\n---\n');
  const withoutMergedCommonPrompt =
    separatorIndex !== -1 &&
    /公共提示词|全局风格规格|所有页面/.test(normalized.slice(0, separatorIndex))
      ? normalized
          .slice(separatorIndex)
          .replace(/^\n---\n+/, '')
          .trim()
      : normalized;

  return withoutMergedCommonPrompt
    .replace(
      /(^|\n)## 核心要求\n[\s\S]*?\n(?=## (?:PPT 信息|画面可见文字))/,
      '$1'
    )
    .replace(
      /(^|\n)## 全局风格规格（整套 PPT 所有页面完全共用）\n[\s\S]*?\n(?=## (?:PPT 信息|画面可见文字))/,
      '$1'
    )
    .replace(
      /- 必须严格延续“全局风格规格”，不得为当前页另起一套画风、色板、字体或组件样式。/g,
      '- 必须严格遵守生成时拼接的“公共提示词”，不得为当前页另起一套画风、色板、字体或组件样式。'
    )
    .trim();
}

function summarizePage(page?: PPTPageSpec): string {
  if (!page) return '无';
  const title = sanitizeVisiblePPTText(page.title) || '无标题';
  const subtitle = sanitizeVisiblePPTText(page.subtitle);
  const bullets =
    page.bullets?.slice(0, 3).map(sanitizeVisiblePPTText).filter(Boolean) || [];
  return [title, subtitle, bullets.join('；') || '无要点']
    .filter(Boolean)
    .join('｜');
}

function buildSlideVisualAnchor(page: PPTPageSpec): string {
  if (page.imagePrompt?.trim()) {
    return page.imagePrompt.trim();
  }

  const title = sanitizeVisiblePPTText(page.title);
  const firstBullet = page.bullets?.map(sanitizeVisiblePPTText).find(Boolean);
  const anchorSource = firstBullet || title || '本页核心信息';

  switch (page.layout) {
    case 'cover':
      return `围绕“${anchorSource}”建立一个主题主视觉符号或抽象场景`;
    case 'toc':
      return '用章节轨道、编号节点或目录路径作为视觉锚点';
    case 'image-text':
      return `将“${anchorSource}”转化为主图形、产品画面或概念插画`;
    case 'comparison':
      return '用中轴线、双栏对比卡片或差异高亮作为视觉锚点';
    case 'ending':
      return `用收束性的图形符号呼应“${anchorSource}”`;
    default:
      return `将“${anchorSource}”转化为关键数字、图标组合或信息卡片焦点`;
  }
}

/**
 * 生成单页整图 PPT 的图片提示词。
 */
export function generateSlideImagePrompt(
  outline: Pick<PPTOutline, 'title' | 'pages' | 'styleSpec'>,
  page: PPTPageSpec,
  pageIndex: number,
  options: PPTGenerateOptions = {}
): string {
  const { extraRequirements } = options;
  const totalPages = outline.pages.length;
  const pageRole =
    page.layout === 'cover'
      ? '开场主视觉页'
      : page.layout === 'ending'
      ? '结束页'
      : page.layout === 'toc'
      ? '章节导航页'
      : `第 ${pageIndex} 页内容页`;
  const previousPage = outline.pages[pageIndex - 2];
  const nextPage = outline.pages[pageIndex];
  const safeOutlineTitle = sanitizeVisiblePPTText(outline.title) || '演示主题';
  const safePageTitle =
    sanitizeVisiblePPTText(page.title) || sanitizeVisiblePPTText(outline.title);
  const safeSubtitle = sanitizeVisiblePPTText(page.subtitle) || '无';
  const layoutGuidance = LAYOUT_GUIDANCE[page.layout];
  const visualAnchor = buildSlideVisualAnchor(page);
  const referenceImages = normalizePPTReferenceImages(options.referenceImages);

  return `请生成一张完整的 16:9 PowerPoint 幻灯片图片，适合直接作为 PPT 第 ${pageIndex}/${totalPages} 页使用。

## 画面可见文字
以下引号内文本是唯一允许出现在幻灯片上的文字；不要渲染引号本身、字段名、冒号或列表符号。
${formatVisibleSlideTexts(outline.title, page)}

## 设计参考信息（仅供理解，不要作为画面文字）
- 演示主题：${safeOutlineTitle}
- 当前页用途：${pageRole}
- 版式参考：${page.layout}
- 标题语义：${safePageTitle || '无'}
- 副标题语义：${safeSubtitle}
- 内容语义：${formatReferenceBullets(page.bullets)}
- 本页视觉锚点：${visualAnchor}
- 版式指导：${layoutGuidance}
${
  referenceImages.length > 0
    ? `- 参考图片策略：优先将已提供的参考图片作为本页配图或视觉风格来源。`
    : ''
}

## 相邻页面上下文（仅用于保持连续性，不要照抄或渲染为文字）
- 上一页概要：${summarizePage(previousPage)}
- 下一页概要：${summarizePage(nextPage)}

${extraRequirements ? `## 额外要求\n${extraRequirements}\n` : ''}
请只生成最终幻灯片画面。`;
}

/**
 * 验证 PPT 大纲结构
 */
export function validateOutline(
  outline: unknown
): outline is import('./ppt.types').PPTOutline {
  if (!outline || typeof outline !== 'object') return false;

  const o = outline as Record<string, unknown>;
  if (typeof o.title !== 'string' || !o.title) return false;
  if (!Array.isArray(o.pages) || o.pages.length === 0) return false;

  for (const page of o.pages) {
    if (!page || typeof page !== 'object') return false;
    const p = page as Record<string, unknown>;
    if (
      typeof p.layout !== 'string' ||
      !VALID_LAYOUTS.includes(p.layout as PPTLayoutType)
    )
      return false;
    if (typeof p.title !== 'string') return false;
  }

  return true;
}

function readStringField(
  value: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === 'string' && field.trim()) {
      return field.trim();
    }
  }
  return undefined;
}

function readStringArrayField(
  value: Record<string, unknown>,
  keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const field = value[key];
    const items = Array.isArray(field)
      ? field
          .flatMap((item) =>
            typeof item === 'string' ? splitBulletText(item) : []
          )
          .map(normalizeBulletText)
          .filter(Boolean)
      : typeof field === 'string'
      ? splitBulletText(field).map(normalizeBulletText).filter(Boolean)
      : [];

    if (items.length > 0) return items;
  }
  return undefined;
}

function splitBulletText(value: string): string[] {
  return value
    .split(/\r?\n|[；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBulletText(value: string): string {
  const normalized = value
    .replace(/^\s*(?:[-*•]|(?:\d+|[一二三四五六七八九十]+)[、.．)]?)\s*/, '')
    .trim();

  return /^(无|暂无|没有|待补充|待定|n\/a|none|null)$/i.test(normalized)
    ? ''
    : normalized;
}

function normalizeLayoutValue(
  rawLayout: unknown,
  title: string,
  pageIndex: number,
  pageCount: number
): PPTLayoutType {
  const text = `${typeof rawLayout === 'string' ? rawLayout : ''} ${title}`
    .toLowerCase()
    .trim();

  if (text.includes('封面') || text.includes('cover')) return 'cover';
  if (text.includes('目录') || text.includes('toc') || text.includes('agenda'))
    return 'toc';
  if (
    text.includes('结尾') ||
    text.includes('结束') ||
    text.includes('谢谢') ||
    text.includes('致谢') ||
    text.includes('ending') ||
    text.includes('thanks')
  )
    return 'ending';
  if (
    text.includes('对比') ||
    text.includes('比较') ||
    text.includes('comparison') ||
    text.includes('compare')
  )
    return 'comparison';
  if (
    text.includes('图文') ||
    text.includes('image-text') ||
    text.includes('image_text') ||
    text.includes('visual')
  )
    return 'image-text';
  if (
    text.includes('正文') ||
    text.includes('内容') ||
    text.includes('title-body') ||
    text.includes('title_body') ||
    text.includes('body')
  )
    return 'title-body';

  if (pageIndex === 0) return 'cover';
  if (pageIndex === pageCount - 1) return 'ending';
  return 'title-body';
}

function normalizeOutlineShape(parsed: unknown): PPTOutline | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const outline = parsed as Record<string, unknown>;
  const rawPages = Array.isArray(outline.pages)
    ? outline.pages
    : Array.isArray(outline.slides)
    ? outline.slides
    : null;

  if (!rawPages || rawPages.length === 0) {
    return null;
  }

  const title =
    readStringField(outline, [
      'title',
      'theme',
      'topic',
      'name',
      'deckTitle',
      'deck_title',
    ]) || 'PPT 大纲';

  const pages = rawPages.map((rawPage, index): PPTPageSpec => {
    const page =
      rawPage && typeof rawPage === 'object'
        ? (rawPage as Record<string, unknown>)
        : { title: String(rawPage || '') };
    const pageTitle =
      readStringField(page, [
        'title',
        'pageTitle',
        'page_title',
        'headline',
        'name',
      ]) || `第 ${index + 1} 页`;
    const bullets = readStringArrayField(page, [
      'bullets',
      'key_points',
      'core_points',
      'points',
      'pagePoints',
      'page_points',
      'page_key_points',
      'slide_points',
      'main_points',
      'content_points',
      'takeaways',
      'content',
      'summary',
      '页面要点',
      '要点',
      '核心要点',
      '正文要点',
      '主要内容',
    ]);

    const normalizedPage: PPTPageSpec = {
      layout: normalizeLayoutValue(
        page.layout || page.type || page.pageType || page.page_type,
        pageTitle,
        index,
        rawPages.length
      ),
      title: pageTitle,
    };

    const subtitle = readStringField(page, [
      'subtitle',
      'subTitle',
      'sub_title',
    ]);
    const imagePrompt = readStringField(page, [
      'imagePrompt',
      'image_prompt',
      'visualPrompt',
      'visual_prompt',
    ]);
    const notes = readStringField(page, [
      'notes',
      'speakerNotes',
      'speaker_notes',
    ]);

    if (subtitle) normalizedPage.subtitle = subtitle;
    if (bullets) normalizedPage.bullets = bullets;
    if (imagePrompt) normalizedPage.imagePrompt = imagePrompt;
    if (notes) normalizedPage.notes = notes;

    return normalizedPage;
  });

  return {
    title,
    styleSpec: (outline.styleSpec ||
      outline.style ||
      outline.designStyle ||
      outline.design_style) as PPTStyleSpec | undefined,
    pages,
  };
}

function parseAndNormalizeOutline(
  jsonStr: string,
  options: PPTGenerateOptions
): PPTOutline | null {
  const parsed = JSON.parse(jsonStr);
  const normalized = normalizeOutlineShape(parsed);
  if (normalized && validateOutline(normalized)) {
    return normalizeOutlineStyle(normalized, options);
  }

  if (validateOutline(parsed)) {
    return normalizeOutlineStyle(parsed, options);
  }

  return null;
}

/**
 * 解析 AI 返回的大纲 JSON
 */
export function parseOutlineResponse(
  response: string,
  options: PPTGenerateOptions = {}
): import('./ppt.types').PPTOutline {
  let jsonStr = response.trim();

  // 移除可能的 markdown 代码块标记
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    const trimmed = candidate.trim();
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  addCandidate(jsonStr);
  try {
    collectJsonSources(jsonStr, {
      kinds: ['object'],
      allowInvalid: true,
    }).forEach(addCandidate);
  } catch {
    // 继续使用原始候选和修复 fallback。
  }

  // 策略1: 直接解析候选 JSON
  for (const candidate of candidates) {
    try {
      const outline = parseAndNormalizeOutline(candidate, options);
      if (outline) {
        return outline;
      }
    } catch {
      // 当前候选解析失败，继续尝试下一个候选
    }
  }

  // 策略3: 尝试修复常见 JSON 问题（如尾部逗号、单引号等）
  for (const candidate of candidates) {
    try {
      const fixedStr = candidate
        .replace(/,\s*([}\]])/g, '$1') // 移除尾部逗号
        .replace(/(['"])?(\w+)(['"])?\s*:/g, '"$2":') // 修复未引用的 key
        .replace(/:\s*'([^']*)'/g, ':"$1"'); // 单引号转双引号

      const outline = parseAndNormalizeOutline(fixedStr, options);
      if (outline) {
        return outline;
      }
    } catch {
      // 当前候选修复后仍然解析失败，继续尝试下一个候选
    }
  }

  throw new Error(
    `Failed to parse PPT outline. AI response may contain invalid JSON. ` +
      `Response preview: ${response.slice(0, 200)}...`
  );
}
