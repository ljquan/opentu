import { test, expect, type Page } from '@playwright/test';

async function selectNodes(page: Page, count: number, images = false) {
  await page.evaluate(
    async ({ nodeCount, images }) => {
      const board = (window as any).__drawnixBoard;
      const moduleUrl = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/@plait_core.js'));
      if (!moduleUrl) throw new Error('Plait core module is unavailable');
      const core = await import(/* @vite-ignore */ moduleUrl);
      core.clearSelectedElement(board);
      const nodeIds = new Set<string>();
      for (let index = 0; index < nodeCount; index += 1) {
        board.apply({
          type: 'insert_node',
          path: [board.children.length],
          node: images
            ? {
                id: `viewport-image-${board.children.length}`,
                type: 'image',
                url: '/logo-tuzi.png',
                angle: 0,
                points: [
                  [300 + index * 20, 100],
                  [400 + index * 20, 200],
                ],
              }
            : {
                id: `viewport-text-${board.children.length}`,
                type: 'geometry',
                shape: 'text',
                angle: 0,
                points: [
                  [300 + index * 20, -1200],
                  [700 + index * 20, 8000],
                ],
                text: {
                  children: [
                    {
                      text:
                        nodeCount === 1
                          ? 'Long canvas content\n'.repeat(400)
                          : 'Selected canvas content',
                    },
                  ],
                },
                generationPrompt: 'Long text task',
              },
        });
        nodeIds.add(board.children[board.children.length - 1].id);
      }
      board.onChange();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      core.addSelectedElement(
        board,
        board.children.filter((node: { id: string }) => nodeIds.has(node.id))
      );
      board.onChange();
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    },
    { nodeCount: count, images }
  );
}

async function expectComposerWithinViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.querySelector(
          '[data-testid="ai-input-composer-shell-canvas"]'
        );
        const send = document.querySelector('[data-testid="ai-send-btn"]');
        const textarea = document.querySelector(
          '[data-testid="ai-input-textarea"]'
        );
        if (!shell || !send || !textarea) return false;
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop ?? 0;
        const left = viewport?.offsetLeft ?? 0;
        const bottom = top + (viewport?.height ?? window.innerHeight);
        const right = left + (viewport?.width ?? window.innerWidth);
        return [shell, send, textarea].every((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= top - 1 &&
            rect.bottom <= bottom + 1 &&
            rect.left >= left - 1 &&
            rect.right <= right + 1
          );
        });
      })
    )
    .toBe(true);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1194, height: 834 },
  { width: 834, height: 1194 },
  { width: 390, height: 844 },
  { width: 740, height: 360 },
]) {
  test(`AI composer remains visible at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByTestId('ai-input-textarea')).toBeVisible({
      timeout: 60000,
    });
    await selectNodes(page, 1);
    await expect(page.getByTestId('ai-input-bar')).toHaveClass(/bound-image/);
    await expectComposerWithinViewport(page);

    for (const origination of [
      [0, 12000],
      [0, -12000],
    ]) {
      await page.evaluate(async (point) => {
        const moduleUrl = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes('/@plait_core.js'));
        if (!moduleUrl) throw new Error('Plait core module is unavailable');
        const core = await import(/* @vite-ignore */ moduleUrl);
        core.BoardTransforms.updateViewport(
          (window as any).__drawnixBoard,
          point,
          0.5
        );
        window.dispatchEvent(new Event('resize'));
      }, origination);
      await expectComposerWithinViewport(page);
    }

    await selectNodes(page, 80);
    await expect(page.getByTestId('ai-input-bar')).not.toHaveClass(
      /bound-image/
    );
    await selectNodes(page, 80, true);
    await expect(
      page
        .getByTestId('ai-input-bar')
        .locator('.selected-content-preview__item')
    ).toHaveCount(80);
    const textarea = page.getByTestId('ai-input-textarea');
    await textarea.fill('Long prompt\n'.repeat(120));
    await expect(textarea).toHaveValue('Long prompt\n'.repeat(120));
    await expectComposerWithinViewport(page);
    await expect
      .poll(() =>
        page
          .getByTestId('ai-input-bar')
          .locator('.ai-input-composer-shell__preview')
          .evaluate((element) => element.scrollHeight > element.clientHeight)
      )
      .toBe(true);
    await page
      .getByRole('button', { name: '展开提示词输入框', exact: true })
      .click();
    await expectComposerWithinViewport(page);
    await page.screenshot({ path: testInfo.outputPath('long-content.png') });

    // Simulate the keyboard reducing and moving the visible viewport.
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      if (!viewport) throw new Error('Visual viewport is unavailable');
      Object.defineProperties(viewport, {
        height: { configurable: true, value: 300 },
        offsetTop: {
          configurable: true,
          value: Math.min(100, window.innerHeight - 300),
        },
      });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expectComposerWithinViewport(page);
    await page.screenshot({
      path: testInfo.outputPath('reduced-viewport.png'),
    });
  });
}
