import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchImportRowInput } from './BatchImportRowInput';

function setup(initial = 1, maximum = 5) {
  const changed = vi.fn();
  function Field() {
    const [value, setValue] = useState(initial);
    return <BatchImportRowInput
      id="fill-rows"
      label="填充行数"
      unit="行"
      value={value}
      max={maximum}
      decreaseLabel="减少填充行数"
      increaseLabel="增加填充行数"
      onChange={(next) => { changed(next); setValue(next); }}
    />;
  }
  render(<Field />);
  return { input: screen.getByRole('spinbutton', { name: '填充行数' }), changed };
}

afterEach(cleanup);

describe('batch import row input', () => {
  it('allows clearing and replacing the current count without snapping back to 1', () => {
    const { input, changed } = setup();
    fireEvent.change(input, { target: { value: '' } });
    expect((input as HTMLInputElement).value).toBe('');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '5' } });
    expect(changed).toHaveBeenLastCalledWith(5);
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('5');
  });

  it('restores an empty field on blur without changing the automatic row count', () => {
    const { input, changed } = setup(3);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('3');
    expect(changed).not.toHaveBeenCalled();
  });

  it('does not turn an automatic value into a manual override just by focusing', () => {
    const { input, changed } = setup(3);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([['0', 1], ['99', 5], ['2.7', 2]])('normalizes %s to %s on blur', (draft, expected) => {
    const { input, changed } = setup(3);
    fireEvent.change(input, { target: { value: draft } });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(changed).toHaveBeenLastCalledWith(expected);
    expect((input as HTMLInputElement).value).toBe(String(expected));
  });

  it('supports increment/decrement buttons and disables them at the range boundaries', () => {
    const { input } = setup(1, 2);
    const decrease = screen.getByRole('button', { name: '减少填充行数' });
    const increase = screen.getByRole('button', { name: '增加填充行数' });
    expect((decrease as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(increase);
    expect((input as HTMLInputElement).value).toBe('2');
    expect((increase as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(decrease);
    expect((input as HTMLInputElement).value).toBe('1');
  });
});
