/**
 * 场景转换器
 *
 * 将 AIInputBar 的4种发送场景转换为工作流定义
 *
 * 场景1: 只有选择元素，没有输入文字 -> 直接生成
 * 场景2: 输入内容有模型、参数 -> 解析后直接生成
 * 场景3: 输入内容指定了数量 -> 按数量生成
 * 场景4: 输入内容包含其他内容 -> 走 Agent 流程（调用文本模型获取工作流）
 */

import type {
  ParsedGenerationParams,
  GenerationType,
  SelectionInfo,
} from '../../utils/ai-input-parser';
import type { ModelRef } from '../../utils/settings-manager';
import { cleanLLMResponse } from '../../services/agent/tool-parser';
import {
  generateSystemPrompt,
  generateReferenceImagesPrompt,
  buildStructuredUserMessage,
} from '../../services/agent';
import { mcpRegistry } from '../../mcp/registry';
import type { SystemSkill } from '../../constants/skills';
import {
  SKILL_AUTO_ID,
  isSystemSkillId,
  findSystemSkillById,
} from '../../constants/skills';
import { SkillDSLParser } from './skill-dsl-parser';
import { SkillLLMParser } from './skill-llm-parser';
import type { SkillDSLVariables } from './skill-dsl.types';
import { preprocessExternalSkillContent } from '../../services/external-skill-parser';

/**
 * 工作流步骤执行选项（批量参数等）
 */
export interface WorkflowStepOptions {
  /** 执行模式 */
  mode?: 'async' | 'queue';
  /** 批次 ID */
  batchId?: string;
  /** 批次索引（1-based） */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引 */
  globalIndex?: number;
}

/**
 * 工作流步骤定义
 */
