// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import {
  MessageRole,
  MessageStatus,
  type ChatMessage,
  type ChatSession,
} from '../../../types/chat.types';
import type { TaskEvent } from '../../../types/task.types';

let mockComposerSync = {
  generationType: 'image',
  selectedModel: 'image-composer-model',
  selectedModelRef: {
    profileId: 'image-profile',
    modelId: 'image-composer-model',
  },
  selectedParams: { size: '1024x1024' },
  selectedCount: 1,
  setComposerState: vi.fn(),
};

const mockSubmitWorkflow = vi.fn();
const mockSetAppState = vi.fn();
const mockExecuteRetry = vi.fn();
const mockSetDrawerOpen = vi.fn();
const mockSetDrawerWidth = vi.fn();
const mockTrack = vi.fn();
const mockUpdateActiveInvocationRouteModel = vi.fn(() => Promise.resolve());
const mockSetPersistedModelSelection = vi.fn();
let taskEvents$ = new Subject<TaskEvent>();

vi.mock('../ModelSelector', () => ({
  ModelSelector: (props: {
    value?: string;
    valueRef?: { profileId?: string | null; modelId?: string | null } | null;
    onChange?: (
      modelId: string,
      modelRef?: { profileId?: string | null; modelId?: string | null } | null
    ) => void;
  }) => (
    <div>
      <div
        data-testid="chat-drawer-model-selector"
        data-value={props.value ?? ''}
        data-profile={props.valueRef?.profileId ?? ''}
      />
      <button
        data-testid="chat-drawer-model-selector-change"
        onClick={() =>
          props.onChange?.('persisted-text-model', {
            profileId: 'persisted-profile',
            modelId: 'persisted-text-model',
          })
        }
      >
        change-model
      </button>
    </div>
  ),
}));

