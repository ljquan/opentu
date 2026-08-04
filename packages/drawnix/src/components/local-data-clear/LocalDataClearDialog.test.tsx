// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  getRisk: vi.fn(() => ({
    activeTaskCount: 0,
    activeWorkflowCount: 0,
    hasPendingSync: false,
    requiresStrongConfirmation: false,
  })),
  error: vi.fn(),
  warning: vi.fn(),
  confirmProps: null as null | Record<string, unknown>,
}));

vi.mock('../../services/local-data-clear-service', () => ({
  localDataClearService: {
    clear: mocks.clear,
    getRisk: mocks.getRisk,
  },
}));

vi.mock('../dialog/ConfirmDialog', () => ({
  ConfirmDialog: (props: {
    title: React.ReactNode;
    children: React.ReactNode;
    confirmText: React.ReactNode;
    confirmDisabled?: boolean;
    onConfirm?: () => Promise<void>;
    onOpenChange?: (open: boolean) => void;
  }) => {
    mocks.confirmProps = props as unknown as Record<string, unknown>;
    return (
      <div>
        <h2>{props.title}</h2>
        {props.children}
        <button
          disabled={props.confirmDisabled}
          onClick={() => void props.onConfirm?.()}
        >
          {props.confirmText}
        </button>
      </div>
    );
  },
}));

vi.mock('tdesign-react', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }) => (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  MessagePlugin: { error: mocks.error, warning: mocks.warning },
  Radio: Object.assign(
    ({
      value,
      children,
      className,
      checked,
    }: {
      value: string;
      children: React.ReactNode;
      className?: string;
      checked?: boolean;
    }) => (
      <label className={className}>
        <input
          type="radio"
          value={value}
          name="clear-mode"
          checked={checked}
          readOnly
        />
        {children}
      </label>
    ),
    {
      Group: ({
        value,
        onChange,
        children,
      }: {
        value: string;
        onChange: (value: string) => void;
        children: React.ReactNode;
      }) => (
        <div
          onChange={(event) =>
            onChange((event.target as HTMLInputElement).value)
          }
        >
          {React.Children.map(children, (child) =>
            React.isValidElement(child)
              ? React.cloneElement(child as React.ReactElement<any>, {
                  checked: child.props.value === value,
                })
              : child
          )}
        </div>
      ),
    }
  ),
}));

// eslint-disable-next-line import/first
import { LocalDataClearDialog } from './LocalDataClearDialog';

describe('LocalDataClearDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clear.mockResolvedValue(undefined);
    mocks.getRisk.mockReturnValue({
      activeTaskCount: 0,
      activeWorkflowCount: 0,
      hasPendingSync: false,
      requiresStrongConfirmation: false,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderDialog(onOpenChange = vi.fn()) {
    const reloadPage = vi.fn();
    await act(async () => {
      root.render(
        <LocalDataClearDialog
          open
          onOpenChange={onOpenChange}
          reloadPage={reloadPage}
        />
      );
    });
    return reloadPage;
  }

  it('defaults to cache mode and executes cache clearing', async () => {
    mocks.clear.mockReturnValue(new Promise(() => undefined));
    await renderDialog();
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === '清除缓存'
    )!;

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(mocks.clear).toHaveBeenCalledWith('cache');
  });

  it('prevents duplicate clearing while the first request is pending', async () => {
    let resolveClear: (() => void) | undefined;
    mocks.clear.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveClear = resolve;
      })
    );
    await renderDialog();
    const onConfirm = mocks.confirmProps?.onConfirm as
      | (() => Promise<void>)
      | undefined;

    const first = onConfirm?.();
    const second = onConfirm?.();

    expect(mocks.clear).toHaveBeenCalledTimes(1);
    resolveClear?.();
    await act(async () => {
      await Promise.all([first, second]);
    });
  });

  it('prevents closing while clearing is pending', async () => {
    let resolveClear: (() => void) | undefined;
    mocks.clear.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveClear = resolve;
      })
    );
    const onOpenChange = vi.fn();
    await renderDialog(onOpenChange);
    const onConfirm = mocks.confirmProps?.onConfirm as
      | (() => Promise<void>)
      | undefined;
    const requestOpenChange = mocks.confirmProps?.onOpenChange as
      | ((open: boolean) => void)
      | undefined;

    const clearing = onConfirm?.();
    requestOpenChange?.(false);

    expect(onOpenChange).not.toHaveBeenCalled();
    resolveClear?.();
    await act(async () => {
      await clearing;
    });
  });

  it('reloads exactly once after successful clearing', async () => {
    const reloadPage = await renderDialog();
    const onConfirm = mocks.confirmProps?.onConfirm as
      | (() => Promise<void>)
      | undefined;

    await act(async () => {
      await onConfirm?.();
    });

    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation text when risky work exists', async () => {
    mocks.getRisk.mockReturnValue({
      activeTaskCount: 1,
      activeWorkflowCount: 0,
      hasPendingSync: true,
      requiresStrongConfirmation: true,
    });
    await renderDialog();

    const allRadio = container.querySelector(
      'input[type="radio"][value="all"]'
    ) as HTMLInputElement;
    await act(async () => {
      allRadio.click();
      allRadio.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === '清除全部本地数据'
    )!;
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    const input = container.querySelector(
      'input[placeholder]'
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set?.call(input, '确认清除');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const enabledConfirmButton = Array.from(
      container.querySelectorAll('button')
    ).find((item) => item.textContent === '清除全部本地数据')!;
    expect((enabledConfirmButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('requires confirmation text for all-data mode without detected risk', async () => {
    await renderDialog();

    const allRadio = container.querySelector(
      'input[type="radio"][value="all"]'
    ) as HTMLInputElement;
    await act(async () => {
      allRadio.click();
      allRadio.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === '清除全部本地数据'
    )!;
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('本地生成记录和文件将被永久删除');
  });

  it('requires confirmation again when local risk changes before clearing', async () => {
    await renderDialog();

    const allRadio = container.querySelector(
      'input[type="radio"][value="all"]'
    ) as HTMLInputElement;
    await act(async () => {
      allRadio.click();
      allRadio.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const input = container.querySelector(
      'input[placeholder]'
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set?.call(input, '确认清除');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    mocks.getRisk.mockReturnValue({
      activeTaskCount: 1,
      activeWorkflowCount: 0,
      hasPendingSync: false,
      requiresStrongConfirmation: true,
    });

    const onConfirm = mocks.confirmProps?.onConfirm as
      | (() => Promise<void>)
      | undefined;
    await act(async () => {
      await onConfirm?.();
    });

    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(
      '本地状态已变化，请重新输入“确认清除”'
    );
    expect(
      (container.querySelector('input[placeholder]') as HTMLInputElement).value
    ).toBe('');
  });

  it('reports failure and does not treat it as success', async () => {
    mocks.clear.mockRejectedValue(new Error('storage failed'));
    const reloadPage = await renderDialog();
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === '清除缓存'
    )!;

    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.error).toHaveBeenCalledWith('清理失败：storage failed');
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