export interface WorkflowStep {
  /** 步骤 ID */
  id: string;
  /** MCP 工具名称 */
  mcp: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 执行选项（批量参数等） */
  options?: WorkflowStepOptions;
  /** 步骤描述 */
  description: string;
  /** 步骤状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration?: number;
}

/**
 * 工作流定义
 */
export interface WorkflowDefinition {
  /** 工作流 ID */
  id: string;
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description: string;
  /** 场景类型 */
  scenarioType: 'direct_generation' | 'agent_flow' | 'skill_flow';
  /** 选中的 Skill ID（skill_flow 时有值） */
  skillId?: string;
  /** 生成类型 */
  generationType: GenerationType;
  /** 工作流状态 */
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** AI 分析内容（AI 对用户请求的理解和计划） */
  aiAnalysis?: string;
  /** 步骤列表 */
  steps: WorkflowStep[];
  /** 元数据 */
  metadata: {
    /** 最终生成用的提示词 */
    prompt: string;
    /** 用户输入的指令（可能包含额外要求） */
    userInstruction: string;
    /** 原始输入文本 */
    rawInput: string;
    /** 模型 ID */
    modelId: string;
    /** 模型来源引用 */
    modelRef?: ModelRef | null;
    /** 是否为用户显式选择的模型 */
    isModelExplicit: boolean;
    /** 生成数量 */
    count: number;
    /** 尺寸参数（如 '16x9', '1x1'） */
    size?: string;
    /** 时长（视频） */
    duration?: string;
    /** 参考图片（图片 + 图形） */
    referenceImages?: string[];
    /** 选中元素的分类信息 */
    selection: SelectionInfo;
    /** 解析方式标记（用于调试和数据分析） */
    parseMethod?: 'regex' | 'llm' | 'agent_fallback';
  };
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt?: number;
  /** 上下文信息（从 SW 恢复时使用） */
  context?: {
    userInput?: string;
    model?: string;
    modelRef?: ModelRef | null;
    referenceImages?: string[];
  };
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 生成唯一的工作流 ID
 *
 * 注意：之前使用基于内容哈希的 ID 来实现幂等性，但这会导致用户无法用相同提示词重复生成。
 * 防重复逻辑应该在 AI 输入框层面做（让用户确认），而不是在 SW 层面静默跳过。
 * 现在改为使用时间戳 + 随机字符串，确保每次提交都是唯一的工作流。
 */
function generateWorkflowId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 场景1-3: 将直接生成场景转换为工作流定义
 *
 * 这些场景通过正则解析用户输入，直接生成图片/视频
 * 步骤中包含完整的工具调用信息（mcp、args、options），调用方可直接执行
 */
export function convertDirectGenerationToWorkflow(
  params: ParsedGenerationParams,
  referenceImages: string[] = []
): WorkflowDefinition {
  const {
    generationType,
    modelId,
    modelRef,
    isModelExplicit,
    prompt,
    userInstruction,
    rawInput,
    count,
    size,
    duration,
    extraParams,
    selection,
  } = params;

  const steps: WorkflowStep[] = [];

  // 使用唯一 ID（每次提交都是新的工作流）
  const workflowId = generateWorkflowId();

  // 生成批次 ID（用于区分同一批次中的不同任务）
  const batchId = `wf_batch_${workflowId}`;

  // 根据数量创建多个生成步骤
  for (let i = 0; i < count; i++) {
    const stepId = `${workflowId}-step-${i + 1}`;

    // 通用的执行选项
    const options: WorkflowStepOptions = {
      mode: 'queue',
      batchId,
      batchIndex: i + 1,
      batchTotal: count,
      globalIndex: i + 1,
    };

    if (generationType === 'image') {
      // 构建图片生成参数，size 为 undefined 时不传（让模型自动决定）
      // 注意：batchId 等参数直接放在 args 中，确保传输时不会丢失
      const imageArgs: Record<string, unknown> = {
        prompt,
        model: modelId,
        modelRef,
        // 批量生成参数直接放在 args 中
        batchId,
        batchIndex: i + 1,
        batchTotal: count,
        globalIndex: i + 1,
      };
      if (size) {
        imageArgs.size = size;
      }
      if (referenceImages.length > 0) {
        imageArgs.referenceImages = referenceImages;
      }
      // 透传额外参数（如 seedream_quality）
      if (extraParams) {
        imageArgs.params = extraParams;
      }

      steps.push({
        id: stepId,
        mcp: 'generate_image',
        args: imageArgs,
        options,
        description: count > 1 ? `生成图片 (${i + 1}/${count})` : '生成图片',
        status: 'pending',
      });
    } else if (generationType === 'video') {
      // 构建视频生成参数，size 为 undefined 时不传（让模型自动决定）
      // 注意：batchId 等参数直接放在 args 中，确保传输时不会丢失
      const videoArgs: Record<string, unknown> = {
        prompt,
        model: modelId,
        modelRef,
        seconds: duration || '5',
        // 批量生成参数直接放在 args 中
        batchId,
        batchIndex: i + 1,
        batchTotal: count,
        globalIndex: i + 1,
      };
      if (size) {
        videoArgs.size = size;
      }
      if (referenceImages.length > 0) {
        videoArgs.referenceImages = referenceImages;
      }
      // 透传额外参数（如 aspect_ratio）
      if (extraParams) {
        videoArgs.params = extraParams;
      }

      steps.push({
        id: stepId,
        mcp: 'generate_video',
        args: videoArgs,
        options,
        description: count > 1 ? `生成视频 (${i + 1}/${count})` : '生成视频',
        status: 'pending',
      });
    } else {
      const sunoAction =
        typeof extraParams?.sunoAction === 'string'
          ? extraParams.sunoAction
          : 'music';
      const isLyricsAction = sunoAction === 'lyrics';
      const audioArgs: Record<string, unknown> = {
        prompt,
        model: modelId,
        modelRef,
        sunoAction,
        batchId,
        batchIndex: i + 1,
        batchTotal: count,
        globalIndex: i + 1,
      };

      if (extraParams) {
        audioArgs.params = extraParams;
        if (extraParams.notifyHook) {
          audioArgs.notifyHook = extraParams.notifyHook;
        }
        if (!isLyricsAction && extraParams.mv) {
          audioArgs.mv = extraParams.mv;
        }
        if (!isLyricsAction && extraParams.title) {
          audioArgs.title = extraParams.title;
        }
        if (!isLyricsAction && extraParams.tags) {
          audioArgs.tags = extraParams.tags;
        }
        if (!isLyricsAction && extraParams.continueClipId) {
          audioArgs.continueClipId = extraParams.continueClipId;
        }
        if (
          !isLyricsAction &&
          extraParams.continueAt !== undefined &&
          extraParams.continueAt !== null &&
          extraParams.continueAt !== ''
        ) {
          audioArgs.continueAt = Number(extraParams.continueAt);
        }
      }

      steps.push({
        id: stepId,
        mcp: 'generate_audio',
        args: audioArgs,
        options,
        description:
          count > 1
            ? `${isLyricsAction ? '生成歌词' : '生成音频'} (${i + 1}/${count})`
            : isLyricsAction
            ? '生成歌词'
            : '生成音频',
        status: 'pending',
      });
    }
  }

  const isLyricsWorkflow =
    generationType === 'audio' &&
    steps.every((step) => step.args.sunoAction === 'lyrics');

  return {
    id: workflowId,
    name:
      generationType === 'image'
        ? '图片生成'
        : generationType === 'video'
        ? '视频生成'
        : isLyricsWorkflow
        ? '歌词生成'
        : '音频生成',
    description: `使用 ${modelId} 模型${
      count > 1 ? `生成 ${count} 个` : '生成'
    }${
      generationType === 'image'
        ? '图片'
        : generationType === 'video'
        ? '视频'
        : isLyricsWorkflow
        ? '歌词'
        : '音频'
    }`,
    scenarioType: 'direct_generation',
    generationType,
    steps,
    metadata: {
      prompt,
      userInstruction,
      rawInput,
      modelId,
      modelRef,
      isModelExplicit,
      count,
      size,
      duration,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      selection,
    },
    createdAt: Date.now(),
  };
}

/**
 * 场景4: 将 Agent 流程转换为工作流定义
 *
 * 这个场景需要先调用文本模型分析用户意图，然后根据分析结果执行工具
 * 初始只创建一个 ai_analyze 步骤，后续步骤由 AI 动态生成
 * 步骤中包含完整的工具调用信息，调用方可直接执行
 */
export function convertAgentFlowToWorkflow(
  params: ParsedGenerationParams,
  referenceImages: string[] = []
): WorkflowDefinition {
  const {
    generationType,
    modelId,
    modelRef,
    isModelExplicit,
    prompt,
    userInstruction,
    rawInput,
    count,
    size,
    duration,
    extraParams,
    selection,
  } = params;

  // 使用唯一 ID（每次提交都是新的工作流）
  const workflowId = generateWorkflowId();

  // 构建 Agent 执行上下文（与 AgentExecutionContext 类型一致）
  // Agent flow 场景下 generationType 不会是 'text'
  const agentContext = {
    userInstruction,
    rawInput,
    model: {
      id: modelId,
      type: generationType as 'image' | 'video' | 'audio',
      isExplicit: isModelExplicit,
    },
    params: {
      count,
      size,
      duration,
      ...extraParams,
    },
    selection,
    finalPrompt: prompt,
  };

  // 收集所有参考图片 URL
  const allReferenceImages = [
    ...(selection.images || []),
    ...(selection.graphics || []),
  ];

  // 构建系统提示词（在应用层构建，传递给 SW）
  let systemPrompt = generateSystemPrompt();
  if (allReferenceImages.length > 0) {
    systemPrompt += generateReferenceImagesPrompt(
      allReferenceImages.length,
      selection.imageDimensions
    );
  }

  // 构建用户消息
  const userMessage = buildStructuredUserMessage(agentContext);

  // 构建 messages 数组（传递给 SW 的 ai_analyze）
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ];

