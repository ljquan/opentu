/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreativeCenterPage } from './CreativeCenterPage';

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    account: null as { id: string; username: string; role: number } | null,
    checking: false,
  },
}));

vi.mock('../account/use-account-session', () => ({
  useAccountSession: () => sessionState,
}));

vi.mock('../workspace/application/use-workspace-runtime', () => ({
  useWorkspaceRuntime: () => ({
    boards: [
      {
        id: 'board-1',
        name: '产品流程图',
        folderId: null,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
    ],
    tasks: [
      {
        id: 'task-1',
        type: 'image',
        status: 'processing',
        progress: 62,
        title: '产品流程图生成',
        prompt: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    cancelTask: vi.fn(),
    retryTask: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sessionState.account = null;
  sessionState.checking = false;
});

describe('CreativeCenterPage', () => {
  it('renders the gallery creation surface with projects, templates, and task state', () => {
    render(
      <CreativeCenterPage
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '创作中心' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '新建项目' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '继续创作' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '精选模板' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '图片' })).toBeTruthy();
    expect(screen.getByText('产品流程图')).toBeTruthy();
    expect(screen.getByText('62%')).toBeTruthy();
  });

  it('starts a board from the project composer', () => {
    const onCreateBoard = vi.fn().mockResolvedValue(undefined);
    render(
      <CreativeCenterPage
        onCreateBoard={onCreateBoard}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    fireEvent.change(
      screen.getByRole('textbox', { name: '描述你的创意' }),
      {
        target: { value: '做一张春季产品主视觉' },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(onCreateBoard).toHaveBeenCalledWith({
      prompt: '做一张春季产品主视觉',
      mode: 'image',
      modelId: null,
      aspectRatio: '1:1',
      quality: 'high',
      referenceImages: undefined,
    });
  });

  it('only offers gateway-supported image options in managed generation', () => {
    vi.stubEnv('VITE_OPENTU_MANAGED_GENERATION', 'true');
    const onCreateBoard = vi.fn().mockResolvedValue(undefined);
    render(
      <CreativeCenterPage
        onCreateBoard={onCreateBoard}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '添加参考素材' })).toBeNull();
    expect(screen.queryByRole('option', { name: '高清' })).toBeNull();
    expect(screen.queryByRole('option', { name: '16:9' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '描述你的创意' }), {
      target: { value: '一张新品海报' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(onCreateBoard).toHaveBeenCalledWith(expect.objectContaining({
      aspectRatio: '1:1',
      quality: 'standard',
      referenceImages: undefined,
    }));
  });

  it('does not create an unsupported video task in managed generation', () => {
    vi.stubEnv('VITE_OPENTU_MANAGED_GENERATION', 'true');
    const onCreateBoard = vi.fn().mockResolvedValue(undefined);
    render(
      <CreativeCenterPage
        onCreateBoard={onCreateBoard}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '视频' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(screen.getByRole('alert').textContent).toContain('视频生成暂未接入平台服务');
    expect(onCreateBoard).not.toHaveBeenCalled();
  });

  it('asks for a prompt before starting media creation', () => {
    const onCreateBoard = vi.fn().mockResolvedValue(undefined);
    render(
      <CreativeCenterPage
        onCreateBoard={onCreateBoard}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(screen.getByRole('alert').textContent).toContain('请先描述');
    expect(onCreateBoard).not.toHaveBeenCalled();
  });

  it('shows a login entry for signed-out visitors', () => {
    const onLogin = vi.fn();
    render(
      <CreativeCenterPage
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
        onLogin={onLogin}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('shows the current account name', () => {
    sessionState.account = { id: 'user-1', username: '林墨', role: 0 };
    render(
      <CreativeCenterPage
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /林墨/ })).toBeTruthy();
    expect(screen.queryByText('余额 12,430')).toBeNull();
  });

  it('shows the selected model context from the marketplace', () => {
    render(
      <CreativeCenterPage
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
        selectedModelId="gpt-image-2"
        selectedMode="image"
      />
    );

    expect(screen.getByRole('button', { name: /模型 GPT Image 2/ })).toBeTruthy();
    expect(screen.getByText(/OpenAI/)).toBeTruthy();
    expect(screen.getByText(/高完成度视觉/)).toBeTruthy();
  });

  it('shows progress feedback and blocks duplicate creation submissions', () => {
    const onCreateBoard = vi.fn().mockResolvedValue(undefined);
    render(
      <CreativeCenterPage
        isCreating
        onCreateBoard={onCreateBoard}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    const submit = screen.getByRole('button', { name: '生成中' });
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(onCreateBoard).not.toHaveBeenCalled();
  });

  it('closes the mobile navigation from its backdrop', () => {
    render(
      <CreativeCenterPage
        onCreateBoard={vi.fn().mockResolvedValue(undefined)}
        onOpenBoard={vi.fn().mockResolvedValue(undefined)}
        onGoHome={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    expect(screen.getAllByRole('button', { name: '关闭导航' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '关闭导航' })[1]);
    expect(screen.getAllByRole('button', { name: '关闭导航' })).toHaveLength(1);
  });
});
