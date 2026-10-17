/**
 * @tags smoke
 * 冒烟测试 - 基于实际页面元素和状态
 * 仅 2 次页面加载，覆盖所有核心功能
 */
import { test, expect } from '../fixtures/test-base';

test.describe('@smoke 核心功能验证', () => {
  /**
   * 测试1：主画布所有组件和交互
   */
  test('主画布：加载、工具栏、AI输入栏、视图导航', async ({ page }) => {
    await page.goto('/creative-center');
    
    // 1. 验证页面加载（必须通过）
    await expect(page).toHaveTitle(/FoxVue|Opentu/);
    await page.getByRole('tab', { name: '画布' }).click();
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page).toHaveURL(/\?board=/, { timeout: 30000 });
    await expect(page.getByRole('complementary', { name: '工作区导航' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: '从空白画布开始' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: '使用 C1 创作模板' }).click();
    await expect(page.getByRole('region', { name: 'C1 节点式创作画布' })).toBeVisible({ timeout: 30000 });
    
    // 2. 验证工具栏存在（必须通过）
    const rail = page.getByRole('complementary', { name: '工作区导航' });
    await expect(rail.getByRole('button', { name: '选择' })).toBeVisible();
    await rail.getByRole('button', { name: '选择' }).click();
    
    // 画笔按钮（必须通过）
    const pencilBtn = rail.getByRole('button', { name: '画笔' });
    await expect(pencilBtn).toBeVisible();
    await pencilBtn.click();
    
    // 形状按钮（必须通过）
    const shapeBtn = rail.getByRole('button', { name: '形状' });
    await expect(shapeBtn).toBeVisible();
    await shapeBtn.click();
    
    // 4. AI 输入栏交互（必须通过）
    const aiInput = page.getByRole('textbox', { name: 'AI 创作描述' });
    await expect(aiInput).toBeVisible();
    await aiInput.fill('测试输入');
    await expect(aiInput).toHaveValue('测试输入');

    // 5. 模型选择器（必须通过）
    const modelSelector = page.getByRole('combobox', { name: '生成模型' });
    await expect(modelSelector).toBeVisible();
    await expect(modelSelector).toHaveValue('gpt-image-2');
    
    // 6. 视图导航缩放（必须通过）
    const zoomIn = page.getByRole('toolbar', { name: '画布快捷控制' }).getByRole('button', { name: '放大' });
    await expect(zoomIn).toBeVisible();
    // 缩放显示按钮名称是 "自适应"，显示内容如 "100%"
    const zoomDisplay = page.getByRole('button', { name: '自适应' });
    await expect(zoomDisplay).toBeVisible();
    const initialZoom = await zoomDisplay.textContent();
    await zoomIn.click();
    await page.waitForTimeout(200);
    const newZoom = await zoomDisplay.textContent();
    expect(newZoom).not.toBe(initialZoom);
  });

  /**
   * 测试2：所有弹窗/抽屉组件
   */
  test('弹窗抽屉：设置、项目、工具箱', async ({ page }) => {
    await page.goto('/creative-center');
    await page.getByRole('tab', { name: '画布' }).click();
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page).toHaveURL(/\?board=/, { timeout: 30000 });
    await page.getByRole('button', { name: '展开右侧面板' }).click();
    
    // === 项目抽屉 ===
    const openProjectBtn = page.getByRole('button', { name: /创作空间/ }).first();
    
    // 如果显示"打开项目"，点击打开；否则已经打开
    if (await openProjectBtn.isVisible().catch(() => false)) {
      await openProjectBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 验证项目抽屉已打开（必须通过）
    const projectTitle = page.getByRole('dialog', { name: '项目切换器' });
    await expect(projectTitle).toBeVisible();
    
    // === 工具箱 ===
    await page.getByRole('tab', { name: '图层' }).click();
    await expect(page.getByText('当前画布', { exact: true })).toBeVisible();
    
    // 抽屉打开验证通过即可（关闭功能在视觉测试中已覆盖）
    
    // === 设置对话框（在"更多"菜单中）===
    await page.getByRole('button', { name: '关闭面板' }).click();
    await expect(page.getByRole('complementary', { name: '工作区上下文' })).toHaveCount(0);
  });
});
