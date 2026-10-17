import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { ToolCommunicationService } from './tool-communication-service';
import { ToolMessageType } from '../types/tool-communication.types';

let service: ToolCommunicationService | undefined;
afterEach(() => { service?.destroy(); document.body.replaceChildren(); vi.useRealTimers(); });

function fixture() {
  const container = document.createElement('div');
  container.dataset.elementId = 'tool-1';
  const iframe = document.createElement('iframe');
  iframe.src = 'https://tools.example/editor';
  container.append(iframe);
  document.body.append(container);
  service = new ToolCommunicationService({} as PlaitBoard);
  const handler = vi.fn();
  service.on(ToolMessageType.TOOL_TO_BOARD_READY, handler);
  return { iframe, handler, service };
}

function send(iframe: HTMLIFrameElement, origin = 'https://tools.example', source: MessageEventSource | null = iframe.contentWindow) {
  window.dispatchEvent(new MessageEvent('message', {
    origin, source,
    data: { version: '1.0', type: ToolMessageType.TOOL_TO_BOARD_READY,
      toolId: 'tool-1', messageId: crypto.randomUUID(), timestamp: Date.now(), payload: {} },
  }));
}

describe('tool message trust boundary', () => {
  it('accepts the registered iframe but rejects a foreign origin or window', () => {
    const { iframe, handler } = fixture();
    send(iframe, 'https://evil.example');
    send(iframe, 'https://tools.example', window);
    expect(handler).not.toHaveBeenCalled();
    send(iframe);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not grant opaque sandbox origins access', () => {
    const { iframe, handler } = fixture();
    iframe.setAttribute('sandbox', 'allow-scripts');
    send(iframe, 'null');
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses an exact origin for outbound messages', async () => {
    const { iframe, service } = fixture();
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    await service.sendToTool('tool-1', ToolMessageType.BOARD_TO_TOOL_DATA, {});
    expect(post).toHaveBeenCalledWith(expect.any(Object), 'https://tools.example');
  });

  it('releases its timer and listener on destruction', () => {
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    const { iframe, service, handler } = fixture();
    expect(vi.getTimerCount()).toBe(before + 1);
    service.destroy();
    send(iframe);
    expect(handler).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(before);
  });
});
