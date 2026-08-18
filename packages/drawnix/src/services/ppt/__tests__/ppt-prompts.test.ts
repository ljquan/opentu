import { describe, expect, it } from 'vitest';
import {
  buildPPTImageGenerationPrompt,
  formatPPTCommonPrompt,
  generateOutlineSystemPrompt,
  generateSlideImagePrompt,
  normalizePPTSlidePrompt,
  parseOutlineResponse,
} from '../ppt-prompts';
import type { PPTOutline, PPTStyleSpec } from '../ppt.types';

const styleSpec: PPTStyleSpec = {
  visualStyle: 'editorial blue glass presentation system',
  colorPalette: 'navy text, porcelain background, cyan accent',
  typography: 'condensed bold titles with calm sans body text',
  layout: '12-column grid, repeated title rail, consistent card spacing',
  decorativeElements: 'thin cyan lines and small rounded data chips',
  avoid: 'avoid warm orange palettes and mixed illustration styles',
};

describe('ppt prompts style consistency', () => {
  it('requires a deck-level styleSpec in outline generation', () => {
    const prompt = generateOutlineSystemPrompt({
      language: '中文',
      extraRequirements: '科技发布会风格',
    });

    expect(prompt).toContain('styleSpec: PPTStyleSpec');
    expect(prompt).toContain('所有页面都必须共享同一套 styleSpec');
    expect(prompt).toContain('可复用设计系统');
    expect(prompt).toContain('色板比例');
    expect(prompt).toContain('重复视觉母题');
    expect(prompt).toContain('视觉锚点规则');
    expect(prompt).toContain('额外要求中包含风格要求');
    expect(prompt).toContain(
      '除 cover 和 ending 外，每一页都必须包含非空 bullets 数组'
    );
    expect(prompt).toContain(
      '禁止在 bullets 中输出“无”“暂无”“待补充”“N/A”或空字符串'
    );
  });

  it('requires an exact total page count when a number is provided', () => {
    const prompt = generateOutlineSystemPrompt({ pageCount: 5 });

    expect(prompt).toContain('总计严格 5 页（包含封面页和结尾页）');
    expect(prompt).not.toContain('5-7页（不含封面和结尾）');
  });

  it('fills missing styleSpec with a default that includes user style requirements', () => {
    const outline = parseOutlineResponse(
      JSON.stringify({
        title: 'AI 产品路线图',
        pages: [
          { layout: 'cover', title: '路线图' },
          { layout: 'ending', title: '谢谢' },
        ],
      }),
      { extraRequirements: '深色霓虹但保持商务感' }
    );

    expect(outline.styleSpec).toBeDefined();
    expect(outline.styleSpec?.visualStyle).toContain('深色霓虹但保持商务感');
    expect(outline.styleSpec?.colorPalette).toContain(
      'no random palette changes'
    );
  });

  it('normalizes partial styleSpec without rejecting the outline', () => {
    const outline = parseOutlineResponse(
      JSON.stringify({
        title: '增长复盘',
        styleSpec: {
          visualStyle: 'minimal report deck',
        },
        pages: [
          { layout: 'cover', title: '增长复盘' },
          { layout: 'ending', title: '谢谢' },
        ],
      })
    );

    expect(outline.styleSpec?.visualStyle).toBe('minimal report deck');
    expect(outline.styleSpec?.typography).toContain('geometric sans-serif');
  });

  it('parses markdown fenced outline JSON', () => {
    const outline = parseOutlineResponse(`\`\`\`json
{
  "title": "产品介绍",
  "pages": [
    { "layout": "cover", "title": "产品介绍" },
    { "layout": "ending", "title": "谢谢" }
  ]
}
\`\`\``);

    expect(outline.title).toBe('产品介绍');
    expect(outline.pages).toHaveLength(2);
  });

  it('skips unrelated JSON snippets before the real outline', () => {
    const outline = parseOutlineResponse(`示例：{"demo": true}

请使用下面的大纲：
{
  "title": "市场计划",
  "pages": [
    { "layout": "cover", "title": "市场计划" },
    { "layout": "ending", "title": "谢谢" }
  ]
}`);

    expect(outline.title).toBe('市场计划');
    expect(outline.pages[0].layout).toBe('cover');
  });

  it('skips thinking JSON before the real outline', () => {
    const outline =
      parseOutlineResponse(`<think>{"title":"草稿","pages":"not array"}</think>
最终：
{
  "title": "发布计划",
  "pages": [
    { "layout": "cover", "title": "发布计划" },
    { "layout": "ending", "title": "谢谢" }
  ]
}`);

    expect(outline.title).toBe('发布计划');
    expect(outline.pages).toHaveLength(2);
  });

  it('normalizes common AI outline aliases from PPT generation responses', () => {
    const outline = parseOutlineResponse(
      JSON.stringify({
        theme: '兔子AI是API中转站',
        mainline: '问题-方案-能力-场景-价值',
        pages: [
          {
            page: 1,
            title: '封面｜兔子AI',
            core_points: ['统一 API 中转', '面向 AI 能力接入'],
          },
          {
            page: 2,
            title: '方案能力',
            key_points: ['统一模型路由', '额度与密钥管理'],
          },
          {
            page: 3,
            title: '谢谢',
            key_points: ['欢迎体验'],
          },
        ],
      })
    );

    expect(outline.title).toBe('兔子AI是API中转站');
    expect(outline.pages[0].layout).toBe('cover');
    expect(outline.pages[1].layout).toBe('title-body');
    expect(outline.pages[1].bullets).toEqual([
      '统一模型路由',
      '额度与密钥管理',
    ]);
    expect(outline.pages[2].layout).toBe('ending');
  });

  it('normalizes Chinese page-point aliases and string bullet lists', () => {
    const outline = parseOutlineResponse(
      JSON.stringify({
        title: 'AI 创作复盘',
        pages: [
          { layout: 'cover', title: 'AI 创作' },
          {
            layout: 'title-body',
            title: '问题诊断',
            页面要点:
              '1. 创作结果分散难复用\n2. 协作沉淀缺少统一入口\n3. 交付流程依赖人工整理',
          },
          {
            layout: 'title-body',
            title: '优化方向',
            主要内容: [
              '集中呈现生成结果',
              '按项目沉淀关键资产',
              '降低重复整理成本',
            ],
          },
          { layout: 'ending', title: '谢谢' },
        ],
      })
    );

    expect(outline.pages[1].bullets).toEqual([
      '创作结果分散难复用',
      '协作沉淀缺少统一入口',
      '交付流程依赖人工整理',
    ]);
    expect(outline.pages[2].bullets).toEqual([
      '集中呈现生成结果',
      '按项目沉淀关键资产',
      '降低重复整理成本',
    ]);
  });

  it('keeps truncated JSON as a parse failure', () => {
    expect(() =>
      parseOutlineResponse(
        '{"theme":"兔子AI是API中转站","pages":[{"title":"封面","core_points":["统一 API 中转"]}'
      )
    ).toThrow('Failed to parse PPT outline');
  });

  it('keeps common style out of slide prompts and merges it for generation', () => {
    const outline: PPTOutline = {
      title: 'AI 产品路线图',
      styleSpec,
      pages: [
        { layout: 'cover', title: '路线图' },
        {
          layout: 'title-body',
          title: '关键方向',
          bullets: ['模型能力升级', '工作流集成'],
        },
        { layout: 'ending', title: '谢谢' },
      ],
    };

    const slidePrompt = generateSlideImagePrompt(outline, outline.pages[1], 2, {
      language: '中文',
    });
    const commonPrompt = formatPPTCommonPrompt(styleSpec);
    const generationPrompt = buildPPTImageGenerationPrompt(
      commonPrompt,
      slidePrompt
    );

    expect(commonPrompt).toContain('## 核心要求');
    expect(commonPrompt).toContain('## 设计一致性规则');
    expect(commonPrompt).toContain('输出必须是一整页幻灯片设计');
    expect(commonPrompt).toContain('文字语言：中文');
    expect(commonPrompt).toContain('色板比例');
    expect(commonPrompt).toContain('组件复用');
    expect(commonPrompt).toContain('视觉母题复用');
    expect(commonPrompt).toContain('对比度与留白');
    expect(commonPrompt).toContain('每页必须有一个视觉锚点');
    expect(commonPrompt).toContain('## 单页设计边界');
    expect(commonPrompt).toContain('不得为任何单页创造新色板');
    expect(commonPrompt).toContain('## 禁止事项');
    expect(commonPrompt).toContain('不得在画面中出现“封面”');
    expect(slidePrompt).not.toContain('全局风格规格');
    expect(slidePrompt).not.toContain(styleSpec.visualStyle);
    expect(slidePrompt).not.toContain(styleSpec.colorPalette);
    expect(slidePrompt).not.toContain('色板比例');
    expect(slidePrompt).not.toContain('## 单页设计边界');
    expect(slidePrompt).not.toContain('## 禁止事项');
    expect(slidePrompt).not.toContain('不得为任何单页创造新色板');
    expect(slidePrompt).not.toContain('## 核心要求');
    expect(slidePrompt).not.toContain('公共提示词');
    expect(slidePrompt).toContain('## 画面可见文字');
    expect(slidePrompt).toContain('- "关键方向"');
    expect(slidePrompt).toContain('- "模型能力升级"');
    expect(slidePrompt).toContain('本页视觉锚点');
    expect(slidePrompt).toContain('版式指导');
    expect(slidePrompt).toContain('使用稳定内容页版式');
    expect(slidePrompt).toContain('上一页概要：路线图｜无要点');
    expect(slidePrompt).toContain('下一页概要：谢谢｜无要点');
    expect(generationPrompt).toContain(commonPrompt);
    expect(generationPrompt).toContain(slidePrompt);
    expect(generationPrompt).toContain(styleSpec.visualStyle);
  });

  it('keeps prompt-only labels out of the visible text whitelist', () => {
    const outline: PPTOutline = {
      title: 'OpenTu.ai 介绍 PPT 大纲',
      styleSpec,
      pages: [
        {
          layout: 'cover',
          title: '封面：OpenTu.ai 开源 AI 创作台',
          subtitle: '大纲：多模态创作与高效协同',
          bullets: ['封面', '大纲'],
        },
      ],
    };

    const slidePrompt = generateSlideImagePrompt(outline, outline.pages[0], 1);
    const visibleTextBlock = slidePrompt
      .split('## 设计参考信息')[0]
      .replace(/[\s\S]*## 画面可见文字/, '');

    expect(visibleTextBlock).toContain('- "OpenTu.ai 开源 AI 创作台"');
    expect(visibleTextBlock).toContain('- "多模态创作与高效协同"');
    expect(visibleTextBlock).not.toContain('封面：');
    expect(visibleTextBlock).not.toContain('大纲：');
    expect(visibleTextBlock).not.toContain('PPT 大纲');
  });

  it('normalizes legacy slide prompts by removing embedded common style blocks', () => {
    const prompt =
      normalizePPTSlidePrompt(`整套 PPT 公共提示词，所有页面都必须遵守：
- 整体视觉风格：${styleSpec.visualStyle}

---

请生成一张完整的 16:9 PowerPoint 幻灯片图片。

## 核心要求
- 必须严格延续“全局风格规格”，不得为当前页另起一套画风、色板、字体或组件样式。

## 全局风格规格（整套 PPT 所有页面完全共用）
- 整体视觉风格：${styleSpec.visualStyle}
- 色板规则：${styleSpec.colorPalette}

## PPT 信息
- 页面标题：关键方向`);

    expect(prompt).not.toContain('全局风格规格（整套 PPT 所有页面完全共用）');
    expect(prompt).not.toContain(styleSpec.visualStyle);
    expect(prompt).not.toContain('整套 PPT 公共提示词');
    expect(prompt).not.toContain('## 核心要求');
    expect(prompt).toContain('## PPT 信息');
  });
});
