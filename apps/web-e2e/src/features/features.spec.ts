/**
 * @tags feature
 * 功能测试 - 基于实际页面元素和状态
 * 仅 4 次页面加载，覆盖所有核心功能
 */
import { test, expect } from '../fixtures/test-base';

type DrawnixTestBoard = {
  children: Array<{ id?: string }>;
  apply: (operation: unknown) => void;
};

type DrawnixTestWindow = Window & {
  __drawnixBoard: DrawnixTestBoard;
};

test.describe('@feature 功能测试', () => {
  test('选中图片：Delete 和 Backspace 保持画布删除能力', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.board-host-svg')).toBeVisible();
    await page.waitForFunction(() =>
      Boolean((window as unknown as DrawnixTestWindow).__drawnixBoard)
    );
    await expect(
      page.locator('[data-testid="inspiration-board"]')
    ).toBeVisible();

    const insertImage = async (id: string, prompt: string) => {
      await page.evaluate(
        ({ id, prompt }) => {
          const board = (window as unknown as DrawnixTestWindow).__drawnixBoard;
          board.apply({
            type: 'insert_node',
            path: [board.children.length],
            node: {
              id,
              type: 'image',
              url: '/logo-tuzi.png',
              points: [
                [300, 200],
                [500, 400],
              ],
              angle: 0,
              generationPrompt: prompt,
            },
          });
        },
        { id, prompt }
      );
    };
    const hasImage = (id: string) =>
      page.evaluate((imageId) => {
        const board = (window as unknown as DrawnixTestWindow).__drawnixBoard;
        return board.children.some((element) => element.id === imageId);
      }, id);
    const selectImage = async (id: string, prompt: string) => {
      await page
        .locator(`.foreign-object-image:has(img[src="/logo-tuzi.png"])`)
        .last()
        .click();
      await expect(page.locator('.ai-input-bar--bound-image')).toBeVisible();
      const input = page.locator('[data-testid="ai-input-textarea"]');
      await expect(input).toHaveValue(prompt);
      await expect(input).not.toBeFocused();
      expect(await hasImage(id)).toBe(true);
    };

    await insertImage('typing-delete-image', 'abc');
    await selectImage('typing-delete-image', 'abc');
    const input = page.locator('[data-testid="ai-input-textarea"]');
    await input.focus();
    await input.press('End');
    await input.press('Backspace');
    await expect(input).toHaveValue('ab');
    expect(await hasImage('typing-delete-image')).toBe(true);

    await page.locator('.foreign-object-image .image-origin').last().click();
    await expect(input).not.toBeFocused();
    await page.keyboard.press('Delete');
    await expect.poll(() => hasImage('typing-delete-image')).toBe(false);

    await insertImage('backspace-key-image', 'Backspace 提示词');
    await selectImage('backspace-key-image', 'Backspace 提示词');
    await page.keyboard.press('Backspace');
    await expect.poll(() => hasImage('backspace-key-image')).toBe(false);
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
    const modelSelector = page
      .locator('[data-testid="model-selector"]')
      .first();
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
    const inspirationBoard = page.locator('[data-testid="inspiration-board"]');
    await expect(inspirationBoard).toBeVisible();
    const inspirationTitle = page.getByRole('heading', {
      name: '灵感创意',
      level: 3,
    });
    await expect(inspirationTitle).toBeVisible();
    const firstInspirationCard = inspirationBoard.getByRole('heading', {
      name: '智能拆分宫格图',
      level: 3,
    });
    await expect(firstInspirationCard).toBeVisible();
    await expect(
      inspirationBoard.getByRole('heading', { name: '生成PPT大纲', level: 3 })
    ).toBeVisible();

    await firstInspirationCard.click();
    await expect(aiInput).toHaveValue('生成16宫格猫咪表情包');
    const sendGuide = page.locator('[data-testid="inspiration-send-guide"]');
    await expect(sendGuide).toBeVisible();
    await expect(
      inspirationBoard.getByRole('heading', { name: '确认后发送', level: 3 })
    ).toBeVisible();
    await expect(
      sendGuide.getByText('下一步：点击发送按钮开始生成')
    ).toBeVisible();

    await page.locator('[data-testid="inspiration-guide-back"]').click();
    await expect(sendGuide).toBeHidden();
    await expect(inspirationTitle).toBeVisible();
    await expect(firstInspirationCard).toBeVisible();
    await expect(
      inspirationBoard.getByRole('heading', { name: '生成PPT大纲', level: 3 })
    ).toBeVisible();

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
    const projectTitle = page.getByRole('heading', {
      name: '项目',
      level: 3,
      exact: true,
    });
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
    const toolboxTitle = page.getByRole('heading', {
      name: '工具箱',
      level: 3,
      exact: true,
    });
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
    const mediaLibraryContainer = page
      .locator('div')
      .filter({ has: page.getByRole('radio', { name: '素材库' }) })
      .first();
    await expect(mediaLibraryContainer).toBeVisible();
    await mediaLibraryContainer.click({ force: true });
    await page.waitForTimeout(500);

    // 关闭
    await page.keyboard.press('Escape');
  });
});
