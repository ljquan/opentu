// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import {
  convertDirectGenerationToWorkflow,
  convertAgentFlowToWorkflow,
  convertSkillFlowToWorkflow,
  convertToWorkflow,
  parseAIResponseToSteps,
  updateStepStatus,
  addStepsToWorkflow,
  getWorkflowStatus,
  WorkflowDefinition,
  WorkflowStep,
} from '../workflow-converter';
import type { ParsedGenerationParams } from '../../../utils/ai-input-parser';
import { initializeMCP } from '../../../mcp';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
    configurable: true,
  });

  const createObjectStore = () => ({
    createIndex: () => undefined,
    count: () => ({ onsuccess: null, onerror: null, result: 0 }),
    get: () => ({ onsuccess: null, onerror: null, result: undefined }),
    getAll: () => ({ onsuccess: null, onerror: null, result: [] }),
    getAllKeys: () => ({ onsuccess: null, onerror: null, result: [] }),
    put: () => ({ onsuccess: null, onerror: null }),
  });
  const createDatabase = () => ({
    objectStoreNames: { contains: () => true },
    createObjectStore: () => createObjectStore(),
    transaction: () => ({
      objectStore: () => createObjectStore(),
    }),
    close: () => undefined,
    onclose: null,
  });

  Object.defineProperty(globalThis, 'indexedDB', {
    value: {
      open: () => {
        const request = {
          result: createDatabase(),
          error: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          onblocked: null,
          transaction: null,
        };
        queueMicrotask(() => {
          request.onupgradeneeded?.({ target: request });
          request.onsuccess?.(new Event('success'));
        });
        return request;
      },
    },
    configurable: true,
  });
});

// Helper to create mock ParsedGenerationParams
const createMockParams = (
  overrides: Partial<ParsedGenerationParams> = {}
): ParsedGenerationParams => ({
  scenario: 'direct_generation',
  generationType: 'image',
  modelId: 'gemini-3-pro-image-preview',
  isModelExplicit: false,
  prompt: 'test prompt',
  userInstruction: 'test prompt',
  rawInput: 'test prompt',
  count: 1,
  size: '1x1',
  duration: undefined,
  parseResult: {
    cleanText: 'test prompt',
    triggers: [],
    modelTrigger: null,
    countTrigger: null,
    sizeTrigger: null,
    durationTrigger: null,
    aspectRatioTrigger: null,
    originalText: 'test prompt',
  },
  hasExtraContent: false,
  selection: {
    texts: [],
    images: [],
    videos: [],
    graphics: [],
  },
  ...overrides,
});

const knowledgeContextRefs = [
  {
    noteId: 'note-1',
    title: '产品定位',
    directoryId: 'dir-1',
    updatedAt: 2,
  },
];

