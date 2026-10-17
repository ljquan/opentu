import { expect, test } from '@playwright/test';

test.describe('C1 focused creation workspace', () => {
  test('renders and connects the node creation scene', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/creative-center');
    await page.getByRole('tab', { name: '画布' }).click();
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page).toHaveURL(/\?board=/, { timeout: 30000 });

    const scene = page.getByRole('region', { name: 'C1 节点式创作画布' });
    await expect(page.getByRole('heading', { name: '从空白画布开始' })).toBeVisible({ timeout: 30000 });
    await expect(scene).toHaveCount(0);
    await page.getByRole('button', { name: '使用 C1 创作模板' }).click();
    await expect(scene).toBeVisible({ timeout: 30000 });
    for (const label of ['参考图', '提示词', '主画板', '生成结果', '风格参考']) {
      await expect(scene.getByText(label, { exact: true }).first()).toBeVisible();
    }

    const prompt = page.getByRole('textbox', { name: 'C1 画布提示词' });
    await prompt.fill('春日樱花下的东方人像，电影感柔光');
    await scene.getByRole('button', { name: '唯美' }).click();
    await expect(prompt).toHaveValue(/唯美/);

    await scene.getByRole('button', { name: '选择变体 3' }).click();
    await expect(scene.getByRole('button', { name: '选择变体 3' })).toHaveClass(/is-active/);

    await page.getByRole('button', { name: '展开右侧面板' }).click();
    await expect(page.getByRole('complementary', { name: '工作区上下文' })).toBeVisible();
    await page.getByRole('button', { name: '高级设置' }).click();
    await page.getByRole('button', { name: '创建一个春季护肤品牌主视觉' }).click();
    await expect(page.getByRole('textbox', { name: 'AI 创作描述' })).toHaveValue(
      '创建一个春季护肤品牌主视觉'
    );

    await page.getByRole('button', { name: '关闭面板' }).click();
    await expect(page.getByRole('complementary', { name: '工作区上下文' })).toHaveCount(0);
    await page.getByRole('button', { name: '展开右侧面板' }).click();
    await expect(page.getByRole('complementary', { name: '工作区上下文' })).toBeVisible();
    await page.screenshot({
      path: 'design-mocks/qa-c1-canvas-desktop-final.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: '收起 AI 创作助手' }).click();
    await expect(page.getByRole('button', { name: '打开 AI 创作助手' })).toBeVisible();
    await page.getByRole('button', { name: '打开 AI 创作助手' }).click();
    await expect(page.getByRole('textbox', { name: 'AI 创作描述' })).toBeVisible();

    await page.getByRole('button', { name: '关闭示例' }).click();
    await expect(scene).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '从空白画布开始' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('keeps the C1 creation controls usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/creative-center');
    await page.getByRole('tab', { name: '画布' }).click();
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page).toHaveURL(/\?board=/, { timeout: 30000 });
    await expect(page.getByRole('heading', { name: '从空白画布开始' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: '使用 C1 创作模板' }).click();
    await expect(page.getByRole('region', { name: 'C1 节点式创作画布' })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole('textbox', { name: 'AI 创作描述' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({
      path: 'design-mocks/qa-c1-canvas-mobile-final-v2.png',
      fullPage: true,
    });
  });
});
