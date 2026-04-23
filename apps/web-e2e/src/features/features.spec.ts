/**
 * @tags feature
 * 功能测试 - 基于实际页面元素和状态
 * 仅 3 次页面加载，覆盖所有核心功能
 */
import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures/test-base';

async function getTextareaMetrics(textarea: Locator) {
  return textarea.evaluate((node) => {
    const textareaElement = node as HTMLTextAreaElement;
    const styles = window.getComputedStyle(textareaElement);
    const lineHeight = parseFloat(styles.lineHeight);
    const paddingTop = parseFloat(styles.paddingTop);
    const paddingBottom = parseFloat(styles.paddingBottom);
    const clientHeight = textareaElement.clientHeight;
    const scrollHeight = textareaElement.scrollHeight;

    return {
      clientHeight,
      scrollHeight,
      lineHeight,
      paddingTop,
      paddingBottom,
      visibleRows:
        (clientHeight - paddingTop - paddingBottom) / Math.max(lineHeight, 1),
    };
  });
}

test.describe('@feature 功能测试', () => {
  test('AI 输入栏：展开后默认 4 行并自增到 6 行', async ({ page }) => {
    await page.goto('/');
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: 10000 });

    const aiInput = page.locator('[data-testid="ai-input-textarea"]');
    await expect(aiInput).toBeVisible();

    const collapsedMetrics = await getTextareaMetrics(aiInput);
    expect(collapsedMetrics.visibleRows).toBeGreaterThan(0.8);
    expect(collapsedMetrics.visibleRows).toBeLessThan(1.4);

    await aiInput.click();
    await page.waitForTimeout(150);

    const expandedMetrics = await getTextareaMetrics(aiInput);
    expect(expandedMetrics.visibleRows).toBeGreaterThan(3.6);
    expect(expandedMetrics.visibleRows).toBeLessThan(4.4);

    await aiInput.fill('这是一段用于触发输入框自动换行的测试文本'.repeat(10));
    await page.waitForTimeout(150);

    const softWrapMetrics = await getTextareaMetrics(aiInput);
    expect(softWrapMetrics.visibleRows).toBeGreaterThan(4.1);
    expect(softWrapMetrics.visibleRows).toBeLessThan(6.4);

    await aiInput.fill(
      '第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行\n第八行'
    );
    await page.waitForTimeout(150);

    const cappedMetrics = await getTextareaMetrics(aiInput);
    expect(cappedMetrics.visibleRows).toBeGreaterThan(5.4);
    expect(cappedMetrics.visibleRows).toBeLessThan(6.4);
    expect(cappedMetrics.scrollHeight).toBeGreaterThan(
      cappedMetrics.clientHeight + 1
    );

    await aiInput.fill('');
    await page.waitForTimeout(150);

    const clearedMetrics = await getTextareaMetrics(aiInput);
    expect(clearedMetrics.visibleRows).toBeGreaterThan(3.6);
    expect(clearedMetrics.visibleRows).toBeLessThan(4.4);

    await aiInput.evaluate((node) => {
      (node as HTMLTextAreaElement).blur();
    });
    await page.waitForTimeout(150);

    const collapsedAgainMetrics = await getTextareaMetrics(aiInput);
    expect(collapsedAgainMetrics.visibleRows).toBeGreaterThan(0.8);
    expect(collapsedAgainMetrics.visibleRows).toBeLessThan(1.4);

    await aiInput.click();
    await page.waitForTimeout(150);

    const refocusedMetrics = await getTextareaMetrics(aiInput);
    expect(refocusedMetrics.visibleRows).toBeGreaterThan(3.6);
    expect(refocusedMetrics.visibleRows).toBeLessThan(4.4);
  });

  /**
   * 测试1：主画布交互功能
   * AI输入栏、模型选择、灵感板、绘图工具
   */
  test('主画布：AI输入、绘图工具', async ({ page }) => {
    await page.goto('/');
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // === AI 输入栏功能（必须通过）===
    const aiInput = page.locator('[data-testid="ai-input-textarea"]');
    await expect(aiInput).toBeVisible();
    await aiInput.fill('生成一张美丽的风景图片');
    await expect(aiInput).toHaveValue('生成一张美丽的风景图片');

    // 模型选择器（必须通过）
    const modelSelector = page.getByRole('button', { name: /#/ }).first();
    await expect(modelSelector).toBeVisible();
    await modelSelector.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');

    // 尺寸选择器（必须通过）
    const sizeSelector = page.getByRole('button', { name: '自动' }).first();
    await expect(sizeSelector).toBeVisible();
    await sizeSelector.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');

    // === 灵感创意板（必须通过）===
    const inspirationTitle = page.getByRole('heading', { name: '灵感创意', level: 3 });
    await expect(inspirationTitle).toBeVisible();

    // === 绘图功能（必须通过）===
    const canvas = page.locator('.board-host-svg');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // 画笔绘图
    const pencilTool = page.getByRole('button', { name: /画笔/ });
    await expect(pencilTool).toBeVisible();
    await pencilTool.click();
    if (box) {
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 });
      await page.mouse.up();
    }

    // 形状绘制
    const shapeTool = page.getByRole('button', { name: /形状/ });
    await expect(shapeTool).toBeVisible();
    await shapeTool.click();
    if (box) {
      await page.mouse.click(box.x + 300, box.y + 300);
      await page.waitForTimeout(300);
    }
  });

  /**
   * 测试2：弹窗抽屉组件
   */
  test('弹窗抽屉：设置、项目管理', async ({ page }) => {
    await page.goto('/');
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    // === 项目抽屉 ===
    const openProjectBtn = page.getByRole('button', { name: '打开项目' });
    
    // 如果显示"打开项目"按钮，点击打开
    if (await openProjectBtn.isVisible().catch(() => false)) {
      await openProjectBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 验证项目抽屉已打开（必须通过）
    const projectTitle = page.getByRole('heading', { name: '项目', level: 3, exact: true });
    await expect(projectTitle).toBeVisible();

    // 新建画板按钮（必须通过）
    const newBoardBtn = page.getByRole('button', { name: '新建画板' });
    await expect(newBoardBtn).toBeVisible();

    // 新建文件夹按钮（必须通过）
    const newFolderBtn = page.getByRole('button', { name: '新建文件夹' });
    await expect(newFolderBtn).toBeVisible();

    // 导入导出按钮（必须通过）
    const importBtn = page.getByRole('button', { name: '导入' });
    const exportBtn = page.getByRole('button', { name: '导出' });
    await expect(importBtn).toBeVisible();
    await expect(exportBtn).toBeVisible();

    // === 工具箱 ===
    const openToolboxBtn = page.getByRole('button', { name: '打开工具箱' });
    if (await openToolboxBtn.isVisible().catch(() => false)) {
      await openToolboxBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 验证工具箱已打开（必须通过）
    const toolboxTitle = page.getByRole('heading', { name: '工具箱', level: 3, exact: true });
    await expect(toolboxTitle).toBeVisible();

    // 工具分类按钮（必须通过）
    const allToolsBtn = page.getByRole('button', { name: '全部' });
    const contentToolsBtn = page.getByRole('button', { name: '内容工具' });
    const aiToolsBtn = page.getByRole('button', { name: 'AI 工具' });
    await expect(allToolsBtn).toBeVisible();
    await expect(contentToolsBtn).toBeVisible();
    await expect(aiToolsBtn).toBeVisible();

    // 点击分类切换
    await aiToolsBtn.click();
    await page.waitForTimeout(200);
    await allToolsBtn.click();
    await page.waitForTimeout(200);

    // 抽屉打开验证通过即可（关闭功能在视觉测试中已覆盖）
  });

  /**
   * 测试3：素材库功能
   */
  test('素材库：打开关闭', async ({ page }) => {
    await page.goto('/');
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    // 素材库按钮（必须通过）
    const mediaLibraryContainer = page.locator('div').filter({ has: page.getByRole('radio', { name: '素材库' }) }).first();
    await expect(mediaLibraryContainer).toBeVisible();
    await mediaLibraryContainer.click({ force: true });
    await page.waitForTimeout(500);
    
    // 关闭
    await page.keyboard.press('Escape');
  });
});