describe('workflow-converter', () => {
  beforeAll(() => {
    initializeMCP();
  });

  describe('convertDirectGenerationToWorkflow', () => {
    describe('图片生成场景', () => {
      it('应该正确转换单张图片生成请求', () => {
        const params = createMockParams({
          generationType: 'image',
          modelId: 'gemini-3-pro-image-preview',
          prompt: '一只可爱的猫',
          count: 1,
          size: '1x1',
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow).toBeDefined();
        expect(workflow.scenarioType).toBe('direct_generation');
        expect(workflow.generationType).toBe('image');
        expect(workflow.steps).toHaveLength(1);
        expect(workflow.steps[0].mcp).toBe('generate_image');
        expect(workflow.steps[0].args).toMatchObject({
          prompt: '一只可爱的猫',
          size: '1x1',
          model: 'gemini-3-pro-image-preview',
        });
        expect(workflow.steps[0].status).toBe('pending');
      });

      it('应该正确处理多张图片生成（count=3）', () => {
        const params = createMockParams({
          generationType: 'image',
          count: 3,
          prompt: '风景画',
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps).toHaveLength(3);
        workflow.steps.forEach((step, index) => {
          expect(step.id).toMatch(new RegExp(`-step-${index + 1}$`));
          expect(step.mcp).toBe('generate_image');
          expect(step.description).toContain(`${index + 1}`);
          expect(step.args.workflowId).toBe(workflow.id);
          expect(step.args.batchId).toBe(`wf_batch_${workflow.id}`);
          expect(step.args.batchIndex).toBe(index + 1);
          expect(step.args.batchTotal).toBe(3);
          expect(step.args.globalIndex).toBe(index + 1);
        });
      });

      it('应该保持目标图优先的参考图片顺序', () => {
        const params = createMockParams({
          generationType: 'image',
          prompt: '风格转换',
        });
        const referenceImages = [
          'https://example.com/target.jpg',
          'https://example.com/manual-reference.jpg',
        ];

        const workflow = convertDirectGenerationToWorkflow(
          params,
          referenceImages
        );

        expect(workflow.steps[0].args.referenceImages).toEqual(referenceImages);
      });

      it('应该把目标图片绑定字段放在任务参数顶层', () => {
        const params = createMockParams({
          generationType: 'image',
          prompt: '保留构图，改成夜景',
          extraParams: {
            generationMode: 'image_to_image',
            replaceElementId: 'image-1',
            targetElementId: 'image-1',
            anchorId: 'anchor-1',
            sourceTaskId: 'task-old',
            sourcePrompt: '白天城市街景',
            quality: 'high',
          },
        });

        const workflow = convertDirectGenerationToWorkflow(params, [
          'https://example.com/original.png',
        ]);

        expect(workflow.steps[0].args).toMatchObject({
          generationMode: 'image_to_image',
          referenceImages: ['https://example.com/original.png'],
          replaceElementId: 'image-1',
          targetElementId: 'image-1',
          anchorId: 'anchor-1',
          sourceTaskId: 'task-old',
          sourcePrompt: '白天城市街景',
          params: { quality: 'high' },
        });
      });

      it('单张图片带蒙版时应该创建 image_edit 请求参数', () => {
        const params = createMockParams({
          generationType: 'image',
          prompt: '只修改涂抹区域',
          selection: {
            texts: [],
            images: ['https://example.com/source.png'],
            videos: [],
            graphics: [],
            maskImage: '/__aitu_cache__/image/mask.png',
          },
        });

        const workflow = convertDirectGenerationToWorkflow(params, [
          'https://example.com/source.png',
        ]);

        expect(workflow.steps[0].args).toMatchObject({
          referenceImages: ['https://example.com/source.png'],
          generationMode: 'image_edit',
          maskImage: '/__aitu_cache__/image/mask.png',
        });
      });

      it('应该把知识库上下文 refs 传递到直接生成步骤和元数据', () => {
        const params = createMockParams({
          generationType: 'image',
          prompt: '品牌海报',
          knowledgeContextRefs,
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.knowledgeContextRefs).toEqual(
          knowledgeContextRefs
        );
        expect(workflow.metadata.knowledgeContextRefs).toEqual(
          knowledgeContextRefs
        );
      });

      it('应该使用默认宽高 1x1', () => {
        const params = createMockParams({
          generationType: 'image',
          size: undefined,
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.size).toBeUndefined();
      });

      it('应该正确处理自定义尺寸', () => {
        const params = createMockParams({
          generationType: 'image',
          size: '16x9',
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.size).toBe('16x9');
      });
    });

    describe('视频生成场景', () => {
      it('应该正确转换视频生成请求', () => {
        const params = createMockParams({
          generationType: 'video',
          modelId: 'veo3',
          prompt: '日落场景',
          count: 1,
          size: '16x9',
          duration: '8',
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.generationType).toBe('video');
        expect(workflow.steps).toHaveLength(1);
        expect(workflow.steps[0].mcp).toBe('generate_video');
        expect(workflow.steps[0].args).toMatchObject({
          prompt: '日落场景',
          size: '16x9',
          seconds: '8',
          model: 'veo3',
          workflowId: workflow.id,
          batchId: `wf_batch_${workflow.id}`,
          batchIndex: 1,
          batchTotal: 1,
          globalIndex: 1,
        });
      });

      it('应该使用默认视频尺寸 16x9', () => {
        const params = createMockParams({
          generationType: 'video',
          size: undefined,
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.size).toBeUndefined();
      });

      it('应该正确处理视频时长', () => {
        const params = createMockParams({
          generationType: 'video',
          duration: '15',
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.seconds).toBe('15');
      });

      it('Seedance 2.0 应该透传选中的参考视频', () => {
        const params = createMockParams({
          generationType: 'video',
          modelId: 'doubao-seedance-2-0-260128',
          selection: {
            texts: [],
            images: [],
            videos: ['https://example.com/reference.mp4'],
            graphics: [],
          },
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.params).toMatchObject({
          input_video: 'https://example.com/reference.mp4',
        });
      });

      it('Seedance 2.0 应该独立透传分辨率与比例', () => {
        const params = createMockParams({
          generationType: 'video',
          modelId: 'doubao-seedance-2-0-260128',
          size: '1080p',
          extraParams: { ratio: 'adaptive' },
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.size).toBe('1080p');
        expect(workflow.steps[0].args.params).toMatchObject({
          ratio: 'adaptive',
        });
      });

      it('应该把视频目标绑定字段放在任务参数顶层', () => {
        const params = createMockParams({
          generationType: 'video',
          extraParams: {
            replaceElementId: 'video-1',
            sourcePrompt: '原视频提示词',
            ratio: '16:9',
          },
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args).toMatchObject({
          replaceElementId: 'video-1',
          sourcePrompt: '原视频提示词',
          params: { ratio: '16:9' },
        });
      });

      it('应该使用默认时长 5 秒', () => {
        const params = createMockParams({
          generationType: 'video',
          duration: undefined,
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args.seconds).toBe('5');
      });
    });

    describe('音频生成场景', () => {
      it('应该正确转换音频生成请求并保留工作流元数据', () => {
        const params = createMockParams({
          generationType: 'audio',
          modelId: 'suno-v4',
          prompt: '写一首温柔的民谣',
          size: undefined,
          extraParams: {
            sunoAction: 'music',
          },
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.generationType).toBe('audio');
        expect(workflow.steps).toHaveLength(1);
        expect(workflow.steps[0].mcp).toBe('generate_audio');
        expect(workflow.steps[0].args).toMatchObject({
          prompt: '写一首温柔的民谣',
          model: 'suno-v4',
          sunoAction: 'music',
          workflowId: workflow.id,
          batchId: `wf_batch_${workflow.id}`,
          batchIndex: 1,
          batchTotal: 1,
          globalIndex: 1,
        });
      });

      it('应该把音频目标绑定字段放在任务参数顶层', () => {
        const params = createMockParams({
          generationType: 'audio',
          extraParams: {
            replaceElementId: 'audio-1',
            sourcePrompt: '原音频提示词',
            sunoAction: 'music',
          },
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args).toMatchObject({
          replaceElementId: 'audio-1',
          sourcePrompt: '原音频提示词',
          params: { sunoAction: 'music' },
        });
      });
    });

    describe('文本生成场景', () => {
      it('应该正确转换文本生成请求', () => {
        const params = createMockParams({
          generationType: 'text',
          modelId: 'deepseek-v3.2',
          prompt: '写一份会议纪要',
          size: undefined,
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.generationType).toBe('text');
        expect(workflow.name).toBe('文本生成');
        expect(workflow.steps).toHaveLength(1);
        expect(workflow.steps[0].mcp).toBe('generate_text');
        expect(workflow.steps[0].args).toMatchObject({
          prompt: '写一份会议纪要',
          model: 'deepseek-v3.2',
          workflowId: workflow.id,
          batchId: `wf_batch_${workflow.id}`,
          batchIndex: 1,
          batchTotal: 1,
          globalIndex: 1,
        });
      });

      it('应该把文本目标绑定字段放在任务参数顶层', () => {
        const params = createMockParams({
          generationType: 'text',
          extraParams: {
            replaceElementId: 'text-1',
            sourcePrompt: '原文本提示词',
            temperature: '0.7',
          },
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.steps[0].args).toMatchObject({
          replaceElementId: 'text-1',
          sourcePrompt: '原文本提示词',
          params: { temperature: '0.7' },
        });
      });
    });

    describe('工作流元数据', () => {
      it('应该生成唯一的工作流 ID', () => {
        const params = createMockParams();

        const workflow1 = convertDirectGenerationToWorkflow(params);
        const workflow2 = convertDirectGenerationToWorkflow(params);

        expect(workflow1.id).toBeDefined();
        expect(workflow2.id).toBeDefined();
        expect(workflow1.id).not.toBe(workflow2.id);
      });

      it('应该设置正确的工作流名称和描述', () => {
        const params = createMockParams({
          generationType: 'image',
          count: 2,
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.name).toContain('图片');
        expect(workflow.description).toContain('2');
      });

      it('应该包含创建时间', () => {
        const beforeTime = Date.now();
        const params = createMockParams();

        const workflow = convertDirectGenerationToWorkflow(params);
        const afterTime = Date.now();

        expect(workflow.createdAt).toBeGreaterThanOrEqual(beforeTime);
        expect(workflow.createdAt).toBeLessThanOrEqual(afterTime);
      });

      it('应该在 metadata 中保存原始参数', () => {
        const params = createMockParams({
          prompt: '测试提示词',
          modelId: 'gemini-3-pro-image-preview',
        });

        const workflow = convertDirectGenerationToWorkflow(params);

        expect(workflow.metadata).toBeDefined();
        expect(workflow.metadata.prompt).toBe('测试提示词');
        expect(workflow.metadata.modelId).toBe('gemini-3-pro-image-preview');
      });
    });
  });

  describe('convertAgentFlowToWorkflow', () => {
    it('应该创建包含分析步骤的工作流', () => {
      const params = createMockParams({
        scenario: 'agent_flow',
        prompt: '帮我生成一张猫的图片并添加文字',
      });

      const workflow = convertAgentFlowToWorkflow(params);

      expect(workflow.scenarioType).toBe('agent_flow');
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.steps[0].id).toMatch(/-step-analyze$/);
      expect(workflow.steps[0].mcp).toBe('ai_analyze');
      expect(workflow.steps[0].status).toBe('pending');
    });

    it('应该在 args 中包含上下文信息', () => {
      const params = createMockParams({
        scenario: 'agent_flow',
        prompt: '复杂任务描述',
        defaultModels: {
          image: 'gpt-image-2',
          video: 'seedance-1.5-pro',
          audio: 'suno_music',
        },
        defaultModelRefs: {
          image: { profileId: 'image-profile', modelId: 'gpt-image-2' },
          video: { profileId: 'video-profile', modelId: 'seedance-1.5-pro' },
          audio: { profileId: 'audio-profile', modelId: 'suno_music' },
        },
      });
      const referenceImages = ['https://example.com/ref.jpg'];

      const workflow = convertAgentFlowToWorkflow(params, referenceImages);

      expect(workflow.steps[0].args.context).toBeDefined();
      expect((workflow.steps[0].args.context as any).finalPrompt).toBe(
        '复杂任务描述'
      );
      expect((workflow.steps[0].args.context as any).selection).toBeDefined();
      expect((workflow.steps[0].args.context as any).defaultModels.image).toBe(
        'gpt-image-2'
      );
      expect(
        (workflow.steps[0].args.context as any).defaultModelRefs.image
      ).toEqual({
        profileId: 'image-profile',
        modelId: 'gpt-image-2',
      });
    });

    it('应该把知识库上下文 refs 传递到 Agent 分析步骤', () => {
      const params = createMockParams({
        scenario: 'agent_flow',
        prompt: '基于品牌笔记生成一组图',
        knowledgeContextRefs,
      });

      const workflow = convertAgentFlowToWorkflow(params);

      expect(workflow.steps[0].args.knowledgeContextRefs).toEqual(
        knowledgeContextRefs
      );
      expect(
        (workflow.steps[0].args.context as any).knowledgeContextRefs
      ).toEqual(knowledgeContextRefs);
      expect(workflow.metadata.knowledgeContextRefs).toEqual(
        knowledgeContextRefs
      );
    });
  });

  describe('convertToWorkflow', () => {
    it('应该根据 scenario 分发到正确的转换函数 - direct_generation', () => {
      const params = createMockParams({
        scenario: 'direct_generation',
        generationType: 'image',
      });

      const workflow = convertToWorkflow(params);

      expect(workflow.scenarioType).toBe('direct_generation');
      expect(workflow.steps[0].mcp).toBe('generate_image');
    });

    it('应该根据 scenario 分发到正确的转换函数 - agent_flow', () => {
      const params = createMockParams({
        scenario: 'agent_flow',
      });

      const workflow = convertToWorkflow(params);

      expect(workflow.scenarioType).toBe('agent_flow');
      expect(workflow.steps[0].mcp).toBe('ai_analyze');
    });
  });

  describe('convertSkillFlowToWorkflow', () => {
    it('DSL 媒体步骤应使用 Agent Skill 选择的媒体模型', async () => {
      const imageRef = { profileId: 'image-profile', modelId: 'gpt-image-2' };
      const params = createMockParams({
        scenario: 'agent_flow',
        generationType: 'agent',
        modelId: 'deepseek-v3.2',
        modelRef: { profileId: 'text-profile', modelId: 'deepseek-v3.2' },
        prompt: '生成宫格图',
        defaultModels: { image: 'gpt-image-2' },
        defaultModelRefs: { image: imageRef },
      });

      const workflow = await convertSkillFlowToWorkflow(params, {
        id: 'grid',
        name: '宫格图',
        type: 'system',
        mcpTool: 'generate_grid_image',
        outputType: 'image',
        description: '调用 generate_grid_image\n- rows: 3\n- cols: 3',
      });

      expect(workflow.steps[0].mcp).toBe('generate_grid_image');
      expect(workflow.steps[0].args.model).toBe('gpt-image-2');
      expect(workflow.steps[0].args.modelRef).toEqual(imageRef);
    });

    it('DSL 媒体步骤应继承知识库上下文 refs', async () => {
      const params = createMockParams({
        scenario: 'agent_flow',
        generationType: 'agent',
        modelId: 'deepseek-v3.2',
        prompt: '生成宫格图',
        knowledgeContextRefs,
      });

      const workflow = await convertSkillFlowToWorkflow(params, {
        id: 'grid',
        name: '宫格图',
        type: 'system',
        mcpTool: 'generate_image',
        outputType: 'image',
        description: '调用 generate_image\n- prompt: {{input}}',
      });

      expect(workflow.steps[0].mcp).toBe('generate_image');
      expect(workflow.steps[0].args.knowledgeContextRefs).toEqual(
        knowledgeContextRefs
      );
      expect(workflow.metadata.knowledgeContextRefs).toEqual(
        knowledgeContextRefs
      );
    });

    it('PPT Skill 只将文本模型和参考图片透传给 generate_ppt', async () => {
      const imageRef = { profileId: 'image-profile', modelId: 'gpt-image-2' };
      const textRef = { profileId: 'text-profile', modelId: 'deepseek-v3.2' };
      const params = createMockParams({
        scenario: 'agent_flow',
        generationType: 'agent',
        modelId: 'deepseek-v3.2',
        modelRef: textRef,
        prompt: '做一个 AI PPT',
        defaultModels: { image: 'gpt-image-2' },
        defaultModelRefs: { image: imageRef },
      });
      const referenceImages = ['https://example.com/reference.png'];

      const workflow = await convertSkillFlowToWorkflow(
        params,
        {
          id: 'ppt',
          name: '生成PPT大纲',
          type: 'system',
          mcpTool: 'generate_ppt',
          outputType: 'ppt',
          description: '调用 generate_ppt',
        },
        referenceImages
      );

      expect(workflow.steps[0].mcp).toBe('generate_ppt');
      expect(workflow.steps[0].args.referenceImages).toEqual(referenceImages);
      expect(workflow.steps[0].args.model).toBeUndefined();
      expect(workflow.steps[0].args.modelRef).toBeUndefined();
      expect(workflow.steps[0].args.imageModel).toBeUndefined();
      expect(workflow.steps[0].args.imageModelRef).toBeUndefined();
      expect(workflow.steps[0].args.textModel).toBe('deepseek-v3.2');
      expect(workflow.steps[0].args.textModelRef).toEqual(textRef);
      expect(workflow.metadata.referenceImages).toEqual(referenceImages);
    });

    it('图片型 skill 在回退到 Agent 路径时仍应注入 generate_image 工具链', async () => {
      const params = createMockParams({
        scenario: 'agent_flow',
        generationType: 'agent',
        modelId: 'deepseek-v3.2',
        prompt: '做一张小红书封面图，春日露营咖啡氛围',
        userInstruction: '做一张小红书封面图，春日露营咖啡氛围',
        rawInput: '做一张小红书封面图，春日露营咖啡氛围',
        hasExtraContent: true,
      });

      const workflow = await convertSkillFlowToWorkflow(params, {
        id: 'xhs-image-skill',
        name: '小红书图',
        type: 'external',
        outputType: 'image',
        content:
          '你是小红书图片设计专家。先分析主题，再产出适合封面的高质量图片提示词。不要只返回文案。',
      });

      expect(workflow.scenarioType).toBe('skill_flow');
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.steps[0].mcp).toBe('ai_analyze');

      const messages = workflow.steps[0].args.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain('generate_image');
      expect(messages[0].content).toContain('必须实际调用工具生成图片');
    });

    it('Skill 回退到 Agent 路径时应携带知识库上下文 refs', async () => {
      const params = createMockParams({
        scenario: 'agent_flow',
        generationType: 'agent',
        modelId: 'deepseek-v3.2',
        prompt: '按品牌笔记写一段文案',
        knowledgeContextRefs,
      });

      const workflow = await convertSkillFlowToWorkflow(params, {
        id: 'copy-skill',
        name: '品牌文案',
        type: 'external',
        outputType: 'text',
        content: '你是品牌文案专家，输出简洁中文文案。',
      });

      expect(workflow.steps[0].mcp).toBe('ai_analyze');
      expect(workflow.steps[0].args.knowledgeContextRefs).toEqual(
        knowledgeContextRefs
      );
      expect(
        (workflow.steps[0].args.context as any).knowledgeContextRefs
      ).toEqual(knowledgeContextRefs);
    });
  });

  describe('parseAIResponseToSteps', () => {
    it('应该解析 JSON 格式的 AI 响应', () => {
      const response = JSON.stringify({
        content: 'analysis',
        next: [
          {
            mcp: 'generate_image',
            args: { prompt: 'test' },
            description: '生成图片',
          },
          { mcp: 'add_text', args: { text: 'hello' }, description: '添加文字' },
        ],
      });

      const steps = parseAIResponseToSteps(response);

      expect(steps).toHaveLength(2);
      expect(steps[0].mcp).toBe('generate_image');
      expect(steps[0].args.prompt).toBe('test');
      expect(steps[1].mcp).toBe('add_text');
    });

    it('应该解析 markdown code block 包裹的 JSON', () => {
      const response = `
这是 AI 的分析结果：

\`\`\`json
{
  "content": "analysis",
  "next": [
    { "mcp": "generate_video", "args": { "prompt": "sunset" }, "description": "生成视频" }
  ]
}
\`\`\`

以上是执行计划。
`;

      const steps = parseAIResponseToSteps(response);

      expect(steps).toHaveLength(1);
      expect(steps[0].mcp).toBe('generate_video');
    });

    it('应该为步骤生成正确的 ID', () => {
      const response = JSON.stringify({
        content: 'analysis',
        next: [
          { mcp: 'step1', args: {}, description: 'Step 1' },
          { mcp: 'step2', args: {}, description: 'Step 2' },
        ],
      });

      const steps = parseAIResponseToSteps(response);

      expect(steps[0].id).toBe('step-1');
      expect(steps[1].id).toBe('step-2');
    });

    it('应该使用 existingStepCount 计算步骤 ID', () => {
      const response = JSON.stringify({
        content: 'analysis',
        next: [{ mcp: 'new_step', args: {}, description: 'New Step' }],
      });

      const steps = parseAIResponseToSteps(response, 5);

      expect(steps[0].id).toBe('step-6');
    });

    it('应该为解析的步骤设置 pending 状态', () => {
      const response = JSON.stringify({
        content: 'analysis',
        next: [{ mcp: 'test', args: {}, description: 'Test' }],
      });

      const steps = parseAIResponseToSteps(response);

      expect(steps[0].status).toBe('pending');
    });

    it('应该在无效 JSON 时返回空数组', () => {
      const invalidResponse = 'This is not valid JSON';

      const steps = parseAIResponseToSteps(invalidResponse);

      expect(steps).toEqual([]);
    });

    it('应该在缺少 next 字段时返回空数组', () => {
      const response = JSON.stringify({ other: 'data' });

      const steps = parseAIResponseToSteps(response);

      expect(steps).toEqual([]);
    });
  });

  describe('updateStepStatus', () => {
    const createMockWorkflow = (): WorkflowDefinition => ({
      id: 'test-workflow',
      name: 'Test Workflow',
      description: 'Test',
      scenarioType: 'direct_generation',
      generationType: 'image',
      steps: [
        {
          id: 'step-1',
          mcp: 'test1',
          args: {},
          description: 'Step 1',
          status: 'pending',
        },
        {
          id: 'step-2',
          mcp: 'test2',
          args: {},
          description: 'Step 2',
          status: 'pending',
        },
        {
          id: 'step-3',
          mcp: 'test3',
          args: {},
          description: 'Step 3',
          status: 'pending',
        },
      ],
      createdAt: Date.now(),
    });

    it('应该更新指定步骤的状态', () => {
      const workflow = createMockWorkflow();

      const updated = updateStepStatus(workflow, 'step-2', 'running');

      expect(updated.steps[1].status).toBe('running');
      expect(updated.steps[0].status).toBe('pending');
      expect(updated.steps[2].status).toBe('pending');
    });

    it('应该更新步骤的 result', () => {
      const workflow = createMockWorkflow();
      const result = { url: 'https://example.com/image.jpg' };

      const updated = updateStepStatus(workflow, 'step-1', 'completed', result);

      expect(updated.steps[0].status).toBe('completed');
      expect(updated.steps[0].result).toEqual(result);
    });

    it('应该更新步骤的 error', () => {
      const workflow = createMockWorkflow();
      const error = 'Generation failed';

      const updated = updateStepStatus(
        workflow,
        'step-1',
        'failed',
        undefined,
        error
      );

      expect(updated.steps[0].status).toBe('failed');
      expect(updated.steps[0].error).toBe(error);
    });

    it('应该更新步骤的 duration', () => {
      const workflow = createMockWorkflow();

      const updated = updateStepStatus(
        workflow,
        'step-1',
        'completed',
        undefined,
        undefined,
        5000
      );

      expect(updated.steps[0].duration).toBe(5000);
    });

    it('应该保持不可变性 - 返回新对象', () => {
      const workflow = createMockWorkflow();

      const updated = updateStepStatus(workflow, 'step-1', 'running');

      expect(updated).not.toBe(workflow);
      expect(updated.steps).not.toBe(workflow.steps);
      expect(updated.steps[0]).not.toBe(workflow.steps[0]);
    });

    it('应该保持未修改步骤的引用', () => {
      const workflow = createMockWorkflow();

      const updated = updateStepStatus(workflow, 'step-1', 'running');

      // 未修改的步骤应该保持相同引用（浅拷贝优化）
      expect(updated.steps[1]).toBe(workflow.steps[1]);
      expect(updated.steps[2]).toBe(workflow.steps[2]);
    });
  });

  describe('addStepsToWorkflow', () => {
    const createMockWorkflow = (): WorkflowDefinition => ({
      id: 'test-workflow',
      name: 'Test Workflow',
      description: 'Test',
      scenarioType: 'agent_flow',
      generationType: 'image',
      steps: [
        {
          id: 'step-1',
          mcp: 'analyze',
          args: {},
          description: 'Analyze',
          status: 'completed',
        },
      ],
      createdAt: Date.now(),
    });

    it('应该添加新步骤到工作流', () => {
      const workflow = createMockWorkflow();
      const newSteps: WorkflowStep[] = [
        {
          id: 'step-2',
          mcp: 'generate',
          args: {},
          description: 'Generate',
          status: 'pending',
        },
      ];

      const updated = addStepsToWorkflow(workflow, newSteps);

      expect(updated.steps).toHaveLength(2);
      expect(updated.steps[1].id).toBe('step-2');
    });

    it('应该保持原有步骤不变', () => {
      const workflow = createMockWorkflow();
      const newSteps: WorkflowStep[] = [
        {
          id: 'step-2',
          mcp: 'new',
          args: {},
          description: 'New',
          status: 'pending',
        },
      ];

      const updated = addStepsToWorkflow(workflow, newSteps);

      expect(updated.steps[0]).toEqual(workflow.steps[0]);
    });

    it('应该支持添加多个步骤', () => {
      const workflow = createMockWorkflow();
      const newSteps: WorkflowStep[] = [
        {
          id: 'step-2',
          mcp: 'step2',
          args: {},
          description: 'Step 2',
          status: 'pending',
        },
        {
          id: 'step-3',
          mcp: 'step3',
          args: {},
          description: 'Step 3',
          status: 'pending',
        },
        {
          id: 'step-4',
          mcp: 'step4',
          args: {},
          description: 'Step 4',
          status: 'pending',
        },
      ];

      const updated = addStepsToWorkflow(workflow, newSteps);

      expect(updated.steps).toHaveLength(4);
    });

    it('应该保持不可变性', () => {
      const workflow = createMockWorkflow();
      const newSteps: WorkflowStep[] = [
        {
          id: 'step-2',
          mcp: 'new',
          args: {},
          description: 'New',
          status: 'pending',
        },
      ];

      const updated = addStepsToWorkflow(workflow, newSteps);

      expect(updated).not.toBe(workflow);
      expect(updated.steps).not.toBe(workflow.steps);
    });
  });

  describe('getWorkflowStatus', () => {
    const createWorkflowWithSteps = (
      statuses: WorkflowStep['status'][]
    ): WorkflowDefinition => ({
      id: 'test',
      name: 'Test',
      description: 'Test',
      scenarioType: 'direct_generation',
      generationType: 'image',
      steps: statuses.map((status, i) => ({
        id: `step-${i + 1}`,
        mcp: 'test',
        args: {},
        description: `Step ${i + 1}`,
        status,
      })),
      createdAt: Date.now(),
    });

    it('应该在所有步骤完成时返回 completed', () => {
      const workflow = createWorkflowWithSteps([
        'completed',
        'completed',
        'completed',
      ]);

      const status = getWorkflowStatus(workflow);

      expect(status.status).toBe('completed');
      expect(status.completedSteps).toBe(3);
      expect(status.totalSteps).toBe(3);
    });

    it('应该在有失败步骤时返回 failed', () => {
      const workflow = createWorkflowWithSteps([
        'completed',
        'failed',
        'pending',
      ]);

      const status = getWorkflowStatus(workflow);

      expect(status.status).toBe('failed');
    });

    it('应该在有运行中步骤时返回 running', () => {
      const workflow = createWorkflowWithSteps([
        'completed',
        'running',
        'pending',
      ]);

      const status = getWorkflowStatus(workflow);

      expect(status.status).toBe('running');
      expect(status.currentStep).toBeDefined();
      expect(status.currentStep?.id).toBe('step-2');
    });

    it('应该在所有步骤都是 pending 时返回 pending', () => {
      const workflow = createWorkflowWithSteps([
        'pending',
        'pending',
        'pending',
      ]);

      const status = getWorkflowStatus(workflow);

      expect(status.status).toBe('pending');
    });

    it('应该正确计算已完成步骤数', () => {
      const workflow = createWorkflowWithSteps([
        'completed',
        'completed',
        'running',
        'pending',
      ]);

      const status = getWorkflowStatus(workflow);

      expect(status.completedSteps).toBe(2);
      expect(status.totalSteps).toBe(4);
    });

    it('应该返回当前运行中的步骤', () => {
      const workflow = createWorkflowWithSteps([
        'completed',
        'running',
        'pending',
      ]);

      const status = getWorkflowStatus(workflow);

      expect(status.currentStep).toBeDefined();
      expect(status.currentStep?.status).toBe('running');
    });

    it('应该在没有运行中步骤时返回第一个 pending 步骤', () => {
      const workflow = createWorkflowWithSteps([
        'completed',
        'completed',
        'pending',
      ]);

      const status = getWorkflowStatus(workflow);

      // 实现返回第一个 pending 步骤作为 currentStep
      expect(status.currentStep).toBeDefined();
      expect(status.currentStep?.status).toBe('pending');
    });
  });
});
