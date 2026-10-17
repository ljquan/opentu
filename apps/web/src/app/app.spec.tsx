import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';

vi.mock('../home/HomePage', () => ({
  HomePage: ({ onStartCreating }: { onStartCreating: () => void }) =>
    <button onClick={() => onStartCreating()}>Start creating</button>,
}));
vi.mock('../creative-center/CreativeCenterPage', () => ({
  CreativeCenterPage: () => <div>Creative center</div>,
}));

beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

describe('App navigation', () => {
  it('opens the creation route from the home entry without creating a board', async () => {
    window.history.replaceState({}, '', '/');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start creating' }));
    expect(await screen.findByText('Creative center')).toBeTruthy();
    expect(window.location.pathname).toBe('/creative-center');
    expect(new URLSearchParams(window.location.search).has('board')).toBe(false);
  });
});
