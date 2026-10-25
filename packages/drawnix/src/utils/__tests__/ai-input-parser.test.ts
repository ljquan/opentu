import { describe, it, expect, vi } from 'vitest';
import {
  parseAIInput,
  generateDefaultPrompt,
  shouldUseAgentFlow,
  type SelectionInfo,
} from '../ai-input-parser';

// Mock settings-manager
vi.mock('../settings-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings-manager')>()),
  geminiSettings: {
    get: vi.fn(() => ({
      imageModelName: 'gemini-3-pro-image-preview',
      videoModelName: 'veo-3',
    })),
  },
  providerPricingCacheSettings: {
    get: vi.fn(() => []),
    set: vi.fn(),
  },
}));

// Helper function
const createSelection = (
  texts: string[] = [],
  imageCount = 0
): SelectionInfo => ({
  texts,
  images: Array(imageCount).fill('mock-image-url'),
  videos: [],
  graphics: [],
});

describe('ai-input-parser', () => {
  describe('generateDefaultPrompt', () => {
    it('应该在有选中文字时返回合并的文字', () => {
      const result = generateDefaultPrompt(true, ['Hello', 'World'], 0);
      expect(result).toBe('Hello\nWorld');
    });

    it('应该在有单张图片但无文字时返回分析单图的提示词', () => {
      const result = generateDefaultPrompt(true, [], 1);
      expect(result).toContain('分析这张图片');
      expect(result).toContain('推测');
    });

    it('应该在有多张图片但无文字时返回融合多图的提示词', () => {
      const result = generateDefaultPrompt(true, [], 3);
      expect(result).toContain('分析这些图片');
      expect(result).toContain('融合');
    });

    it('应该在无选中元素时返回空字符串', () => {
      const result = generateDefaultPrompt(false, [], 0);
      expect(result).toBe('');
    });

    it('应该优先使用文字而非图片数量', () => {
      const result = generateDefaultPrompt(true, ['Custom prompt'], 5);
      expect(result).toBe('Custom prompt');
    });
  });

  describe('shouldUseAgentFlow', () => {
    it('应该在有额外文字内容时返回 true', () => {
      expect(shouldUseAgentFlow('请帮我生成一张猫的图片')).toBe(true);
    });

    it('旧模型标记作为普通正文时返回 true', () => {
      expect(shouldUseAgentFlow('#gemini-3-pro-image-preview')).toBe(true);
    });

    it('旧参数标记作为普通正文时返回 true', () => {
      expect(shouldUseAgentFlow('-size=1024x768')).toBe(true);
    });

    it('旧数量标记作为普通正文时返回 true', () => {
      expect(shouldUseAgentFlow('+3')).toBe(true);
    });

    it('组合标记不会被自动剥离', () => {
      expect(
        shouldUseAgentFlow('#gemini-3-pro-image-preview -size=1024x768 +2')
      ).toBe(true);
    });

    it('应该在组合标记且有额外内容时返回 true', () => {
      expect(
        shouldUseAgentFlow('#gemini-3-pro-image-preview 一只可爱的猫')
      ).toBe(true);
    });

    it('应该在空输入时返回 false', () => {
      expect(shouldUseAgentFlow('')).toBe(false);
    });
  });

  describe('parseAIInput', () => {
    describe('场景判断', () => {
      it('场景1: 只有选中元素，没有输入文字 -> direct_generation', () => {
        const result = parseAIInput('', createSelection(['猫'], 1));
        expect(result.scenario).toBe('direct_generation');
        expect(result.hasExtraContent).toBe(false);
      });

      it('场景2: 选择器指定模型、参数且无正文 -> direct_generation', () => {
        const result = parseAIInput('', createSelection([], 1), {
          modelId: 'gemini-3-pro-image-preview',
          params: { size: '1024x768' },
        });
        expect(result.scenario).toBe('direct_generation');
        expect(result.hasExtraContent).toBe(false);
      });

      it('场景3: 选择器指定数量且无正文 -> direct_generation', () => {
        const result = parseAIInput('', createSelection([], 1), { count: 4 });
        expect(result.scenario).toBe('direct_generation');
        expect(result.hasExtraContent).toBe(false);
      });

      it('场景4: 输入内容包含其他内容 -> agent_flow', () => {
        const result = parseAIInput(
          '请生成一张可爱的猫的图片',
          createSelection([], 0)
        );
        expect(result.scenario).toBe('agent_flow');
        expect(result.hasExtraContent).toBe(true);
      });

      it('混合场景: 有模型标记和额外内容 -> agent_flow', () => {
        const result = parseAIInput(
          '#gemini-3-pro-image-preview 一只可爱的猫',
          createSelection([], 1)
        );
        expect(result.scenario).toBe('agent_flow');
        expect(result.hasExtraContent).toBe(true);
      });
    });

    describe('生成类型判断', () => {
      it('默认应该是图片生成', () => {
        const result = parseAIInput('', createSelection([], 1));
        expect(result.generationType).toBe('image');
      });

      it('选择图片模型时应该是图片生成', () => {
        const result = parseAIInput(
          '#gemini-3-pro-image-preview',
          createSelection([], 1)
        );
        expect(result.generationType).toBe('image');
        expect(result.modelId).toBe('gemini-3-pro-image-preview');
      });

      it('选择视频模型时应该是视频生成', () => {
        const result = parseAIInput('', createSelection([], 1), {
          modelId: 'veo3',
        });
        expect(result.generationType).toBe('video');
        expect(result.modelId).toBe('veo3');
      });
    });

    describe('提示词处理', () => {
      it('旧模型标记应完整保留在提示词中', () => {
        const result = parseAIInput(
          '#gemini-3-pro-image-preview 一只可爱的猫',
          createSelection([], 1)
        );
        expect(result.prompt).toBe('#gemini-3-pro-image-preview 一只可爱的猫');
        expect(result.isModelExplicit).toBe(false);
      });

      it('无输入时应该使用选中文字作为提示词', () => {
        const result = parseAIInput('', createSelection(['猫咪', '可爱'], 0));
        expect(result.prompt).toBe('猫咪\n可爱');
      });

      it('无输入无文字但有单张图片时应该生成默认提示词', () => {
        const result = parseAIInput('', createSelection([], 1));
        expect(result.prompt).toContain('分析这张图片');
      });

      it('无输入无文字但有多张图片时应该生成融合提示词', () => {
        const result = parseAIInput('', createSelection([], 3));
        expect(result.prompt).toContain('分析这些图片');
      });
    });

    describe('数量解析', () => {
      it('默认数量应该是 1', () => {
        const result = parseAIInput('', createSelection([], 1));
        expect(result.count).toBe(1);
      });

      it('应该使用选择器中的数量 2', () => {
        const result = parseAIInput('', createSelection([], 1), { count: 2 });
        expect(result.count).toBe(2);
      });

      it('应该使用选择器中的数量 10', () => {
        const result = parseAIInput('', createSelection([], 1), { count: 10 });
        expect(result.count).toBe(10);
      });

      it('普通正文中的数量标记不覆盖选择器数量', () => {
        const result = parseAIInput(
          '#gemini-3-pro-image-preview +9',
          createSelection([], 1),
          { count: 3 }
        );
        expect(result.count).toBe(3);
        expect(result.prompt).toBe('#gemini-3-pro-image-preview +9');
      });
    });

    describe('尺寸参数解析', () => {
      it('应该规范化选择器比例尺寸 16:9', () => {
        const result = parseAIInput('', createSelection([], 1), {
          params: { size: '16:9' },
        });
        expect(result.size).toBe('16x9');
      });

      it('应该规范化选择器比例尺寸 1:1', () => {
        const result = parseAIInput('', createSelection([], 1), {
          params: { size: '1:1' },
        });
        expect(result.size).toBe('1x1');
      });

      it('应该规范化选择器比例尺寸 9:16', () => {
        const result = parseAIInput('', createSelection([], 1), {
          params: { size: '9:16' },
        });
        expect(result.size).toBe('9x16');
      });

      it('应该保留 Seedance 独立分辨率与比例参数', () => {
        const result = parseAIInput('一段视频', createSelection([], 0), {
          generationType: 'video',
          modelId: 'doubao-seedance-2-0-260128',
          params: { size: '1080p', ratio: 'adaptive', duration: '12' },
        });
        expect(result.size).toBe('1080p');
        expect(result.duration).toBe('12');
        expect(result.extraParams).toMatchObject({ ratio: 'adaptive' });
      });

      it('没有指定尺寸时应该使用模型默认值', () => {
        const result = parseAIInput(
          '#gemini-3-pro-image-preview',
          createSelection([], 1)
        );
        expect(result.size).toBe('1x1');
      });
    });

    describe('时长参数解析', () => {
      it('应该使用选择器视频时长 8', () => {
        const result = parseAIInput('', createSelection([], 1), {
          modelId: 'veo3',
          params: { duration: '8' },
        });
        expect(result.duration).toBe('8');
      });

      it('应该透传选择器时长而不从正文覆盖', () => {
        const result = parseAIInput('-duration=8', createSelection([], 1), {
          modelId: 'sora-2-pro',
          params: { duration: '16' },
        });
        expect(result.duration).toBe('16');
      });
    });

    describe('parseResult 保留', () => {
      it('应该保留原始正文且不创建旧标记解析结果', () => {
        const result = parseAIInput(
          '#gemini-3-pro-image-preview +2 一只猫',
          createSelection([], 1)
        );
        expect(result.parseResult).toBeDefined();
        expect(result.parseResult.selectedImageModel).toBeNull();
        expect(result.parseResult.selectedCount).toBeNull();
        expect(result.parseResult.cleanText).toBe(
          '#gemini-3-pro-image-preview +2 一只猫'
        );
      });
    });

    describe('复杂组合场景', () => {
      it('应该合并选中文字与选择器中的生成配置', () => {
        const result = parseAIInput('', createSelection(['猫咪图片'], 1), {
          modelId: 'gemini-3-pro-image-preview',
          count: 3,
          params: { size: '16:9' },
        });

        expect(result.scenario).toBe('direct_generation');
        expect(result.hasExtraContent).toBe(false);
        expect(result.prompt).toBe('猫咪图片');
        expect(result.count).toBe(3);
        expect(result.size).toBe('16x9');
      });
    });

    describe('边界情况', () => {
      it('应该处理空输入且无选中元素的情况', () => {
        const result = parseAIInput('', createSelection([], 0));
        expect(result.scenario).toBe('direct_generation');
        expect(result.prompt).toBe('');
      });

      it('应该处理只有空格的输入', () => {
        const result = parseAIInput('   ', createSelection([], 1));
        expect(result.scenario).toBe('direct_generation');
        expect(result.hasExtraContent).toBe(false);
      });

      it('应该处理无效的模型标记', () => {
        const result = parseAIInput('#invalid-model', createSelection([], 1));
        // 无效模型不会被识别，所以 cleanText 会包含它
        expect(result.parseResult.selectedImageModel).toBeNull();
      });

      it('应该处理无效的参数标记', () => {
        const result = parseAIInput('-invalid=value', createSelection([], 1));
        expect(result.parseResult.selectedParams.length).toBe(0);
      });

      it('应该处理超出范围的数量', () => {
        // +100 超出范围（1-10），不会被识别
        const result = parseAIInput('+100', createSelection([], 1));
        expect(result.count).toBe(1); // 默认值
      });
    });

    describe('普通正文不推断模型身份', () => {
      it('大写模型标记保留原文且不创建模型选择', () => {
        const result = parseAIInput(
          '#GEMINI-3-PRO-IMAGE-PREVIEW',
          createSelection([], 1)
        );
        expect(result.modelId).toBe('gemini-3-pro-image-preview');
        expect(result.prompt).toBe('#GEMINI-3-PRO-IMAGE-PREVIEW');
        expect(result.isModelExplicit).toBe(false);
      });

      it('混合大小写模型标记保留原文且不创建模型选择', () => {
        const result = parseAIInput(
          '#Gemini-3-Pro-Image-Preview',
          createSelection([], 1)
        );
        expect(result.modelId).toBe('gemini-3-pro-image-preview');
        expect(result.prompt).toBe('#Gemini-3-Pro-Image-Preview');
        expect(result.isModelExplicit).toBe(false);
      });
    });

    describe('完整返回对象快照', () => {
      it('图片生成场景 - 完整参数', () => {
        const result = parseAIInput('一只可爱的橘猫', createSelection([], 1), {
          generationType: 'image',
          modelId: 'gemini-3-pro-image-preview',
          count: 2,
          params: { size: '1:1' },
        });

        expect(result).toMatchObject({
          scenario: 'direct_generation',
          generationType: 'image',
          modelId: 'gemini-3-pro-image-preview',
          prompt: '一只可爱的橘猫',
          count: 2,
          size: '1x1',
          duration: undefined,
          hasExtraContent: true,
        });

        // parseResult 单独验证（因为包含复杂嵌套对象）
        expect(result.parseResult).toMatchObject({
          selectedImageModel: null,
          selectedVideoModel: null,
          selectedCount: null,
          cleanText: '一只可爱的橘猫',
        });
        expect(result.parseResult.selectedParams).toEqual([]);
        expect(result.isModelExplicit).toBe(true);
      });

      it('视频生成场景 - 完整参数', () => {
        const result = parseAIInput('一只猫在跳舞', createSelection([], 1), {
          generationType: 'video',
          modelId: 'veo3',
          params: { duration: '8', size: '16:9' },
        });

        expect(result).toMatchObject({
          scenario: 'direct_generation',
          generationType: 'video',
          modelId: 'veo3',
          prompt: '一只猫在跳舞',
          count: 1,
          duration: '8',
          size: '16x9',
          hasExtraContent: true,
        });

        expect(result.parseResult).toMatchObject({
          selectedImageModel: null,
          selectedVideoModel: null,
          selectedCount: null,
          cleanText: '一只猫在跳舞',
        });
        expect(result.parseResult.selectedParams).toEqual([]);
        expect(result.isModelExplicit).toBe(true);
      });

      it('直接生成场景 - 无额外内容', () => {
        const result = parseAIInput('', createSelection(['猫咪', '狗狗'], 2), {
          generationType: 'image',
          modelId: 'gemini-3-pro-image-preview',
          count: 3,
          params: { size: '16:9' },
        });

        expect(result).toMatchObject({
          scenario: 'direct_generation',
          generationType: 'image',
          modelId: 'gemini-3-pro-image-preview',
          prompt: '猫咪\n狗狗',
          count: 3,
          size: '16x9',
          hasExtraContent: false,
        });
      });

      it('默认值场景 - 最小输入', () => {
        const result = parseAIInput('', createSelection([], 1));

        expect(result).toMatchObject({
          scenario: 'direct_generation',
          generationType: 'image',
          modelId: 'gemini-3-pro-image-preview', // 来自 mock 的默认值
          count: 1,
          size: '1x1',
          hasExtraContent: false,
        });
        // prompt 应该是单图分析的默认提示词
        expect(result.prompt).toContain('分析这张图片');
      });

      it('Agent 流程场景 - 纯文本输入', () => {
        const result = parseAIInput(
          '请帮我生成一张赛博朋克风格的城市夜景图',
          createSelection([], 0)
        );

        expect(result).toMatchObject({
          scenario: 'agent_flow',
          generationType: 'agent',
          prompt: '请帮我生成一张赛博朋克风格的城市夜景图',
          count: 1,
          hasExtraContent: true,
        });
      });

      it('文本生成场景 - 显式文本模式应直接生成', () => {
        const result = parseAIInput('', createSelection([], 1), {
          generationType: 'text',
          modelId: 'deepseek-v3.2',
        });

        expect(result).toMatchObject({
          scenario: 'direct_generation',
          generationType: 'text',
          modelId: 'deepseek-v3.2',
          count: 1,
          hasExtraContent: false,
        });
        expect(result.prompt).toBe('');
        expect(result.selection.images).toEqual(['mock-image-url']);
      });

      it('多图融合场景', () => {
        const result = parseAIInput('', createSelection([], 3));

        expect(result).toMatchObject({
          scenario: 'direct_generation',
          generationType: 'image',
          modelId: 'gemini-3-pro-image-preview',
          count: 1,
          size: '1x1',
          hasExtraContent: false,
        });
        // prompt 应该是多图融合的默认提示词
        expect(result.prompt).toContain('分析这些图片');
        expect(result.prompt).toContain('融合');
      });
    });
  });
});