  // Agent 流程初始只有一个 ai_analyze 步骤
  // 后续步骤会在 AI 分析后动态添加
  const steps: WorkflowStep[] = [
    {
      id: `${workflowId}-step-analyze`,
      mcp: 'ai_analyze',
      args: {
        // 主线程 MCP 工具必需：Agent 执行上下文
        context: agentContext,
        // 传递预构建的 messages（SW 直接使用，不重复生成提示词）
        messages,
        // 传递参考图片 URL（用于占位符替换）
        referenceImages:
          allReferenceImages.length > 0 ? allReferenceImages : undefined,
        // 传递用户选择的文本模型（优先于系统配置）
        textModel: modelId,
        modelRef,
      },
      options: {
        mode: 'async',
      },
      description: 'AI 分析用户意图',
      status: 'pending',
    },
  ];

  return {
    id: workflowId,
    name: 'AI 智能生成',
    description: 'AI 分析用户请求并执行相应操作',
    scenarioType: 'agent_flow',
    generationType,
    steps,
    metadata: {
      prompt,
      userInstruction,
      rawInput,
      modelId,
      modelRef,
      isModelExplicit,
      count,
      size,
      duration,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      selection,
    },
    createdAt: Date.now(),
  };
}

/**
 * 根据提取到的工具名列表，生成精准过滤后的工具描述字符串
 *
 * 只包含 Skill 笔记中实际引用的工具描述，减少无关上下文干扰。
 * 若工具名在 registry 中不存在，则跳过（容错）。
 *
 * @param toolNames - 从 Skill 笔记中提取的工具名列表
 * @returns 精准工具描述字符串（Markdown 格式）
 */
function generateFilteredToolsDescription(toolNames: string[]): string {
  const descriptions: string[] = [];

  for (const name of toolNames) {
    const tool = mcpRegistry.getTool(name);
    if (!tool) continue;

    const params = tool.inputSchema.properties || {};
    const required = tool.inputSchema.required || [];
    const guidance = tool.promptGuidance;

    const paramDescriptions = Object.entries(params)
      .map(([pName, schema]) => {
        const isRequired = required.includes(pName);
        const reqStr = isRequired ? '（必填）' : '（可选）';
        const details: string[] = [];
        if (schema.type) details.push(`类型: ${schema.type}`);
        if (schema.enum && Array.isArray(schema.enum)) {
          details.push(
            `可选值: ${schema.enum.map((v: unknown) => `"${v}"`).join(' | ')}`
          );
        }
        if (schema.default !== undefined)
          details.push(`默认: "${schema.default}"`);
        const detailStr = details.length > 0 ? ` [${details.join(', ')}]` : '';
        const paramGuidance = guidance?.parameterGuidance?.[pName];
        const guidanceStr = paramGuidance ? `\n    💡 ${paramGuidance}` : '';
        return `  - **${pName}**${reqStr}: ${
          schema.description || '无描述'
        }${detailStr}${guidanceStr}`;
      })
      .join('\n');

    let toolDesc = `### ${tool.name}\n${tool.description}\n\n**参数:**\n${
      paramDescriptions || '  无参数'
    }`;
    if (guidance?.whenToUse)
      toolDesc += `\n\n**使用场景:** ${guidance.whenToUse}`;
    descriptions.push(toolDesc);
  }

  return descriptions.length > 0 ? descriptions.join('\n\n---\n\n') : '';
}

/**
 * 场景5: 将 Skill 流程转换为工作流定义
 *
 * 系统内置 Skill 和用户自定义 Skill 统一走以下三条路径：
 *
 * - 路径 A（DSL 正则解析）：Skill 笔记内容能被正则解析器成功提取出工具名和参数
 *   → 直接构建 WorkflowStep 执行 MCP 工具，用户输入自动注入主要文本参数
 *
 * - 路径 B（Agent 精准注入）：正则解析失败，但笔记中包含工具名引用
 *   → 只注入相关工具描述 + Skill 笔记作为前置上下文，走 ai_analyze
 *
 * - 路径 C（角色扮演）：正则解析失败且笔记中无工具名引用
 *   → Skill 笔记直接作为 systemPrompt，用户输入作为 userMessage，直接调用 LLM
 *
 * @param params - 解析后的生成参数
 * @param skill - Skill 定义（系统内置或用户自定义）
 * @param referenceImages - 参考图片 URL 列表
 * @param onLLMParsing - LLM 解析路径触发时的回调（用于 UI 显示加载状态）
 */
export async function convertSkillFlowToWorkflow(
  params: ParsedGenerationParams,
  skill:
    | SystemSkill
    | {
        id: string;
        name: string;
        type: 'user' | 'external';
        content: string;
        outputType?: 'image' | 'text' | 'video' | 'ppt';
      },
  referenceImages: string[] = [],
  onLLMParsing?: () => void
): Promise<WorkflowDefinition> {
  const {
    generationType,
    modelRef,
    modelId,
    isModelExplicit,
    prompt,
    userInstruction,
    rawInput,
    count,
    size,
    duration,
    selection,
  } = params;

  const workflowId = generateWorkflowId();

  // 统一获取 Skill 内容：系统 Skill 使用 description，自定义/外部 Skill 使用 content
  const skillId = skill.id;
  const skillName = skill.name;
  const skillContent =
    skill.type === 'system'
      ? (skill as SystemSkill).description
      : (
          skill as {
            id: string;
            name: string;
            type: 'user' | 'external';
            content: string;
          }
        ).content;

  // 用户输入文本（用于自动注入到工具的主要文本参数）
  const userInputText = userInstruction || prompt || rawInput;

  // 构建 DSL 变量（保留兼容性）
  const dslVariables: SkillDSLVariables = {
    input: userInputText,
    count,
    size,
    model: modelId,
  };

  // ─── 路径 A：正则解析（SkillDSLParser）───────────────────────────────────
  // 传入 userInputText，解析器会自动将其注入到缺失的主要文本参数（theme/prompt 等）
  const regexResult = SkillDSLParser.parse(
    skillContent,
    dslVariables,
    workflowId,
    userInputText
  );
  if (regexResult) {
    return {
      id: workflowId,
      name: skillName,
      description: `使用「${skillName}」Skill 生成内容`,
      scenarioType: 'skill_flow',
      skillId,
      generationType,
      steps: regexResult.steps,
      metadata: {
        prompt,
        userInstruction,
        rawInput,
        modelId,
        modelRef,
        isModelExplicit,
        count,
        size,
        duration,
        referenceImages:
          referenceImages.length > 0 ? referenceImages : undefined,
        selection,
        parseMethod: 'regex',
      },
      createdAt: Date.now(),
    };
  }

  // ─── 路径 B / C 公共变量 ──────────────────────────────────────────────────
  const allReferenceImages = [
    ...(selection.images || []),
    ...(selection.graphics || []),
  ];

  const agentContext = {
    userInstruction,
    rawInput,
    model: {
      id: modelId,
      type: generationType as 'image' | 'video' | 'audio',
      isExplicit: isModelExplicit,
    },
    params: { count, size, duration },
    selection,
    finalPrompt: prompt,
  };

  // Skill 内容预处理：对图片类 Skill 进行 content 适配（外部 Skill 和配置了 outputType 的用户 Skill 均适用）
  const isExternalSkill = skill.type === 'external';
  const isUserSkill = skill.type === 'user';

  // 确定 outputType：优先使用显式配置
  const skillOutputType = (
    skill as { outputType?: 'image' | 'text' | 'video' | 'ppt' }
  ).outputType;
  const externalOutputType: 'image' | 'text' =
    skillOutputType === 'image' ? 'image' : 'text';

  // 用户 Skill 配置了 outputType 时，也需要进行内容预处理（用户复制外部 Skill 内容时，需要适配 aitu 环境）
  const needsPreprocess =
    isExternalSkill || (isUserSkill && externalOutputType === 'image');
  const processedSkillContent = needsPreprocess
    ? preprocessExternalSkillContent(skillContent, externalOutputType)
    : skillContent;

  console.log(
    `[SkillFlow] Skill="${skillName}" type=${
      skill.type
    } outputType=${externalOutputType} isExternal=${isExternalSkill} contentLen=${
      processedSkillContent?.length || 0
    }`
  );

  // 从 Skill 笔记中提取工具名引用，用于判断走路径 B 还是路径 C
  const referencedToolNames = SkillDSLParser.extractToolNamesFromContent(
    processedSkillContent
  );
  // 过滤出在 registry 中实际存在的工具名
  const validToolNames = referencedToolNames.filter((name) =>
    mcpRegistry.hasTool(name)
  );

  // 图片类 Skill 强制注入 generate_image 工具，确保走路径 B
  if (externalOutputType === 'image') {
    if (
      !validToolNames.includes('generate_image') &&
      mcpRegistry.hasTool('generate_image')
    ) {
      validToolNames.push('generate_image');
    }
  }

  // 判断是否包含 generate_image（用于后续路径 B/C 的图片生成指引）
  const hasGenerateImage = validToolNames.includes('generate_image');

  console.log(
    `[SkillFlow] referencedTools=[${referencedToolNames.join(
      ','
    )}] validTools=[${validToolNames.join(
      ','
    )}] hasGenerateImage=${hasGenerateImage} → 路径${
      validToolNames.length > 0 ? 'B' : 'C'
    }`
  );

  // ─── 路径 B：Agent 模式，精准注入相关工具描述 ─────────────────────────────
  if (validToolNames.length > 0) {
    // 只注入 Skill 笔记中引用的工具描述
    const filteredToolsDesc = generateFilteredToolsDescription(validToolNames);

    // Skill 笔记内容作为前置上下文，工具描述紧随其后
    // 外部 Skill 和配置了 outputType 的用户 Skill 均使用预处理后的内容
    const pathBContent = processedSkillContent;
    let systemPrompt = `## 当前激活的 Skill：${skillName}\n\n${pathBContent}`;
    if (filteredToolsDesc) {
      systemPrompt += `\n\n## 可用工具\n\n${filteredToolsDesc}`;
    }
    if (allReferenceImages.length > 0) {
      systemPrompt += generateReferenceImagesPrompt(
        allReferenceImages.length,
        selection.imageDimensions
      );
    }

    // 添加响应格式约束（与 generateSystemPrompt 保持一致）
    systemPrompt += `\n\n## 响应格式（严格遵守）\n\n你的响应必须是一个有效的 JSON 对象：\n{"content": "你的分析内容", "next": [{"mcp": "工具名称", "args": {"参数名": "参数值"}}]}`;

    // 图片类 Skill（outputType 为 image）：追加执行要求
    if (hasGenerateImage) {
      systemPrompt += `\n\n## 执行要求\n\n你必须严格按照以上 Skill 工作流指令执行。最终目标是：\n1. 基于用户输入内容，按照 Skill 中的步骤分析并构建高质量的图片描述 prompt\n2. 调用 generate_image 工具生成图片，将构建好的 prompt 作为参数传入\n3. 不要仅输出文字描述，必须实际调用工具生成图片\n\n你的回复必须包含对 generate_image 工具的调用，例如：\n{"content": "分析与 prompt 构建过程", "next": [{"mcp": "generate_image", "args": {"prompt": "完整的图片描述 prompt"}}]}`;
    }

    const userMessage = buildStructuredUserMessage(agentContext);

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userMessage },
    ];

