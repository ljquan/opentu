import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgWriterModelSelect } from './SvgWriterModelSelect';

const originalScrollTo = HTMLElement.prototype.scrollTo;

function ControlledSelect({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('gpt-5.5');
  return <SvgWriterModelSelect value={value}
    onChange={(next) => { setValue(next); onChange(next); }} />;
}

beforeEach(() => {
  // jsdom has no scrolling API; the real Select uses it for keyboard navigation.
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  HTMLElement.prototype.scrollTo = originalScrollTo;
});

describe('SVG writer model selection', () => {
  it('recommends the documented example without exposing unrelated text-model aliases', async () => {
    render(<ControlledSelect onChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'SVG 编写模型' });
    fireEvent.click(input);
    expect(await screen.findByText('gpt-5.5（渠道示例）')).toBeTruthy();
    expect(screen.queryByText(/AiHubmix-Phi-4-mini-reasoning/)).toBeNull();
    expect(screen.queryByText(/AiHubmix-mistral-medium/)).toBeNull();
    expect(screen.getByText(/推荐项来自渠道 SVG 示例/)).toBeTruthy();
  });

  it('allows selecting the documented model from a saved custom selection', async () => {
    const onChange = vi.fn();
    const { container } = render(<SvgWriterModelSelect value="saved-writer" onChange={onChange} />);
    fireEvent.click(screen.getByRole('textbox', { name: 'SVG 编写模型' }));
    const option = await screen.findByText('gpt-5.5（渠道示例）');
    expect(container.contains(option)).toBe(true);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('gpt-5.5');
  });

  it('searches recommendations and accepts a new custom model ID', async () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'SVG 编写模型' });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'gpt' } });
    expect(await screen.findByText('gpt-5.5（渠道示例）')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'my-svg-writer' } });
    fireEvent.click(await screen.findByText(/my-svg-writer/));
    expect(onChange).toHaveBeenCalledWith('my-svg-writer');
  });

  it('retains an existing custom ID with an explicit unverified label', async () => {
    const onChange = vi.fn();
    render(<SvgWriterModelSelect value="saved-writer" onChange={onChange} />);
    fireEvent.click(screen.getByRole('textbox', { name: 'SVG 编写模型' }));
    expect((await screen.findAllByText('saved-writer (自定义，未验证)')).length).toBeGreaterThan(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('confirms a custom ID with Enter without invoking outer dropdown shortcuts', async () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    render(<div onKeyDown={onKeyDown}><ControlledSelect onChange={onChange} /></div>);
    const input = screen.getByRole('textbox', { name: 'SVG 编写模型' });
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'keyboard-writer' } });
    await screen.findByText(/keyboard-writer/);
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('keyboard-writer');
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('disables editing while generation controls are disabled', () => {
    render(<SvgWriterModelSelect value="gpt-5.5" disabled onChange={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: 'SVG 编写模型' }) as HTMLInputElement).disabled).toBe(true);
  });
});
