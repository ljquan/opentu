/**
 * MCP 工具注册中心
 * 
 * 管理所有 MCP 工具的注册、查询和执行
 */

import type { MCPTool, MCPResult, ToolCall, MCPExecuteOptions } from './types';
import { toGenerationTaskError } from '../utils/generation-error-details';

/**
 * MCP 工具注册中心
 */
class MCPRegistry {
  private tools: Map<string, MCPTool> = new Map();
  private static instance: MCPRegistry;
  /** 是否使用 SW 执行工具（默认 true，可通过 setUseSW 切换） */
  private useSW = true;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): MCPRegistry {
    if (!MCPRegistry.instance) {
      MCPRegistry.instance = new MCPRegistry();
    }
    return MCPRegistry.instance;
  }

  /**
   * 注册工具
   */
  register(tool: MCPTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[MCPRegistry] Tool "${tool.name}" already registered, overwriting...`);
    }
    this.tools.set(tool.name, tool);
    // console.log(`[MCPRegistry] Tool "${tool.name}" registered`);
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: MCPTool[]): void {
    tools.forEach(tool => this.register(tool));
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    const result = this.tools.delete(name);
    // if (result) {
    //   console.log(`[MCPRegistry] Tool "${name}" unregistered`);
    // }
    return result;
  }

  /**
   * 获取工具
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具名称列表
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 检查工具是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 设置是否使用 SW 执行工具
   * @param useSW - true 使用 SW，false 使用本地执行
   */
  setUseSW(useSW: boolean): void {
    this.useSW = useSW;
  }

  /**
   * 执行工具调用
   * 优先委托给 Service Worker 执行，如果 SW 不可用则回退到本地执行
   * @param toolCall - 工具调用信息
   * @param options - 执行选项（可选，用于指定执行模式等）
   */
  async executeTool(toolCall: ToolCall, options?: MCPExecuteOptions): Promise<MCPResult> {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" not found`,
        type: 'error',
      };
    }

    // Execute tool locally
    try {
      const result = await tool.execute(toolCall.arguments, options);
      return result;
    } catch (error: any) {
      console.error(`[MCPRegistry] Tool "${toolCall.name}" execution failed:`, error);
      return {
        success: false,
        error: error.message || 'Tool execution failed',
        errorDetails: toGenerationTaskError(error, 'TOOL_EXECUTION_ERROR'),
        type: 'error',
      };
    }
  }

  /**
   * 批量执行工具调用
   */
  async executeTools(toolCalls: ToolCall[]): Promise<MCPResult[]> {
    return Promise.all(toolCalls.map(tc => this.executeTool(tc)));
  }

  /**
   * 生成工具描述（用于系统提示词）
   */
  generateToolsDescription(): string {
    const tools = this.getAllTools();

    if (tools.length === 0) {
      return '当前没有可用的工具。';
    }

    const descriptions = tools.map(tool => {
      const params = tool.inputSchema.properties || {};
      const required = tool.inputSchema.required || [];
      const guidance = tool.promptGuidance;

      // 参数描述
      const paramDescriptions = Object.entries(params)
        .map(([name, schema]) => {
          const isRequired = required.includes(name);
          const reqStr = isRequired ? '（必填）' : '（可选）';

          // 构建参数详情
          const details: string[] = [];

          // 类型信息
          if (schema.type) {
            details.push(`类型: ${schema.type}`);
          }

          // 枚举值
          if (schema.enum && Array.isArray(schema.enum)) {
            details.push(`可选值: ${schema.enum.map(v => `"${v}"`).join(' | ')}`);
          }

          // 默认值
          if (schema.default !== undefined) {
            details.push(`默认: "${schema.default}"`);
          }

          const detailStr = details.length > 0 ? ` [${details.join(', ')}]` : '';

          // 添加参数指导（如果有）
          const paramGuidance = guidance?.parameterGuidance?.[name];
          const guidanceStr = paramGuidance ? `\n    💡 ${paramGuidance}` : '';

          return `  - **${name}**${reqStr}: ${schema.description || '无描述'}${detailStr}${guidanceStr}`;
        })
        .join('\n');

      // 构建工具描述
      let toolDesc = `### ${tool.name}
${tool.description}

**参数:**
${paramDescriptions || '  无参数'}`;

      // 添加使用场景
      if (guidance?.whenToUse) {
        toolDesc += `\n\n**使用场景:** ${guidance.whenToUse}`;
      }

      // 添加最佳实践
      if (guidance?.bestPractices && guidance.bestPractices.length > 0) {
        toolDesc += `\n\n**最佳实践:**\n${guidance.bestPractices.map(p => `  - ${p}`).join('\n')}`;
      }

      // 添加示例
      if (guidance?.examples && guidance.examples.length > 0) {
        const examplesStr = guidance.examples.map(ex => {
          const argsJson = JSON.stringify(ex.args, null, 0);
          return `  - 输入: "${ex.input}"\n    调用: {"mcp": "${tool.name}", "args": ${argsJson}}${ex.explanation ? `\n    说明: ${ex.explanation}` : ''}`;
        }).join('\n');
        toolDesc += `\n\n**示例:**\n${examplesStr}`;
      }

      // 添加注意事项
      if (guidance?.warnings && guidance.warnings.length > 0) {
        toolDesc += `\n\n**注意事项:**\n${guidance.warnings.map(w => `  ⚠️ ${w}`).join('\n')}`;
      }

      return toolDesc;
    });

    return descriptions.join('\n\n---\n\n');
  }

  /**
   * 生成工具 Schema（用于 Function Calling）
   */
  generateToolSchemas(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: MCPTool['inputSchema'];
    };
  }> {
    return this.getAllTools().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
    // console.log('[MCPRegistry] All tools cleared');
  }
}

// 导出单例实例
export const mcpRegistry = MCPRegistry.getInstance();

// 导出类型
export { MCPRegistry };
