// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../types/toolbox.types';

const DEFAULT_AUTO_PIN_TOOL: ToolDefinition = {
  id: 'video-analyzer',
  name: '爆款视频生成',
  category: 'ai-tools',
  component: 'video-analyzer',
  supportsMultipleWindows: true,
  defaultWindowBehavior: {
    autoPinOnOpen: true,
  },
};

describe('tool-window-service default window behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.stubGlobal('crypto', {
      randomUUID: () => 'tool-window-test',
    });
  });

  it('为声明默认自动常驻的工具在打开后创建常驻 launcher', async () => {
    const { toolWindowService } = await import('../tool-window-service');

    const instanceId = toolWindowService.openTool(DEFAULT_AUTO_PIN_TOOL);
    expect(instanceId).toBeTruthy();
    expect(toolWindowService.isPinned(DEFAULT_AUTO_PIN_TOOL.id)).toBe(true);

    toolWindowService.closeTool(instanceId!);

    const launcherState = toolWindowService.getToolState(DEFAULT_AUTO_PIN_TOOL.id);
    expect(launcherState?.isLauncher).toBe(true);
    expect(launcherState?.toolId).toBe(DEFAULT_AUTO_PIN_TOOL.id);
  });

  it('允许调用方显式 autoPin false 覆盖工具默认自动常驻', async () => {
    const { toolWindowService } = await import('../tool-window-service');

    toolWindowService.openTool(DEFAULT_AUTO_PIN_TOOL, { autoPin: false });

    expect(toolWindowService.isPinned(DEFAULT_AUTO_PIN_TOOL.id)).toBe(false);
    expect(toolWindowService.getToolState(DEFAULT_AUTO_PIN_TOOL.id)?.isLauncher).not.toBe(true);
  });

  it('在用户手动取消常驻后保留该覆盖选择', async () => {
    const { toolWindowService } = await import('../tool-window-service');

    const instanceId = toolWindowService.openTool(DEFAULT_AUTO_PIN_TOOL);
    expect(toolWindowService.isPinned(DEFAULT_AUTO_PIN_TOOL.id)).toBe(true);

    toolWindowService.setPinned(DEFAULT_AUTO_PIN_TOOL.id, false);
    toolWindowService.closeTool(instanceId!);

    expect(toolWindowService.isPinned(DEFAULT_AUTO_PIN_TOOL.id)).toBe(false);

    toolWindowService.openTool(DEFAULT_AUTO_PIN_TOOL);
    expect(toolWindowService.isPinned(DEFAULT_AUTO_PIN_TOOL.id)).toBe(false);
  });
});