vi.mock('../SessionList', () => ({
  SessionList: (props: {
    sessions: ChatSession[];
    onSelectSession?: (sessionId: string) => void;
  }) => (
    <div data-testid="session-list">
      {props.sessions.map((session) => (
        <button
          key={session.id}
          data-testid={`session-list-select-${session.id}`}
          onClick={() => props.onSelectSession?.(session.id)}
        >
          {session.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../ChatDrawerTrigger', () => ({
  ChatDrawerTrigger: () => <div data-testid="chat-drawer-trigger" />,
}));

vi.mock('../EnhancedChatInput', () => ({
  EnhancedChatInput: () => <div data-testid="enhanced-chat-input" />,
}));

vi.mock('../ChatMessagesArea', () => ({
  default: (props: { workflowMessages: Map<string, { postProcessingStatus?: string; insertedCount?: number }> }) => (
    <div data-testid="chat-messages-area">
      {Array.from(props.workflowMessages.entries()).map(([messageId, workflow]) => (
        <div key={messageId} data-testid={`workflow-message-${messageId}`}>
          {workflow.postProcessingStatus ?? 'none'}|{workflow.insertedCount ?? 'none'}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('tdesign-react', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('tdesign-icons-react', () => ({
  CloseIcon: () => <span data-testid="close-icon" />,
  AddIcon: () => <span data-testid="add-icon" />,
  ViewListIcon: () => <span data-testid="view-list-icon" />,
}));

vi.mock('@plait/core', async () => {
  const actual = await vi.importActual<typeof import('@plait/core')>(
    '@plait/core'
  );
  return {
    ...actual,
    ATTACHED_ELEMENT_CLASS_NAME: 'attached-element',
  };
});

vi.mock('../../../services/chat-storage-service', () => ({
  chatStorageService: {
    getDrawerState: vi.fn(() => ({ isOpen: false, activeSessionId: null })),
    getAllSessions: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    setDrawerState: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    updateSession: vi.fn(),
    updateMessage: vi.fn(),
    addMessage: vi.fn(),
  },
}));

vi.mock('../../../services/workflow-completion-service', () => ({
  workflowCompletionService: {
    getPostProcessingStatus: vi.fn(),
  },
}));

vi.mock('../../../services/task-queue-service', () => ({
  taskQueueService: {
    getTask: vi.fn(),
    observeTaskUpdates: vi.fn(() => taskEvents$.asObservable()),
  },
}));

vi.mock('../../../hooks/useChatHandler', () => ({
  useChatHandler: () => ({
    sendMessage: vi.fn(),
    setMessagesWithRaw: vi.fn(),
    updateRawMessageWorkflow: vi.fn(),
    stop: vi.fn(),
    regenerate: vi.fn(),
    messages: [],
    status: 'ready',
    isLoading: false,
  }),
}));

vi.mock('../../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  createModelRef: (profileId: string | null, modelId: string) => ({
    profileId,
    modelId,
  }),
  hasInvocationRouteCredentials: () => true,
  invocationPresetsSettings: {
    get: () => [],
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  providerCatalogsSettings: {
    get: () => [],
    update: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  providerProfilesSettings: {
    get: () => [],
    set: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  providerPricingCacheSettings: {
    get: () => [],
    set: vi.fn(),
  },
  settingsManager: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
  ttsSettings: {
    get: () => ({
      playbackRate: 1,
    }),
    set: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  resolveInvocationRoute: (type: string) => ({
    modelId:
      type === 'text' ? 'text-route-model' : `${type}-route-model`,
    profileId:
      type === 'text' ? 'text-route-profile' : `${type}-route-profile`,
  }),
  updateActiveInvocationRouteModel: mockUpdateActiveInvocationRouteModel,
}));

vi.mock('../../../utils/ai-model-selection-storage', () => ({
  setPersistedModelSelection: mockSetPersistedModelSelection,
}));

vi.mock('../../../utils/model-pricing-service', () => ({
  modelPricingService: {
    getLatestPrices: vi.fn(() => []),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  },
}));

vi.mock('../../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('../../../hooks/use-drawnix', () => ({
  useDrawnix: () => ({
    appState: { openSettings: false },
    setAppState: mockSetAppState,
    board: null,
  }),
}));

vi.mock('../../../contexts/ChatDrawerContext', () => ({
  useChatDrawer: () => ({
    executeRetry: mockExecuteRetry,
    selectedContent: [],
    setIsDrawerOpen: mockSetDrawerOpen,
    setDrawerWidth: mockSetDrawerWidth,
  }),
}));

vi.mock('../../../contexts/AIComposerContext', () => ({
  useAIComposerSync: () => mockComposerSync,
}));

vi.mock('../../../hooks/useTextSelection', () => ({
  useTextSelection: vi.fn(),
}));

vi.mock('../../../hooks/useWorkflowSubmission', () => ({
  useWorkflowSubmission: () => ({
    submitWorkflow: mockSubmitWorkflow,
  }),
}));

vi.mock('../../../utils/ai-input-parser', () => ({
  parseAIInput: vi.fn(),
}));

vi.mock('../workflow-session', () => ({
  resolveWorkflowSession: vi.fn(() => ({
    reuseExistingSession: false,
    targetSessionId: null,
  })),
}));

vi.mock('../../../hooks/chat-utils', () => ({
  toChatUIMessage: vi.fn(),
}));

vi.mock('../../../utils/posthog-analytics', () => ({
  analytics: {
    track: mockTrack,
  },
}));

describe('ChatDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskEvents$ = new Subject<TaskEvent>();
    const localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    mockComposerSync = {
      generationType: 'image',
      selectedModel: 'image-composer-model',
      selectedModelRef: {
        profileId: 'image-profile',
        modelId: 'image-composer-model',
      },
      selectedParams: { size: '1024x1024' },
      selectedCount: 1,
      setComposerState: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('顶部重新显示文本模型选择器，并默认使用文本路由模型', async () => {
    const { ChatDrawer } = await import('../ChatDrawer');

    render(<ChatDrawer />);

    const selector = await screen.findByTestId('chat-drawer-model-selector');
    expect(selector.getAttribute('data-value')).toBe('text-route-model');
    expect(selector.getAttribute('data-profile')).toBe('text-route-profile');
  });

  it('底部输入器渲染为独立 composer 区域，不再包含在消息内容区内', async () => {
    const { ChatDrawer } = await import('../ChatDrawer');

    const view = render(<ChatDrawer />);

    await screen.findByTestId('enhanced-chat-input');

    const content = view.container.querySelector('.chat-drawer__content');
    const composer = view.container.querySelector('.chat-drawer__composer');

    expect(content).toBeTruthy();
    expect(composer).toBeTruthy();
    expect(
      content?.querySelector('[data-testid="enhanced-chat-input"]')
    ).toBeNull();
    expect(
      composer?.querySelector('[data-testid="enhanced-chat-input"]')
    ).toBeTruthy();
  });

  it('图片模式不会用共享图片模型覆盖顶部文本模型', async () => {
    const { ChatDrawer } = await import('../ChatDrawer');

    render(<ChatDrawer />);

    const selector = await screen.findByTestId('chat-drawer-model-selector');
    expect(selector.getAttribute('data-value')).toBe('text-route-model');
  });

  it('旧会话没有保存文本模型时会回退到默认文本路由', async () => {
    const { chatStorageService } = await import('../../../services/chat-storage-service');
    const session: ChatSession = {
      id: 'legacy-session',
      title: '旧会话',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([session]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: session.id,
    });

    mockComposerSync = {
      generationType: 'text',
      selectedModel: 'text-composer-model',
      selectedModelRef: {
        profileId: 'composer-profile',
        modelId: 'text-composer-model',
      },
      selectedParams: {},
      selectedCount: 1,
      setComposerState: vi.fn(),
    };

    const { ChatDrawer } = await import('../ChatDrawer');

    render(<ChatDrawer />);

    await waitFor(() => {
      const selector = screen.getByTestId('chat-drawer-model-selector');
      expect(selector.getAttribute('data-value')).toBe('text-route-model');
      expect(selector.getAttribute('data-profile')).toBe('text-route-profile');
    });
  });

  it('顶部模型切换时会持久化到当前会话，而不是全局默认设置', async () => {
    const { ChatDrawer } = await import('../ChatDrawer');
    const { fireEvent } = await import('@testing-library/react');
    const { chatStorageService } = await import('../../../services/chat-storage-service');

    const session: ChatSession = {
      id: 'session-persist',
      title: '会话一',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([session]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: session.id,
    });

    render(<ChatDrawer />);

    fireEvent.click(
      await screen.findByTestId('chat-drawer-model-selector-change')
    );

    await waitFor(() => {
      expect(chatStorageService.updateSession).toHaveBeenCalledWith(
        session.id,
        {
          textModelId: 'persisted-text-model',
          textModelRef: {
            profileId: 'persisted-profile',
            modelId: 'persisted-text-model',
          },
        }
      );
    });

    expect(mockUpdateActiveInvocationRouteModel).not.toHaveBeenCalled();
    expect(mockSetPersistedModelSelection).not.toHaveBeenCalled();
  });

  it('切换会话时会恢复各自保存的顶部文本模型', async () => {
    const { ChatDrawer } = await import('../ChatDrawer');
    const { fireEvent } = await import('@testing-library/react');
    const { chatStorageService } = await import('../../../services/chat-storage-service');

    const sessionA: ChatSession = {
      id: 'session-a',
      title: '会话 A',
      createdAt: 1,
      updatedAt: 3,
      messageCount: 0,
      textModelId: 'session-a-model',
      textModelRef: {
        profileId: 'profile-a',
        modelId: 'session-a-model',
      },
    };
    const sessionB: ChatSession = {
      id: 'session-b',
      title: '会话 B',
      createdAt: 2,
      updatedAt: 4,
      messageCount: 0,
      textModelId: 'session-b-model',
      textModelRef: {
        profileId: 'profile-b',
        modelId: 'session-b-model',
      },
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([
      sessionB,
      sessionA,
    ]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: sessionA.id,
    });

    render(<ChatDrawer />);

    await waitFor(() => {
      const selector = screen.getByTestId('chat-drawer-model-selector');
      expect(selector.getAttribute('data-value')).toBe('session-a-model');
      expect(selector.getAttribute('data-profile')).toBe('profile-a');
    });

    fireEvent.click(screen.getByLabelText('会话列表'));
    fireEvent.click(await screen.findByTestId('session-list-select-session-b'));

    await waitFor(() => {
      const selector = screen.getByTestId('chat-drawer-model-selector');
      expect(selector.getAttribute('data-value')).toBe('session-b-model');
      expect(selector.getAttribute('data-profile')).toBe('profile-b');
    });
  });

  it('新建会话时会用全局默认文本模型初始化，不继承上一个会话', async () => {
    const { ChatDrawer } = await import('../ChatDrawer');
    const { fireEvent } = await import('@testing-library/react');
    const { chatStorageService } = await import('../../../services/chat-storage-service');

    const session: ChatSession = {
      id: 'session-current',
      title: '当前会话',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
      textModelId: 'session-current-model',
      textModelRef: {
        profileId: 'current-profile',
        modelId: 'session-current-model',
      },
    };
    const newSession: ChatSession = {
      id: 'session-new',
      title: '新对话',
      createdAt: 3,
      updatedAt: 3,
      messageCount: 0,
      textModelId: 'text-route-model',
      textModelRef: {
        profileId: 'text-route-profile',
        modelId: 'text-route-model',
      },
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([session]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: session.id,
    });
    vi.mocked(chatStorageService.createSession).mockResolvedValue(newSession);

    render(<ChatDrawer />);

    await waitFor(() => {
      const selector = screen.getByTestId('chat-drawer-model-selector');
      expect(selector.getAttribute('data-value')).toBe('session-current-model');
    });

    fireEvent.click(screen.getByLabelText('新对话'));

    await waitFor(() => {
      expect(chatStorageService.createSession).toHaveBeenCalledWith({
        textModelId: 'text-route-model',
        textModelRef: {
          profileId: 'text-route-profile',
          modelId: 'text-route-model',
        },
      });
    });

    await waitFor(() => {
      const selector = screen.getByTestId('chat-drawer-model-selector');
      expect(selector.getAttribute('data-value')).toBe('text-route-model');
      expect(selector.getAttribute('data-profile')).toBe('text-route-profile');
    });
  });

  it('加载已插入画布的图片工作流时会回填 completed 后处理状态', async () => {
    const { chatStorageService } = await import('../../../services/chat-storage-service');
    const { workflowCompletionService } = await import('../../../services/workflow-completion-service');
    const { taskQueueService } = await import('../../../services/task-queue-service');
    const { ChatDrawer } = await import('../ChatDrawer');

    const session: ChatSession = {
      id: 'session-1',
      title: '生成一个苹果',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
    };

    const message: ChatMessage = {
      id: 'message-1',
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: '',
      timestamp: 3,
      status: MessageStatus.SUCCESS,
      workflow: {
        id: 'workflow-1',
        name: '图片生成',
        generationType: 'image',
        prompt: '生成一个苹果',
        count: 1,
        steps: [
          {
            id: 'step-1',
            description: '生成图片',
            status: 'completed',
            mcp: 'generate_image',
            args: { prompt: '生成一个苹果' },
            result: {
              taskId: 'task-1',
            },
          },
        ],
      },
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([session]);
    vi.mocked(chatStorageService.getMessages).mockResolvedValue([message]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: session.id,
    });
    vi.mocked(workflowCompletionService.getPostProcessingStatus).mockReturnValue(undefined);
    vi.mocked(taskQueueService.getTask).mockReturnValue({
      id: 'task-1',
      insertedToCanvas: true,
    } as any);

    render(<ChatDrawer />);

    expect(
      (await screen.findByTestId('workflow-message-message-1')).textContent
    ).toContain('completed|1');

    await waitFor(() => {
      expect(chatStorageService.updateMessage).toHaveBeenCalledWith(
        'message-1',
        expect.objectContaining({
          workflow: expect.objectContaining({
            postProcessingStatus: 'completed',
            insertedCount: 1,
          }),
        })
      );
    });
  });

  it('任务恢复晚于会话加载时，taskCreated 也会把卡片回填为 completed', async () => {
    const { chatStorageService } = await import('../../../services/chat-storage-service');
    const { workflowCompletionService } = await import('../../../services/workflow-completion-service');
    const { taskQueueService } = await import('../../../services/task-queue-service');
    const { ChatDrawer } = await import('../ChatDrawer');

    const session: ChatSession = {
      id: 'session-late-restore',
      title: '生成一个苹果',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
    };

    const message: ChatMessage = {
      id: 'message-late-restore',
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: '',
      timestamp: 3,
      status: MessageStatus.SUCCESS,
      workflow: {
        id: 'workflow-late-restore',
        name: '图片生成',
        generationType: 'image',
        prompt: '生成一个苹果',
        count: 1,
        steps: [
          {
            id: 'step-1',
            description: '生成图片',
            status: 'completed',
            mcp: 'generate_image',
            args: { prompt: '生成一个苹果' },
            result: {
              taskId: 'task-late-restore',
            },
          },
        ],
      },
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([session]);
    vi.mocked(chatStorageService.getMessages).mockResolvedValue([message]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: session.id,
    });
    vi.mocked(workflowCompletionService.getPostProcessingStatus).mockReturnValue(undefined);
    vi.mocked(taskQueueService.getTask).mockReturnValue(undefined);

    render(<ChatDrawer />);

    expect(
      (await screen.findByTestId('workflow-message-message-late-restore'))
        .textContent
    ).toContain('none|none');

    vi.mocked(taskQueueService.getTask).mockImplementation((taskId: string) => {
      if (taskId === 'task-late-restore') {
        return {
          id: taskId,
          insertedToCanvas: true,
          status: 'completed',
        } as any;
      }
      return undefined;
    });

    await act(async () => {
      taskEvents$.next({
        type: 'taskCreated',
        task: {
          id: 'task-late-restore',
          insertedToCanvas: true,
          status: 'completed',
        } as any,
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('workflow-message-message-late-restore').textContent
      ).toContain('completed|1');
    });
  });

  it('agent 队列任务完成后会把任务结果 URL 回填到 workflow step', async () => {
    const { chatStorageService } = await import('../../../services/chat-storage-service');
    const { taskQueueService } = await import('../../../services/task-queue-service');
    const { ChatDrawer } = await import('../ChatDrawer');

    const session: ChatSession = {
      id: 'session-agent-media',
      title: 'Agent 生图',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
    };

    const message: ChatMessage = {
      id: 'message-agent-media',
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: '',
      timestamp: 3,
      status: MessageStatus.SUCCESS,
      workflow: {
        id: 'workflow-agent-media',
        name: '图片生成',
        generationType: 'image',
        prompt: '生成一个香蕉',
        count: 1,
        steps: [
          {
            id: 'step-1',
            description: '生成图片',
            status: 'completed',
            mcp: 'generate_image',
            args: { prompt: '生成一个香蕉' },
            result: {
              taskId: 'task-agent-media',
            },
          },
        ],
      },
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([session]);
    vi.mocked(chatStorageService.getMessages).mockResolvedValue([message]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: session.id,
    });
    vi.mocked(taskQueueService.getTask).mockImplementation((taskId: string) => {
      if (taskId === 'task-agent-media') {
        return {
          id: taskId,
          status: 'completed',
          insertedToCanvas: true,
          result: {
            url: 'https://example.com/banana.png',
            format: 'png',
            size: 1024,
          },
        } as any;
      }
      return undefined;
    });

    render(<ChatDrawer />);

    await screen.findByTestId('workflow-message-message-agent-media');

    await act(async () => {
      taskEvents$.next({
        type: 'taskUpdated',
        task: {
          id: 'task-agent-media',
          status: 'completed',
          insertedToCanvas: true,
          result: {
            url: 'https://example.com/banana.png',
            format: 'png',
            size: 1024,
          },
        } as any,
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(chatStorageService.updateMessage).toHaveBeenCalledWith(
        'message-agent-media',
        expect.objectContaining({
          workflow: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({
                id: 'step-1',
                status: 'completed',
                result: expect.objectContaining({
                  taskId: 'task-agent-media',
                  url: 'https://example.com/banana.png',
                  format: 'png',
                }),
              }),
            ]),
          }),
        })
      );
    });
  });

  it('手动工作流写入新会话时不会自动切走当前 agent 会话', async () => {
    const ref = React.createRef<any>();
    const { ChatDrawer } = await import('../ChatDrawer');
    const { chatStorageService } = await import(
      '../../../services/chat-storage-service'
    );

    const activeSession: ChatSession = {
      id: 'session-active',
      title: '当前 Agent 会话',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      textModelId: 'session-active-model',
      textModelRef: {
        profileId: 'active-profile',
        modelId: 'session-active-model',
      },
    };

    const backgroundSession: ChatSession = {
      id: 'session-background',
      title: '新任务',
      createdAt: 3,
      updatedAt: 3,
      messageCount: 0,
      textModelId: 'text-route-model',
      textModelRef: {
        profileId: 'text-route-profile',
        modelId: 'text-route-model',
      },
    };

    vi.mocked(chatStorageService.getAllSessions).mockResolvedValue([activeSession]);
    vi.mocked(chatStorageService.getDrawerState).mockReturnValue({
      isOpen: true,
      activeSessionId: activeSession.id,
    });
    vi.mocked(chatStorageService.createSession).mockResolvedValue(
      backgroundSession
    );
    vi.mocked(chatStorageService.getMessages).mockImplementation(
      async (sessionId: string) => {
        if (sessionId === activeSession.id) {
          return [];
        }
        return [];
      }
    );

    render(<ChatDrawer ref={ref} />);

    await waitFor(() => {
      const selector = screen.getByTestId('chat-drawer-model-selector');
      expect(selector.getAttribute('data-value')).toBe('session-active-model');
      expect(selector.getAttribute('data-profile')).toBe('active-profile');
    });

    await act(async () => {
      await ref.current.sendWorkflowMessage({
        context: {
          generationType: 'image',
          userInstruction: '生成一个苹果',
          rawInput: '生成一个苹果',
          model: {
            id: 'gemini-3-pro-image-preview-vip',
            isExplicit: true,
          },
          params: {
            count: 1,
          },
          selection: {
            texts: [],
            images: [],
            videos: [],
            graphics: [],
          },
          finalPrompt: '生成一个苹果',
        },
        workflow: {
          id: 'workflow-background',
          name: '图片生成',
          generationType: 'image',
          prompt: '生成一个苹果',
          count: 1,
          status: 'pending',
          steps: [
            {
              id: 'step-1',
              description: '生成图片',
              status: 'pending',
              mcp: 'generate_image',
              args: {
                prompt: '生成一个苹果',
              },
            },
          ],
        },
        textModel: 'text-route-model',
        activateTargetSession: false,
      });
    });

    expect(chatStorageService.createSession).toHaveBeenCalledWith({
      textModelId: 'text-route-model',
      textModelRef: {
        profileId: 'text-route-profile',
        modelId: 'text-route-model',
      },
    });
    expect(chatStorageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: backgroundSession.id,
        role: MessageRole.USER,
      })
    );
    expect(chatStorageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: backgroundSession.id,
        role: MessageRole.ASSISTANT,
      })
    );
    expect(chatStorageService.getMessages).toHaveBeenCalledTimes(1);
    expect(chatStorageService.setDrawerState).not.toHaveBeenCalledWith({
      isOpen: true,
      activeSessionId: backgroundSession.id,
    });

    const selector = screen.getByTestId('chat-drawer-model-selector');
    expect(selector.getAttribute('data-value')).toBe('session-active-model');
    expect(selector.getAttribute('data-profile')).toBe('active-profile');
  });
});