    const steps: WorkflowStep[] = [
      {
        id: `${workflowId}-step-analyze`,
        mcp: 'ai_analyze',
        args: {
          context: agentContext,
          messages,
          referenceImages:
            allReferenceImages.length > 0 ? allReferenceImages : undefined,
          textModel: modelId,
          modelRef,
        },
        options: { mode: 'async' },
        description: `AI 分析用户意图（Skill: ${skillName}）`,
        status: 'pending',
      },
    ];

    return {
      id: workflowId,
      name: skillName,
      description: `使用「${skillName}」Skill 生成内容`,
      scenarioType: 'skill_flow',
      skillId,
      generationType,
      steps,
      metadata: {
        prompt,
        userInstruction,
        rawInput,
        modelId,
        isModelExplicit,
        count,
        size,
        duration,
        referenceImages:
          referenceImages.length > 0 ? referenceImages : undefined,
        selection,
        parseMethod: 'agent_fallback',
      },
      createdAt: Date.now(),
    };
  }

  // ─── 路径 C：角色扮演模式，Skill 笔记直接作为 systemPrompt ────────────────
  // 正则解析失败且笔记中无工具名引用 → 纯 LLM 角色扮演，不注入任何 MCP 工具描述
  // 外部 Skill 和配置了 mcpTools 的用户 Skill 均使用预处理后的内容
  let roleSystemPrompt = processedSkillContent || '';
  if (allReferenceImages.length > 0) {
    roleSystemPrompt += generateReferenceImagesPrompt(
      allReferenceImages.length,
      selection.imageDimensions
    );
  }

  // 图片类 Skill 降级到路径 C 时，追加图片生成指引（outputType 为 image）
  if (hasGenerateImage) {
    roleSystemPrompt += `\n\n## 重要执行指引\n\n请基于以上 Skill 指令构建详细的图片描述 prompt，并使用以下 JSON 格式回复以调用图片生成工具：\n{"content": "你的分析", "next": [{"mcp": "generate_image", "args": {"prompt": "你构建的完整 prompt"}}]}\n\n你必须实际调用 generate_image 工具生成图片，不要仅输出文字描述。`;
  }

  // 用户输入直接作为 userMessage（不经过 buildStructuredUserMessage，避免注入工具上下文）
  const roleUserMessage = userInputText;

  const roleMessages = [
    { role: 'system' as const, content: roleSystemPrompt },
    { role: 'user' as const, content: roleUserMessage },
  ];

  const roleSteps: WorkflowStep[] = [
    {
      id: `${workflowId}-step-analyze`,
      mcp: 'ai_analyze',
      args: {
        context: agentContext,
        messages: roleMessages,
        referenceImages:
          allReferenceImages.length > 0 ? allReferenceImages : undefined,
        textModel: modelId,
        modelRef,
      },
      options: { mode: 'async' },
      description: `AI 以「${skillName}」角色回复`,
      status: 'pending',
    },
  ];

  return {
    id: workflowId,
    name: skillName,
    description: `使用「${skillName}」Skill 生成内容`,
    scenarioType: 'skill_flow',
    skillId,
    generationType,
    steps: roleSteps,
    metadata: {
      prompt,
      userInstruction,
      rawInput,
      modelId,
      modelRef,
      isModelExplicit,
      count,
      size,
      duration,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      selection,
      parseMethod: 'agent_fallback',
    },
    createdAt: Date.now(),
  };
}

