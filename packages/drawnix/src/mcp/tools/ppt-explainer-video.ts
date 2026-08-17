import type {
  MCPExecuteOptions,
  MCPResult,
  MCPTaskResult,
  MCPTool,
} from '../types';
import type { PptExplainerCreateInput } from '../../services/ppt-explainer/types';

export type PptExplainerVideoParams = PptExplainerCreateInput;

function getErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'PPT 讲解视频任务创建失败';
  return message
    .replace(
      /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"']+/gi,
      '$1[redacted]'
    )
    .replace(
      /((?:api[-_]?key|access[-_]?token|secret)\s*[:=]\s*)[^\s,;"']+/gi,
      '$1[redacted]'
    )
    .slice(0, 2000);
}

export const pptExplainerVideoTool: MCPTool = {
  name: 'generate_ppt_explainer_video',
  description:
    '从主题、当前画布 PPT 或上传的 PPTX 创建可恢复的 PPT 讲解视频任务。支持单声线、双声线对谈、单数字人和双数字人；主题来源可确认大纲，或在用户确认警告后跳过审核。工具只使用已选择的文本、图片和视频模型及显式 ppt-explainer provider binding。',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['topic', 'current_ppt', 'pptx'],
        description: '演示来源：主题生成、当前画布 PPT 或上传 PPTX',
      },
      sourceBoardId: {
        type: 'string',
        description: '任务创建时所属画板 ID，由主线程配置界面提供',
      },
      topic: {
        type: 'string',
        description: '主题来源的 PPT 主题；其他来源可作为任务标题',
      },
      reviewMode: {
        type: 'string',
        enum: ['confirm', 'skip_after_warning'],
        default: 'confirm',
        description: '主题大纲审核方式',
      },
      presenterMode: {
        type: 'string',
        enum: ['single_voice', 'dual_voice', 'single_avatar', 'dual_avatar'],
        description: '讲解呈现模式',
      },
      speakers: {
        type: 'array',
        description: '一个或两个结构化讲解人配置',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '讲解人稳定 ID' },
            displayName: { type: 'string', description: '讲解人显示名称' },
            voiceId: { type: 'string', description: '供应商声音 ID' },
            avatarAssetId: {
              type: 'string',
              description: '数字人素材 ID（数字人模式必填其一）',
            },
            avatarSourceUrl: {
              type: 'string',
              description: '数字人素材 URL（数字人模式必填其一）',
            },
          },
          required: ['id', 'displayName', 'voiceId'],
        },
      },
      textModel: {
        type: 'string',
        description: '讲稿与主题大纲使用的文本模型 ID，由 Agent 模型选择注入',
      },
      textModelRef: {
        type: 'object',
        description: '文本模型来源引用，由 Agent 模型选择注入',
      },
      imageModel: {
        type: 'string',
        description: '主题页面生成使用的图片模型 ID，由 Agent 模型选择注入',
      },
      imageModelRef: {
        type: 'object',
        description: '图片模型来源引用，由 Agent 模型选择注入',
      },
      videoModel: {
        type: 'string',
        description: 'PPT 讲解最终成片模型 ID，由 Agent 模型选择注入',
      },
      videoModelRef: {
        type: 'object',
        description: '最终成片模型来源引用，由 Agent 模型选择注入',
      },
      providerBindingId: {
        type: 'string',
        description: '可选的显式 ppt-explainer provider binding ID',
      },
      pptxFile: {
        type: 'object',
        description: 'PPTX 来源的浏览器 File，仅允许由本地主线程配置界面提供',
      },
    },
    required: [
      'source',
      'sourceBoardId',
      'reviewMode',
      'presenterMode',
      'speakers',
    ],
  },
  supportedModes: ['queue'],
  promptGuidance: {
    whenToUse:
      '当用户希望把 PPT 自动制作为单人讲解、双人对谈或数字人出镜的视频时使用。',
    parameterGuidance: {
      source:
        '用户明确提到新主题时用 topic；提到当前 PPT 时用 current_ppt；PPTX 只能使用配置界面提供的真实本地 File。',
      reviewMode:
        '默认 confirm。只有配置界面已完成二次警告确认时，才可使用 skip_after_warning。',
      speakers:
        '必须使用配置界面选择的真实声音和数字人身份，不得猜测 voiceId 或 avatar。',
    },
    warnings: [
      '不得构造本地 File、声音 ID、数字人 ID、模型来源或供应商 binding',
      '跳过大纲审核只能由当前页面配置界面的二次确认授权，Agent 参数不能代替用户确认',
      'OpenTu 不设置固定页数、文件大小、发言时长或总成片时长上限',
    ],
  },
  execute: async (params: Record<string, unknown>): Promise<MCPResult> => {
    try {
      const { createPptExplainerTask } = await import(
        '../../services/ppt-explainer/creation-service'
      );
      const { readPptExplainerState } = await import(
        '../../services/ppt-explainer/validation'
      );
      const task = await createPptExplainerTask(
        params as unknown as PptExplainerCreateInput
      );
      const stage = readPptExplainerState(task)?.stage;
      const result: MCPTaskResult = {
        success: true,
        type: 'video',
        taskId: task.id,
        data: {
          taskId: task.id,
          stage,
        },
      };
      return result;
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: getErrorMessage(error),
      };
    }
  },
};

export async function generatePptExplainerVideo(
  params: PptExplainerVideoParams,
  _options?: Omit<MCPExecuteOptions, 'mode'>
): Promise<MCPTaskResult> {
  return pptExplainerVideoTool.execute(
    params as unknown as Record<string, unknown>,
    { mode: 'queue' }
  ) as Promise<MCPTaskResult>;
}
