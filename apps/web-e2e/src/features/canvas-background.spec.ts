import { expect, test } from '@playwright/test';

test('点阵跟随画布平移和缩放', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const board = page.locator('.plait-board-container');
  await expect(board).toBeVisible({ timeout: 60000 });
  await page.waitForFunction(() => Boolean((window as any).__drawnixBoard));
  const svg = board.locator('.board-host-svg');
  const background = board.locator('.board-dot-background');
  await expect(svg).toHaveCSS('background-color', 'rgb(252, 251, 248)');
  await expect(background).toBeVisible();
  await expect(board.locator('pattern')).toHaveAttribute('patternUnits', 'userSpaceOnUse');
  await expect(board.locator('pattern')).toHaveAttribute('width', '28');

  const getTransform = () => svg.evaluate((element) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
  const initial = await getTransform();
  const initialZoom = await page.getByTestId('zoom-display').textContent();
  await page.getByTestId('zoom-in').click();
  await expect(page.getByTestId('zoom-display')).not.toHaveText(initialZoom!);
  await expect.poll(async () => (await getTransform()).scale).toBeGreaterThan(initial.scale);

  const beforePan = await getTransform();
  await page.mouse.move(800, 200);
  await page.mouse.wheel(120, 180);
  await expect.poll(async () => (await getTransform()).x).not.toBe(beforePan.x);
  await expect.poll(() => svg.evaluate((element) => {
    const box = (element as SVGSVGElement).viewBox.baseVal;
    const rect = element.querySelector('.board-dot-background')!;
    return ['x', 'y', 'width', 'height'].every((key) =>
      Math.abs(Number(rect.getAttribute(key)) - box[key as 'x' | 'y' | 'width' | 'height']) < 0.01
    );
  })).toBe(true);
});

test('其他主题保留原背景', async ({ page }) => {
  await page.goto('/');
  const board = page.locator('.plait-board-container');
  await expect(board).toBeVisible({ timeout: 60000 });
  const themes = await board.evaluate((element) => {
    const originalClass = element.className;
    const svg = element.querySelector('.board-host-svg')!;
    const result: Record<string, { background: string; image: string }> = {};
    for (const theme of ['soft', 'retro', 'dark', 'starry']) {
      element.className = originalClass.replace(/theme-\w+/, `theme-${theme}`);
      result[theme] = {
        background: getComputedStyle(svg).backgroundColor,
        image: getComputedStyle(element.querySelector('.board-dot-background')!).display,
      };
    }
    element.className = originalClass;
    return result;
  });
  expect(themes).toEqual({
    soft: { background: 'rgb(245, 245, 245)', image: 'none' },
    retro: { background: 'rgb(249, 248, 237)', image: 'none' },
    dark: { background: 'rgb(20, 20, 20)', image: 'none' },
    starry: { background: 'rgb(13, 37, 55)', image: 'none' },
  });
});