/**
 * 根据解析结果自动选择转换方法
 */
export function convertToWorkflow(
  params: ParsedGenerationParams,
  referenceImages: string[] = []
): WorkflowDefinition {
  if (params.scenario === 'direct_generation') {
    return convertDirectGenerationToWorkflow(params, referenceImages);
  } else {
    return convertAgentFlowToWorkflow(params, referenceImages);
  }
}

/**
 * AI 响应解析结果
 */
export interface AIResponseParseResult {
  /** AI 分析内容（对用户请求的理解和计划） */
  content: string;
  /** 工作流步骤列表 */
  steps: WorkflowStep[];
}

/**
 * 从 AI 响应解析工作流步骤和分析内容
 *
 * AI 返回的格式：
 * {"content": "分析结果", "next": [{"mcp": "工具名", "args": {...}}]}
 */
export function parseAIResponse(
  response: string,
  existingStepCount: number = 0
): AIResponseParseResult {
  try {
    // 使用公共清理函数
    const cleaned = cleanLLMResponse(response);

    // 尝试提取 JSON
    const jsonMatch =
      cleaned.match(/\{\s*"content"\s*:[\s\S]*?"next"\s*:[\s\S]*?\}/) ||
      cleaned.match(/\{[\s\S]*"content"[\s\S]*"next"[\s\S]*\}/);

    if (!jsonMatch) {
      return { content: '', steps: [] };
    }

    const jsonStr = jsonMatch[0];
    const parsed = JSON.parse(jsonStr);

    // 提取 content 字段
    const content = typeof parsed.content === 'string' ? parsed.content : '';

    // 提取 steps
    if (!Array.isArray(parsed.next) || parsed.next.length === 0) {
      return { content, steps: [] };
    }

    const steps = parsed.next
      .filter(
        (item: any) =>
          typeof item.mcp === 'string' && typeof item.args === 'object'
      )
      .map((item: any, index: number) => ({
        id: `step-${existingStepCount + index + 1}`,
        mcp: item.mcp,
        args: item.args,
        description: getStepDescription(item.mcp, item.args),
        status: 'pending' as const,
      }));

    return { content, steps };
  } catch {
    return { content: '', steps: [] };
  }
}

