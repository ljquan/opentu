/**
 * 工具响应辅助器
 * 处理工具执行结果
 */

import type { MCPToolResult, MCPContent } from '../types/mcp.types';

export class ToolResponseHelper {
  /**
   * 创建成功响应
   */
  static success(content: string | MCPContent[]): MCPToolResult {
    const contentItems: MCPContent[] = typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : content;

    return {
      content: contentItems,
      isError: false,
    };
  }

  /**
   * 创建错误响应
   */
  static error(message: string): MCPToolResult {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  /**
   * 提取文本内容
   */
  static extractText(result: MCPToolResult): string {
    if (!result.content) return '';

    return result.content
      .filter(
        (item): item is MCPContent & { type: 'text'; text: string } =>
          item.type === 'text' && typeof item.text === 'string'
      )
      .map((item) => item.text)
      .join('\n');
  }

  /**
   * 检查是否为错误响应
   */
  static isError(result: MCPToolResult): boolean {
    return result.isError === true;
  }

  /**
   * 合并多个响应
   */
  static merge(results: MCPToolResult[]): MCPToolResult {
    const allContent: MCPContent[] = [];
    let hasError = false;

    for (const result of results) {
      if (result.content) {
        allContent.push(...result.content);
      }
      if (result.isError) {
        hasError = true;
      }
    }

    return {
      content: allContent,
      isError: hasError,
    };
  }
}
