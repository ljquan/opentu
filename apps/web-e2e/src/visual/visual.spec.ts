/**
 * @tags visual
 * 视觉回归测试 - 基于实际页面元素和状态
 * 仅 2 次页面加载，覆盖所有视觉截图
 */
import { test, expect } from '../fixtures/test-base';

test.describe('@visual 视觉回归', () => {
  /**
   * 测试1：主画布所有固定组件截图
   * 注意：某些组件有动态内容，使用较宽松的阈值
   */
  test('主画布：工具栏、AI输入栏、视图导航', async ({ page }) => {
    await page.goto('/');
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2500); // 等待图标完全加载
    
    // 1. 统一工具栏截图（必须通过）
    const toolbar = page.locator('.unified-toolbar').first();
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveScreenshot('unified-toolbar.png', { maxDiffPixelRatio: 0.08 });
    
    // 2. AI 输入栏截图（必须通过，使用更宽松阈值因为有动态内容）
    const aiInputBar = page.locator('.ai-input-bar').first();
    await expect(aiInputBar).toBeVisible();
    await expect(aiInputBar).toHaveScreenshot('ai-input-bar.png', { maxDiffPixelRatio: 0.10 });
    
    // 3. 视图导航截图（必须通过）
    const viewNavigation = page.locator('.view-navigation').first();
    await expect(viewNavigation).toBeVisible();
    await expect(viewNavigation).toHaveScreenshot('view-navigation.png', { maxDiffPixelRatio: 0.08 });
  });

  /**
   * 测试2：弹窗/抽屉截图
   */
  test('弹窗抽屉：项目、工具箱截图', async ({ page }) => {
    await page.goto('/');
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    
    // === 确保项目抽屉打开 ===
    const openProjectBtn = page.getByRole('button', { name: '打开项目' });
    if (await openProjectBtn.isVisible().catch(() => false)) {
      await openProjectBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 1. 项目抽屉截图（必须通过）
    const projectDrawer = page.locator('.project-drawer').first();
    await expect(projectDrawer).toBeVisible();
    await page.waitForTimeout(500);
    await expect(projectDrawer).toHaveScreenshot('project-drawer.png', { maxDiffPixelRatio: 0.10 });
    
    // === 确保工具箱打开 ===
    const openToolboxBtn = page.getByRole('button', { name: '打开工具箱' });
    if (await openToolboxBtn.isVisible().catch(() => false)) {
      await openToolboxBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 2. 工具箱抽屉截图（必须通过）
    const toolboxDrawer = page.locator('.toolbox-drawer').first();
    await expect(toolboxDrawer).toBeVisible();
    await page.waitForTimeout(500);
    await expect(toolboxDrawer).toHaveScreenshot('toolbox-drawer.png', { maxDiffPixelRatio: 0.10 });
  });
});