/**
 * 从 AI 响应解析工作流步骤（兼容旧接口）
 *
 * AI 返回的格式：
 * {"content": "分析结果", "next": [{"mcp": "工具名", "args": {...}}]}
 */
export function parseAIResponseToSteps(
  response: string,
  existingStepCount: number = 0
): WorkflowStep[] {
  return parseAIResponse(response, existingStepCount).steps;
}

/**
 * 根据工具名称和参数生成步骤描述
 */
function getStepDescription(
  mcp: string,
  args: Record<string, unknown>
): string {
  switch (mcp) {
    case 'generate_image':
      return `生成图片: ${(args.prompt as string)?.substring(0, 30) || ''}...`;
    case 'generate_video':
      return `生成视频: ${(args.prompt as string)?.substring(0, 30) || ''}...`;
    case 'ai_analyze':
      return 'AI 分析用户意图';
    case 'format_markdown':
      return '格式化输出';
    case 'show_result':
      return '展示结果';
    default:
      return `执行 ${mcp}`;
  }
}

/**
 * 更新工作流步骤状态
 */
export function updateStepStatus(
  workflow: WorkflowDefinition,
  stepId: string,
  status: WorkflowStep['status'],
  result?: unknown,
  error?: string,
  duration?: number
): WorkflowDefinition {
  return {
    ...workflow,
    steps: workflow.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status,
            // Preserve existing result (e.g. taskId) when new result is undefined
            result: result !== undefined ? result : step.result,
            error,
            duration,
          }
        : step
    ),
  };
}

/**
 * 向工作流添加新步骤（自动去重）
 */
export function addStepsToWorkflow(
  workflow: WorkflowDefinition,
  newSteps: WorkflowStep[]
): WorkflowDefinition {
  // Filter out steps that already exist (by ID)
  const existingIds = new Set(workflow.steps.map((s) => s.id));
  const uniqueNewSteps = newSteps.filter((step) => !existingIds.has(step.id));

  if (uniqueNewSteps.length === 0) {
    return workflow; // No new steps to add
  }

  return {
    ...workflow,
    steps: [...workflow.steps, ...uniqueNewSteps],
  };
}

/**
 * 获取工作流当前状态
 */
export function getWorkflowStatus(workflow: WorkflowDefinition): {
  status: 'pending' | 'running' | 'completed' | 'failed';
  completedSteps: number;
  totalSteps: number;
  currentStep?: WorkflowStep;
} {
  const completedSteps = workflow.steps.filter(
    (s) => s.status === 'completed'
  ).length;
  const failedSteps = workflow.steps.filter(
    (s) => s.status === 'failed'
  ).length;
  const runningStep = workflow.steps.find((s) => s.status === 'running');
  const pendingSteps = workflow.steps.filter(
    (s) => s.status === 'pending'
  ).length;

  let status: 'pending' | 'running' | 'completed' | 'failed';

  if (failedSteps > 0) {
    status = 'failed';
  } else if (runningStep) {
    status = 'running';
  } else if (pendingSteps === 0 && completedSteps > 0) {
    status = 'completed';
  } else {
    status = 'pending';
  }

  return {
    status,
    completedSteps,
    totalSteps: workflow.steps.length,
    currentStep:
      runningStep || workflow.steps.find((s) => s.status === 'pending'),
  };
}
