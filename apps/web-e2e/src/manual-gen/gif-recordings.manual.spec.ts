/**
 * GIF 录制测试
 * 
 * 用于生成用户手册中的 GIF 动图演示
 * 
 * 使用方法：
 * 1. 运行 `pnpm manual:record` 录制操作
 * 2. 将录制的代码复制到下面对应的测试中
 * 3. 运行 `pnpm manual:gif` 生成 GIF
 */

import { test, expect, Page } from '@playwright/test';

/**
 * 显示快捷键提示
 * 在屏幕右下角显示按键提示，用于 GIF 演示
 */
async function showKeyHint(page: Page, key: string, duration = 1500) {
  await page.evaluate(({ keyText, dur }) => {
    // 创建或获取提示容器
    let container = document.getElementById('key-hint-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'key-hint-container';
      container.style.cssText = `
        position: fixed;
        bottom: 120px;
        right: 50px;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    
    // 创建提示元素
    const hint = document.createElement('div');
    hint.style.cssText = `
      background: linear-gradient(135deg, #F39C12 0%, #E67E22 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 10px;
      font-size: 20px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: keyHintIn 0.3s ease-out;
    `;
    
    // 添加提示内容
    hint.innerHTML = `<span>${keyText}</span>`;
    
    // 添加动画样式
    if (!document.getElementById('key-hint-styles')) {
      const style = document.createElement('style');
      style.id = 'key-hint-styles';
      style.textContent = `
        @keyframes keyHintIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes keyHintOut {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(20px); }
        }
      `;
      document.head.appendChild(style);
    }
    
    container.appendChild(hint);
    
    // 定时移除（使用传入的 duration）
    setTimeout(() => {
      hint.style.animation = 'keyHintOut 0.3s ease-in forwards';
      setTimeout(() => hint.remove(), 300);
    }, dur - 300);
  }, { keyText: key, dur: duration });
  
  await page.waitForTimeout(duration);
}

/**
 * 带提示的按键操作
 */
async function pressWithHint(page: Page, key: string, displayKey?: string) {
  const display = displayKey || key.toUpperCase();
  await showKeyHint(page, display);
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
}

/**
 * 显示点击效果
 * 在元素上显示红色圆圈动画，标识点击位置
 */
async function showClickEffect(page: Page, x: number, y: number, label?: string) {
  await page.evaluate(({ posX, posY, text }) => {
    // 创建点击效果容器
    const effect = document.createElement('div');
    effect.style.cssText = `
      position: fixed;
      left: ${posX}px;
      top: ${posY}px;
      transform: translate(-50%, -50%);
      z-index: 999999;
      pointer-events: none;
    `;
    
    // 红色圆圈
    const circle = document.createElement('div');
    circle.style.cssText = `
      width: 40px;
      height: 40px;
      border: 4px solid #E91E63;
      border-radius: 50%;
      background: rgba(233, 30, 99, 0.2);
      animation: clickPulse 0.8s ease-out;
    `;
    effect.appendChild(circle);
    
    // 标签文字
    if (text) {
      const labelEl = document.createElement('div');
      labelEl.style.cssText = `
        position: absolute;
        top: 50px;
        left: 50%;
        transform: translateX(-50%);
        background: #E91E63;
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      labelEl.textContent = text;
      effect.appendChild(labelEl);
    }
    
    // 添加动画样式
    if (!document.getElementById('click-effect-styles')) {
      const style = document.createElement('style');
      style.id = 'click-effect-styles';
      style.textContent = `
        @keyframes clickPulse {
          0% { transform: scale(0.5); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.8; }
          100% { transform: scale(1); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(effect);
    
    // 移除效果
    setTimeout(() => effect.remove(), 1500);
  }, { posX: x, posY: y, text: label });
}

// 是否已记录第一次点击
let firstClickLogged = false;

/**
 * 点击元素并显示点击效果
 */
async function clickWithEffect(page: Page, locator: ReturnType<Page['locator']>, label?: string, waitAfter = 1500) {
  // 记录第一次点击的时间（用于计算裁剪点）
  if (!firstClickLogged && testStartTime) {
    const elapsed = (Date.now() - testStartTime) / 1000;
    // 输出裁剪建议（第一次点击前 1 秒开始）
    const trimStart = Math.max(0, elapsed - 1).toFixed(1);
    console.log(`\n📍 第一次点击时间: ${elapsed.toFixed(1)}s`);
    console.log(`✂️  建议裁剪参数: --trim ${trimStart}\n`);
    firstClickLogged = true;
  }
  
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    
    // 先显示点击效果
    await showClickEffect(page, x, y, label);
    await page.waitForTimeout(500);
    
    // 再执行点击
    await locator.click();
    await page.waitForTimeout(waitAfter);
  } else {
    await locator.click();
    await page.waitForTimeout(waitAfter);
  }
}

/**
 * 重置第一次点击记录（用于多个测试）
 */
function resetFirstClick() {
  firstClickLogged = false;
}

// 记录测试开始时间，用于计算裁剪点
let testStartTime: number;

test.describe('GIF 动图录制', () => {
  test.beforeEach(async ({ page }) => {
    // 视频从这里开始录制，记录时间
    testStartTime = Date.now();
    firstClickLogged = false;
    
    await page.goto('/');
    // 等待应用加载
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: 10000 });
    // 等待 UI 完全稳定
    await page.waitForTimeout(2000);
  });

  test('思维导图创建演示', async ({ page }) => {
    // 使用 Markdown 到 Drawnix 创建思维导图
    // 注意：beforeEach 已等待 2 秒，转 GIF 时用 --trim 2 裁剪
    
    // 点击工具箱更多按钮
    await clickWithEffect(
      page, 
      page.getByTestId('toolbar-more'), 
      '点击更多工具',
      1500
    );
    
    // 点击 Markdown 到 Drawnix
    await clickWithEffect(
      page, 
      page.getByRole('button', { name: 'Markdown 到 Drawnix' }), 
      '选择 Markdown 转换',
      1500
    );
    
    // 点击插入（使用默认示例）
    await clickWithEffect(
      page, 
      page.getByRole('button', { name: '插入' }), 
      '点击插入',
      2500
    );
    
    // 关闭对话框
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    
    // 演示编辑思维导图
    // 点击思维导图中的一个节点
    const mindNode = page.locator('.mind-node-content').first();
    if (await mindNode.isVisible().catch(() => false)) {
      await clickWithEffect(page, mindNode, '点击节点进入编辑', 1500);
      
      // Tab 添加子节点
      await showKeyHint(page, 'Tab：添加子节点', 2000);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(1500);
      
      await page.keyboard.type('新子节点', { delay: 200 });
      await page.waitForTimeout(1500);
      
      // Enter 添加同级节点
      await showKeyHint(page, 'Enter：添加同级节点', 2000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      
      await page.keyboard.type('同级节点', { delay: 200 });
      await page.waitForTimeout(2000);
    }
    
    // 点击空白处完成编辑
    await page.mouse.click(100, 100);
    await page.waitForTimeout(2500);
  });

  test('画笔绘制演示', async ({ page }) => {
    // 按 P 切换到画笔
    await showKeyHint(page, 'P - 画笔工具');
    await page.keyboard.press('p');
    await page.waitForTimeout(500);
    
    const canvas = page.locator('.board-host-svg');
    const box = await canvas.boundingBox();
    
    if (box) {
      const startX = box.x + 200;
      const startY = box.y + 200;
      
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      
      // 绘制波浪线
      for (let i = 0; i < 10; i++) {
        const x = startX + i * 30;
        const y = startY + Math.sin(i * 0.5) * 50;
        await page.mouse.move(x, y);
        await page.waitForTimeout(50);
      }
      
      await page.mouse.up();
    }
    
    await page.waitForTimeout(1000);
  });

  test('AI 图片生成演示', async ({ page }) => {
    const inputBar = page.locator('[data-testid="ai-input-textarea"]');
    
    if (await inputBar.isVisible().catch(() => false)) {
      await inputBar.click();
      await page.waitForTimeout(300);
      
      await page.keyboard.type('一只可爱的橘猫', { delay: 100 });
      await page.waitForTimeout(1000);
    }
    
    await page.waitForTimeout(1000);
  });

  test('工具箱操作演示', async ({ page }) => {
    // 工具箱完整操作流程：打开 → 使用工具 → 窗口控制 → 关闭
    
    // 步骤 1: 点击工具箱按钮
    await clickWithEffect(
      page, 
      page.getByTestId('toolbar-toolbox'), 
      '打开工具箱',
      1500
    );
    
    // 步骤 2: 点击第一个工具的「新窗口」按钮
    const openWindowBtn = page.locator('.tool-item__action-btn.tool-item__action-btn--open-window').first();
    await clickWithEffect(
      page, 
      openWindowBtn, 
      '在新窗口打开工具',
      2000
    );
    
    // 步骤 3: 演示窗口控制 - 最大化
    await showKeyHint(page, '最大化窗口', 1500);
    const maxBtn = page.locator('.wb-max');
    if (await maxBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, maxBtn, '最大化', 1500);
    }
    
    // 步骤 4: 演示窗口控制 - 还原
    await showKeyHint(page, '还原窗口大小', 1500);
    const minBtn = page.locator('.wb-min');
    if (await minBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, minBtn, '还原', 1500);
    }
    
    // 步骤 5: 演示窗口控制 - 分屏模式
    await showKeyHint(page, '分屏显示', 1500);
    const splitBtn = page.locator('.wb-split').first();
    if (await splitBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, splitBtn, '分屏', 1500);
    }
    
    // 步骤 6: 演示窗口控制 - 插入画布
    await showKeyHint(page, '插入到画布', 1500);
    const insertBtn = page.locator('.wb-insert-canvas').first();
    if (await insertBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, insertBtn, '插入画布', 1500);
    }
    
    // 步骤 7: 关闭窗口
    await page.waitForTimeout(1000);
    const closeBtn = page.locator('.wb-close').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, closeBtn, '关闭', 1000);
    }
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('素材库操作演示', async ({ page }) => {
    // 素材库完整操作流程：打开 → 上传 → 视图切换 → 批量操作 → 下载/插入
    
    // 步骤 1: 打开素材库
    await showKeyHint(page, '打开素材库', 1500);
    const toolbar = page.locator('.unified-toolbar').or(page.locator('[class*="toolbar"]')).first();
    const mediaLibraryBtn = toolbar.locator('label').filter({ has: page.getByRole('radio', { name: /素材库/ }) }).first();
    await clickWithEffect(
      page, 
      mediaLibraryBtn, 
      '素材库',
      1500
    );
    
    // 步骤 2: 演示上传功能
    await showKeyHint(page, '上传图片到素材库', 2000);
    const uploadBtn = page.getByTestId('media-library-grid').getByRole('button', { name: '上传' });
    await clickWithEffect(page, uploadBtn, '上传', 1000);
    
    // 注意：文件上传需要实际文件路径，这里只演示点击
    // 实际测试时需要准备测试图片
    // await uploadBtn.setInputFiles('path/to/test-image.png');
    await page.waitForTimeout(1500);
    
    // 步骤 3: 演示视图模式切换
    await showKeyHint(page, '切换视图模式', 1500);
    
    // 紧凑网格
    const compactGridBtn = page.getByRole('button', { name: '紧凑网格' });
    if (await compactGridBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, compactGridBtn, '紧凑网格', 1000);
    }
    
    // 列表视图
    const listViewBtn = page.getByRole('button', { name: '列表视图' });
    if (await listViewBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, listViewBtn, '列表视图', 1000);
    }
    
    // 默认网格
    const defaultGridBtn = page.getByRole('button', { name: '默认网格' });
    if (await defaultGridBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, defaultGridBtn, '默认网格', 1000);
    }
    
    // 步骤 4: 演示批量选择模式
    await showKeyHint(page, '批量选择素材', 1500);
    const batchSelectBtn = page.getByRole('button', { name: '批量选择' });
    if (await batchSelectBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, batchSelectBtn, '批量选择', 1500);
    }
    
    // 选择第一个素材
    const firstMedia = page.getByTestId('media-library-grid').locator('[role="button"]').first();
    if (await firstMedia.isVisible().catch(() => false)) {
      await clickWithEffect(page, firstMedia, '选择素材', 1000);
    }
    
    // 退出批量选择
    const cancelBtn = page.getByRole('button', { name: '取消' });
    if (await cancelBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, cancelBtn, '取消选择', 1000);
    }
    
    // 步骤 5: 演示缩放滑块
    await showKeyHint(page, '调整缩略图大小', 1500);
    const slider = page.getByRole('slider');
    if (await slider.isVisible().catch(() => false)) {
      // 调整滑块值
      await slider.fill('130');
      await page.waitForTimeout(1000);
    }
    
    // 步骤 6: 演示素材操作（选中素材）
    const mediaItem = page.getByTestId('media-library-grid').locator('[role="button"]').first();
    if (await mediaItem.isVisible().catch(() => false)) {
      await clickWithEffect(page, mediaItem, '选择素材', 1500);
      
      // 下载按钮
      await showKeyHint(page, '下载素材', 1500);
      const downloadBtn = page.getByRole('button', { name: '下载' });
      if (await downloadBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, downloadBtn, '下载', 1000);
      }
      
      // 等待下载完成
      await page.waitForTimeout(1000);
      
      // 插入到画布
      await showKeyHint(page, '插入到画布', 1500);
      const insertBtn = page.getByRole('button', { name: '插入' });
      if (await insertBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, insertBtn, '插入', 1500);
      }
    }
    
    // 步骤 7: 演示排序功能
    await showKeyHint(page, '切换排序方式', 1500);
    const sortBtn = page.locator('.lucide.lucide-arrow-down-za');
    if (await sortBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, sortBtn, '排序', 1000);
      
      // 选择排序选项
      const sortOption = page.locator('.media-library-grid__sort-options > div').nth(2);
      if (await sortOption.isVisible().catch(() => false)) {
        await clickWithEffect(page, sortOption, '按大小排序', 1000);
      }
    }
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('项目管理演示', async ({ page }) => {
    // 项目管理完整流程：打开 → 新建文件夹/画板 → 重命名 → 切换 → 导入/导出
    
    // 步骤 1: 打开项目抽屉
    await showKeyHint(page, '打开项目管理', 1500);
    const projectBtn = page.getByRole('button', { name: /打开项目/ });
    if (await projectBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, projectBtn, '项目管理', 1500);
    }
    
    // 步骤 2: 新建文件夹
    await showKeyHint(page, '新建文件夹', 1500);
    const newFolderBtn = page.getByRole('button', { name: '新建文件夹' });
    if (await newFolderBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, newFolderBtn, '新建文件夹', 1500);
      
      // 重命名文件夹
      const folderNode = page.getByText('新建文件夹').nth(1);
      if (await folderNode.isVisible().catch(() => false)) {
        await folderNode.dblclick();
        await page.waitForTimeout(500);
        
        const nameInput = page.getByRole('textbox', { name: /请输入/ });
        if (await nameInput.isVisible().catch(() => false)) {
          await nameInput.fill('目录1');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
        }
      }
    }
    
    // 步骤 3: 在文件夹中新建画板
    await showKeyHint(page, '在文件夹中新建画板', 1500);
    // 展开文件夹的菜单
    const folderMenu = page.locator('.project-drawer-node__actions > .t-button').first();
    if (await folderMenu.isVisible().catch(() => false)) {
      await clickWithEffect(page, folderMenu, '文件夹菜单', 1000);
      
      // 点击下拉菜单中的"新建画板"
      const newBoardBtn = page.locator('.t-dropdown__item-text').filter({ hasText: '新建画板' });
      if (await newBoardBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, newBoardBtn, '新建画板', 1000);
        
        // 输入画板名称
        const boardNameInput = page.getByRole('textbox', { name: /请输入/ });
        if (await boardNameInput.isVisible().catch(() => false)) {
          await boardNameInput.fill('画布1');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1500);
        }
      }
    }
    
    // 步骤 4: 演示画板切换
    await showKeyHint(page, '切换画板', 1500);
    const myBoard = page.getByText('我的画板').first();
    if (await myBoard.isVisible().catch(() => false)) {
      await clickWithEffect(page, myBoard, '切换到其他画板', 1000);
    }
    
    // 切换回新建的画板
    const newBoard = page.getByText('画布').first();
    if (await newBoard.isVisible().catch(() => false)) {
      await clickWithEffect(page, newBoard, '切回新画板', 1000);
    }
    
    // 步骤 5: 重命名画板
    await showKeyHint(page, '重命名画板', 1500);
    if (await newBoard.isVisible().catch(() => false)) {
      await newBoard.dblclick();
      await page.waitForTimeout(500);
      
      const renameInput = page.getByRole('textbox', { name: /请输入/ });
      if (await renameInput.isVisible().catch(() => false)) {
        await renameInput.fill('画布重命名1');
        await page.waitForTimeout(500);
        // 点击外部保存
        await page.locator('.project-drawer-node__row--active').click();
        await page.waitForTimeout(1000);
      }
    }
    
    // 步骤 6: 新建更多画板
    await showKeyHint(page, '继续新建画板', 1500);
    const newBoardBtn2 = page.getByRole('button', { name: '新建画板' });
    if (await newBoardBtn2.isVisible().catch(() => false)) {
      await clickWithEffect(page, newBoardBtn2, '新建画板', 1000);
      
      const boardNameInput2 = page.getByRole('textbox', { name: /请输入/ });
      if (await boardNameInput2.isVisible().catch(() => false)) {
        await boardNameInput2.fill('新建画布1');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
      }
    }
    
    // 步骤 7: 演示搜索功能
    await showKeyHint(page, '搜索画板', 1500);
    const searchInput = page.getByTestId('project-drawer').getByRole('textbox', { name: /搜索/ });
    if (await searchInput.isVisible().catch(() => false)) {
      await clickWithEffect(page, searchInput, '搜索', 500);
      await page.keyboard.type('画布', { delay: 150 });
      await page.waitForTimeout(1500);
      
      // 清空搜索
      await searchInput.clear();
      await page.waitForTimeout(1000);
    }
    
    // 步骤 8: 导入/导出功能
    await showKeyHint(page, '导入/导出项目', 1500);
    const importBtn = page.getByRole('button', { name: '导入' });
    if (await importBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, importBtn, '导入', 1000);
    }
    
    const exportBtn = page.getByRole('button', { name: '导出' });
    if (await exportBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, exportBtn, '导出', 1000);
    }
    
    // 步骤 9: 关闭项目抽屉
    await page.waitForTimeout(1000);
    const closeBtn = page.getByTestId('project-drawer').getByRole('button', { name: /关闭/ });
    if (await closeBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, closeBtn, '关闭', 1000);
    }
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('备份恢复演示', async ({ page }) => {
    // 备份恢复完整流程：打开 → 备份 → 恢复
    
    // 步骤 1: 打开应用菜单
    await showKeyHint(page, '打开应用菜单', 1500);
    const menuBtn = page.getByRole('button', { name: /应用菜单/ });
    if (await menuBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, menuBtn, '应用菜单', 1500);
    }
    
    // 步骤 2: 打开备份/恢复对话框
    await showKeyHint(page, '备份与恢复', 1500);
    const backupBtn = page.getByRole('button', { name: /备份.*恢复/ });
    if (await backupBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, backupBtn, '备份/恢复', 1500);
    }
    
    // 步骤 3: 演示备份选项
    await showKeyHint(page, '选择备份内容', 1500);
    const checkboxes = page.locator('.t-checkbox__input');
    const firstCheckbox = checkboxes.first();
    if (await firstCheckbox.isVisible().catch(() => false)) {
      // 演示勾选
      await clickWithEffect(page, firstCheckbox, '选择项目', 1000);
      await page.waitForTimeout(500);
    }
    
    // 步骤 4: 开始备份
    await showKeyHint(page, '开始备份', 1500);
    const startBackupBtn = page.getByRole('button', { name: /开始备份/ });
    if (await startBackupBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, startBackupBtn, '开始备份', 1500);
      
      // 等待下载开始
      await page.waitForTimeout(2000);
    }
    
    // 步骤 5: 切换到恢复标签页
    await showKeyHint(page, '恢复备份', 1500);
    const restoreTab = page.getByRole('button', { name: '恢复' });
    if (await restoreTab.isVisible().catch(() => false)) {
      await clickWithEffect(page, restoreTab, '恢复标签', 1500);
    }
    
    // 步骤 6: 演示文件选择区域
    await showKeyHint(page, '选择备份文件', 1500);
    const fileArea = page.locator('div').filter({ hasText: /点击选择备份文件/ }).first();
    if (await fileArea.isVisible().catch(() => false)) {
      await clickWithEffect(page, fileArea, '选择文件', 1000);
      
      // 注意：实际文件上传需要真实文件路径
      // 这里只演示点击动作
      // await page.getByTestId('backup-restore-dialog').setInputFiles('path/to/backup.zip');
      await page.waitForTimeout(1500);
    }
    
    // 步骤 7: 显示完成按钮位置
    await showKeyHint(page, '确认并刷新', 1500);
    const completeBtn = page.getByRole('button', { name: /完成.*刷新/ });
    if (await completeBtn.isVisible().catch(() => false)) {
      const box = await completeBtn.boundingBox();
      if (box) {
        // 只显示位置，不实际点击（避免刷新页面）
        await showClickEffect(page, box.x + box.width / 2, box.y + box.height / 2, '完成并刷新');
        await page.waitForTimeout(1500);
      }
    }
    
    // 步骤 8: 关闭对话框
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('AI 输入栏基础交互演示', async ({ page }) => {
    // AI 输入栏基础交互：聚焦 → 输入 → 展开 → 清空 → 收缩
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 显示 AI 输入栏位置
    await showKeyHint(page, '底部 AI 输入栏', 1500);
    const aiInputBar = page.getByTestId('ai-input-bar');
    await page.waitForTimeout(500);
    
    // 步骤 3: 定位输入框
    const inputField = aiInputBar.locator('input[type="text"]').or(
      aiInputBar.locator('textarea')
    ).first();
    
    // 步骤 4: 点击输入框聚焦
    await showKeyHint(page, '点击输入框', 1000);
    if (await inputField.isVisible().catch(() => false)) {
      await clickWithEffect(page, inputField, '聚焦输入框', 1000);
    }
    
    // 步骤 5: 输入提示词
    await showKeyHint(page, '输入提示词', 1000);
    await page.keyboard.type('一只可爱的猫咪在阳光下玩耍', { delay: 80 });
    await page.waitForTimeout(1000);
    
    // 步骤 6: 展示输入框展开效果
    await showKeyHint(page, '输入框自动展开', 1500);
    await page.waitForTimeout(1000);
    
    // 步骤 7: 继续输入更多内容
    await showKeyHint(page, '继续输入', 1000);
    await page.keyboard.type('，画面温馨治愈', { delay: 80 });
    await page.waitForTimeout(1500);
    
    // 步骤 8: 清空输入
    await showKeyHint(page, '清空输入', 1000);
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(300);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(1000);
    
    // 步骤 9: 失焦收缩
    await showKeyHint(page, '输入框收缩', 1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('模型选择器演示', async ({ page }) => {
    // 模型选择器：打开 → 浏览 → 健康状态 → 选择 → 快捷代码
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 定位 AI 输入栏
    const aiInputBar = page.getByTestId('ai-input-bar');
    
    // 步骤 3: 打开模型下拉菜单
    await showKeyHint(page, '选择生成模型', 1500);
    const modelDropdown = aiInputBar.locator('.model-dropdown__trigger').or(
      aiInputBar.locator('[class*="model"]').locator('button')
    ).first();
    
    if (await modelDropdown.isVisible().catch(() => false)) {
      await clickWithEffect(page, modelDropdown, '打开模型列表', 1500);
    }
    
    // 步骤 4: 浏览模型列表（滚动）
    await showKeyHint(page, '浏览可用模型', 1500);
    const modelMenu = page.locator('.model-dropdown__menu').or(
      page.locator('[class*="model-dropdown"]').locator('[role="menu"]')
    );
    
    if (await modelMenu.isVisible().catch(() => false)) {
      await modelMenu.evaluate(el => {
        el.scrollBy({ top: 80, behavior: 'smooth' });
      });
      await page.waitForTimeout(1000);
      
      await modelMenu.evaluate(el => {
        el.scrollBy({ top: 80, behavior: 'smooth' });
      });
      await page.waitForTimeout(1000);
    }
    
    // 步骤 5: 展示模型健康状态
    await showKeyHint(page, '模型健康状态指示', 1500);
    await page.waitForTimeout(1000);
    
    // 步骤 6: 选择 imagen3 模型（如果存在）
    await showKeyHint(page, '选择模型', 1000);
    const modelItem = page.locator('.model-dropdown__item').or(
      page.locator('[class*="model"]').locator('[role="menuitem"]')
    ).filter({ hasText: /imagen/i }).first();
    
    if (await modelItem.isVisible().catch(() => false)) {
      await clickWithEffect(page, modelItem, '选择 Imagen', 1500);
    } else {
      // 如果找不到 imagen，选择第一个模型
      const firstModel = page.locator('.model-dropdown__item').or(
        page.locator('[role="menuitem"]')
      ).first();
      if (await firstModel.isVisible().catch(() => false)) {
        await clickWithEffect(page, firstModel, '选择模型', 1500);
      }
    }
    
    // 步骤 7: 显示快捷代码
    await showKeyHint(page, '模型快捷代码显示', 1500);
    await page.waitForTimeout(1000);
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('参数配置演示', async ({ page }) => {
    // 参数配置：打开 → 尺寸选择 → 数量选择 → 生成类型 → 保存
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 定位 AI 输入栏
    const aiInputBar = page.getByTestId('ai-input-bar');
    
    // 步骤 3: 打开参数配置
    await showKeyHint(page, '配置生成参数', 1500);
    const paramsBtn = aiInputBar.locator('.parameters-dropdown__trigger').or(
      aiInputBar.locator('[class*="parameters"]').locator('button')
    ).first();
    
    if (await paramsBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, paramsBtn, '打开参数配置', 1500);
    }
    
    // 步骤 4: 展示参数面板（平铺显示）
    await showKeyHint(page, '所有参数平铺展示', 1500);
    const paramsPanel = page.locator('.parameters-dropdown__menu').or(
      page.locator('[class*="parameters"]').locator('[role="menu"]')
    );
    await page.waitForTimeout(1000);
    
    // 步骤 5: 选择图片尺寸
    await showKeyHint(page, '选择图片尺寸', 1000);
    const sizeOption = paramsPanel.locator('[data-param-value="16:9"]').or(
      paramsPanel.locator('button').filter({ hasText: /16:9|16×9/ })
    ).first();
    
    if (await sizeOption.isVisible().catch(() => false)) {
      await clickWithEffect(page, sizeOption, '选择 16:9', 1000);
      await page.waitForTimeout(800);
    }
    
    // 步骤 6: 选择生成数量
    await showKeyHint(page, '选择生成数量', 1000);
    const countOption = paramsPanel.locator('[data-param-value="4"]').or(
      paramsPanel.locator('button').filter({ hasText: /^4$/ })
    ).first();
    
    if (await countOption.isVisible().catch(() => false)) {
      await clickWithEffect(page, countOption, '选择 4 张', 1000);
      await page.waitForTimeout(800);
    }
    
    // 步骤 7: 展示其他参数
    await showKeyHint(page, '更多参数选项', 1500);
    await page.waitForTimeout(1000);
    
    // 步骤 8: 关闭参数面板
    await showKeyHint(page, '配置已保存', 1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('多模态内容选择演示', async ({ page }) => {
    // 多模态内容选择：上传 → 素材库 → 已选预览 → 移除
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 定位 AI 输入栏
    const aiInputBar = page.getByTestId('ai-input-bar');
    
    // 步骤 3: 展示上传图片按钮
    await showKeyHint(page, '上传参考图片', 1500);
    const uploadBtn = aiInputBar.locator('.ai-input-bar__upload-btn').or(
      aiInputBar.locator('button').filter({ hasText: /上传/ })
    ).first();
    
    if (await uploadBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, uploadBtn, '上传图片', 1000);
      // 注意：实际文件上传需要真实文件，这里只演示点击
      await page.waitForTimeout(1000);
    }
    
    // 步骤 4: 演示文件选择器（模拟）
    await showKeyHint(page, '（演示：文件选择器）', 1500);
    await page.waitForTimeout(1000);
    
    // 步骤 5: 从素材库选择
    await showKeyHint(page, '从素材库选择', 1500);
    const libraryBtn = aiInputBar.locator('.ai-input-bar__library-btn').or(
      aiInputBar.locator('button[title*="素材库"]')
    ).first();
    
    if (await libraryBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, libraryBtn, '打开素材库', 1500);
    }
    
    // 步骤 6: 等待素材库模态框
    await page.waitForTimeout(1000);
    const mediaLibrary = page.getByTestId('media-library-grid');
    
    if (await mediaLibrary.isVisible().catch(() => false)) {
      // 展示素材库
      await showKeyHint(page, '选择参考素材', 1500);
      
      // 选择第一个素材（如果存在）
      const firstAsset = mediaLibrary.locator('.asset-item').first();
      if (await firstAsset.isVisible().catch(() => false)) {
        await clickWithEffect(page, firstAsset, '选择素材', 1000);
        await page.waitForTimeout(800);
        
        // 确认选择
        const confirmBtn = page.getByRole('button', { name: /确认|确定|选择/ });
        if (await confirmBtn.isVisible().catch(() => false)) {
          await clickWithEffect(page, confirmBtn, '确认', 1000);
        }
      }
    }
    
    // 步骤 7: 展示已选内容预览
    await showKeyHint(page, '已选内容预览', 1500);
    const preview = aiInputBar.locator('.selected-content-preview').or(
      aiInputBar.locator('[class*="preview"]')
    );
    await page.waitForTimeout(1000);
    
    // 步骤 8: 移除选中内容
    await showKeyHint(page, '移除选中内容', 1000);
    const removeBtn = preview.locator('.remove-btn').or(
      preview.locator('button').filter({ hasText: /×|删除|移除/ })
    ).first();
    
    if (await removeBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, removeBtn, '移除', 1000);
    }
    
    // 步骤 9: 画布元素选择提示
    await showKeyHint(page, '画布选中元素自动捕获', 1500);
    await page.waitForTimeout(1000);
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('ChatDrawer 基础交互演示', async ({ page }) => {
    // ChatDrawer 基础：触发按钮 → 打开抽屉 → 新建会话 → 切换会话 → 调整宽度 → 关闭
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 显示 ChatDrawer 触发按钮
    await showKeyHint(page, '对话抽屉入口', 1500);
    const chatTrigger = page.locator('.chat-drawer-trigger').or(
      page.getByRole('button').filter({ hasText: /对话|聊天|Chat/ })
    ).first();
    
    // 步骤 3: 点击打开 ChatDrawer
    await showKeyHint(page, '打开对话抽屉', 1000);
    if (await chatTrigger.isVisible().catch(() => false)) {
      await clickWithEffect(page, chatTrigger, '打开', 1500);
    }
    
    // 步骤 4: 等待抽屉动画
    await page.waitForTimeout(1000);
    const chatDrawer = page.getByTestId('chat-drawer').or(
      page.locator('.chat-drawer')
    );
    
    if (await chatDrawer.isVisible().catch(() => false)) {
      // 步骤 5: 展示抽屉界面
      await showKeyHint(page, '对话历史与消息', 1500);
      await page.waitForTimeout(1000);
      
      // 步骤 6: 新建会话
      await showKeyHint(page, '新建会话', 1000);
      const newSessionBtn = chatDrawer.getByRole('button').filter({ 
        hasText: /新建|新增|\+/ 
      }).first();
      
      if (await newSessionBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, newSessionBtn, '新建会话', 1000);
        await page.waitForTimeout(1000);
      }
      
      // 步骤 7: 会话列表
      await showKeyHint(page, '会话列表', 1500);
      const sessionListBtn = chatDrawer.locator('[class*="session"]').locator('button').first();
      if (await sessionListBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, sessionListBtn, '查看会话', 1000);
        await page.waitForTimeout(1000);
      }
      
      // 步骤 8: 拖动调整宽度
      await showKeyHint(page, '拖动调整宽度', 1500);
      const resizeHandle = chatDrawer.locator('.resize-handle').or(
        chatDrawer.locator('[class*="resize"]')
      ).first();
      
      if (await resizeHandle.isVisible().catch(() => false)) {
        const handleBox = await resizeHandle.boundingBox();
        if (handleBox) {
          // 模拟拖动
          await page.mouse.move(handleBox.x, handleBox.y + handleBox.height / 2);
          await showClickEffect(page, handleBox.x, handleBox.y + handleBox.height / 2, '拖动');
          await page.waitForTimeout(500);
          await page.mouse.down();
          await page.mouse.move(handleBox.x - 100, handleBox.y + handleBox.height / 2, { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(1000);
        }
      }
      
      // 步骤 9: 关闭抽屉
      await showKeyHint(page, '关闭抽屉', 1000);
      const closeBtn = chatDrawer.getByRole('button').filter({ 
        hasText: /关闭|Close|×/ 
      }).first();
      
      if (await closeBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, closeBtn, '关闭', 1000);
      } else {
        // 使用 ESC 键关闭
        await page.keyboard.press('Escape');
      }
    }
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('会话管理演示', async ({ page }) => {
    // 会话管理：打开 → 会话列表 → 新建 → 重命名 → 切换 → 删除
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 打开 ChatDrawer
    await showKeyHint(page, '打开对话抽屉', 1500);
    const chatTrigger = page.locator('.chat-drawer-trigger').or(
      page.getByRole('button').filter({ hasText: /对话|聊天/ })
    ).first();
    
    if (await chatTrigger.isVisible().catch(() => false)) {
      await clickWithEffect(page, chatTrigger, '打开', 1500);
    }
    
    await page.waitForTimeout(1000);
    const chatDrawer = page.getByTestId('chat-drawer').or(
      page.locator('.chat-drawer')
    );
    
    if (await chatDrawer.isVisible().catch(() => false)) {
      // 步骤 3: 打开会话列表
      await showKeyHint(page, '查看所有会话', 1500);
      const sessionListBtn = chatDrawer.locator('button').filter({ 
        hasText: /会话列表|Sessions/ 
      }).first();
      
      if (await sessionListBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, sessionListBtn, '会话列表', 1500);
      }
      
      // 步骤 4: 新建会话
      await showKeyHint(page, '新建对话', 1000);
      const newBtn = chatDrawer.getByRole('button').filter({ 
        hasText: /新建|新增/ 
      }).first();
      
      if (await newBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, newBtn, '新建', 1000);
        await page.waitForTimeout(800);
      }
      
      // 步骤 5: 会话重命名（如果支持）
      await showKeyHint(page, '重命名会话', 1500);
      const sessionItem = chatDrawer.locator('.session-item').or(
        chatDrawer.locator('[class*="session"]')
      ).first();
      
      if (await sessionItem.isVisible().catch(() => false)) {
        // 右键或点击更多按钮
        const moreBtn = sessionItem.locator('button').filter({ 
          hasText: /更多|⋮|\.\.\./ 
        }).first();
        
        if (await moreBtn.isVisible().catch(() => false)) {
          await clickWithEffect(page, moreBtn, '更多操作', 1000);
          await page.waitForTimeout(500);
        }
      }
      
      // 步骤 6: 切换会话
      await showKeyHint(page, '切换会话', 1500);
      const secondSession = chatDrawer.locator('.session-item').nth(1);
      if (await secondSession.isVisible().catch(() => false)) {
        await clickWithEffect(page, secondSession, '切换', 1000);
        await page.waitForTimeout(1000);
      }
      
      // 步骤 7: 删除会话
      await showKeyHint(page, '删除会话', 1000);
      const deleteBtn = chatDrawer.locator('button').filter({ 
        hasText: /删除|Delete/ 
      }).first();
      
      if (await deleteBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, deleteBtn, '删除', 1000);
        
        // 确认删除
        const confirmBtn = page.getByRole('button').filter({ 
          hasText: /确定|确认|OK/ 
        });
        if (await confirmBtn.isVisible().catch(() => false)) {
          await clickWithEffect(page, confirmBtn, '确认', 1000);
        }
      }
      
      // 步骤 8: 关闭
      await page.keyboard.press('Escape');
    }
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('智能提示面板演示', async ({ page }) => {
    // 智能提示面板：历史提示词 → 预设提示词 → 置顶 → 选择使用
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 定位 AI 输入栏
    const aiInputBar = page.getByTestId('ai-input-bar');
    
    // 步骤 3: 展示历史提示词入口
    await showKeyHint(page, '历史提示词', 1500);
    const historyBtn = aiInputBar.locator('.prompt-history-popover__trigger').or(
      aiInputBar.locator('button').filter({ hasText: /历史|提示词/ })
    ).first();
    
    // 步骤 4: 悬浮打开历史面板
    await showKeyHint(page, '悬浮查看历史', 1000);
    if (await historyBtn.isVisible().catch(() => false)) {
      await historyBtn.hover();
      await page.waitForTimeout(1000); // 悬浮延迟
    }
    
    // 步骤 5: 展示历史列表
    const historyPanel = page.locator('.prompt-list-panel').or(
      page.locator('[class*="prompt-history"]')
    );
    
    if (await historyPanel.isVisible().catch(() => false)) {
      await showKeyHint(page, '历史记录与预设', 1500);
      await page.waitForTimeout(1000);
      
      // 步骤 6: 滚动浏览
      await showKeyHint(page, '滚动浏览提示词', 1000);
      await historyPanel.evaluate(el => {
        el.scrollBy({ top: 60, behavior: 'smooth' });
      });
      await page.waitForTimeout(1000);
      
      // 步骤 7: 置顶操作
      await showKeyHint(page, '置顶常用提示词', 1000);
      const pinBtn = historyPanel.locator('.pin-btn').or(
        historyPanel.locator('button').filter({ hasText: /置顶|📌/ })
      ).first();
      
      if (await pinBtn.isVisible().catch(() => false)) {
        await clickWithEffect(page, pinBtn, '置顶', 1000);
        await page.waitForTimeout(800);
      }
      
      // 步骤 8: 选择提示词
      await showKeyHint(page, '点击使用提示词', 1000);
      const promptItem = historyPanel.locator('.prompt-item').or(
        historyPanel.locator('[class*="prompt"]')
      ).first();
      
      if (await promptItem.isVisible().catch(() => false)) {
        await clickWithEffect(page, promptItem, '使用提示词', 1500);
      }
    }
    
    // 步骤 9: 展示输入框填充效果
    await showKeyHint(page, '提示词自动填充', 1500);
    await page.waitForTimeout(1000);
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('灵感面板演示', async ({ page }) => {
    // 灵感面板：空画布时显示 → 分类展示 → 选择灵感 → 自动填充
    
    // 步骤 1: 页面加载等待（确保画布为空）
    await page.waitForTimeout(1500);
    
    // 步骤 2: 展示灵感面板
    await showKeyHint(page, '灵感提示面板', 1500);
    const inspirationBoard = page.locator('.inspiration-board').or(
      page.locator('[class*="inspiration"]')
    );
    
    if (await inspirationBoard.isVisible().catch(() => false)) {
      // 步骤 3: 展示灵感卡片
      await showKeyHint(page, '创作灵感推荐', 1500);
      await page.waitForTimeout(1000);
      
      // 步骤 4: 滚动浏览灵感
      await showKeyHint(page, '浏览更多灵感', 1000);
      await inspirationBoard.evaluate(el => {
        el.scrollBy({ left: 200, behavior: 'smooth' });
      });
      await page.waitForTimeout(1000);
      
      // 步骤 5: 展示不同分类
      await showKeyHint(page, '不同主题分类', 1500);
      await inspirationBoard.evaluate(el => {
        el.scrollBy({ left: 200, behavior: 'smooth' });
      });
      await page.waitForTimeout(1000);
      
      // 步骤 6: 选择灵感卡片
      await showKeyHint(page, '选择灵感开始创作', 1000);
      const card = inspirationBoard.locator('.inspiration-card').or(
        inspirationBoard.locator('[class*="card"]')
      ).first();
      
      if (await card.isVisible().catch(() => false)) {
        await clickWithEffect(page, card, '选择灵感', 1500);
      }
      
      // 步骤 7: 展示自动填充
      await showKeyHint(page, '提示词自动填充', 1500);
      const aiInputBar = page.getByTestId('ai-input-bar');
      await page.waitForTimeout(1000);
      
      // 步骤 8: 打开提示词工具（如果有）
      const promptToolBtn = inspirationBoard.locator('button').filter({ 
        hasText: /提示词工具|Prompt/ 
      }).first();
      
      if (await promptToolBtn.isVisible().catch(() => false)) {
        await showKeyHint(page, '提示词工具入口', 1000);
        await clickWithEffect(page, promptToolBtn, '打开工具', 1000);
      }
    } else {
      // 如果画布不为空，显示提示
      await showKeyHint(page, '（需要空画布）', 1500);
    }
    
    // 最终等待
    await page.waitForTimeout(2000);
  });

  test('AI 工作流演示', async ({ page }) => {
    // AI 工作流完整演示：输入 → 配置 → 发送 → ChatDrawer 打开 → 工作流执行 → 结果展示
    
    // 步骤 1: 页面加载等待
    await page.waitForTimeout(1500);
    
    // 步骤 2: 定位 AI 输入栏
    const aiInputBar = page.getByTestId('ai-input-bar');
    
    // 步骤 3: 输入提示词
    await showKeyHint(page, 'AI 生成工作流', 1500);
    const inputField = aiInputBar.locator('input[type="text"]').or(
      aiInputBar.locator('textarea')
    ).first();
    
    if (await inputField.isVisible().catch(() => false)) {
      await clickWithEffect(page, inputField, '输入', 1000);
      await showKeyHint(page, '输入生成请求', 1000);
      await page.keyboard.type('生成一只可爱的猫咪', { delay: 80 });
      await page.waitForTimeout(1000);
    }
    
    // 步骤 4: 快速配置参数
    await showKeyHint(page, '配置生成参数', 1000);
    const modelDropdown = aiInputBar.locator('.model-dropdown__trigger').first();
    if (await modelDropdown.isVisible().catch(() => false)) {
      // 只展示配置入口，不实际打开
      const box = await modelDropdown.boundingBox();
      if (box) {
        await showClickEffect(page, box.x + box.width / 2, box.y + box.height / 2, '模型');
        await page.waitForTimeout(800);
      }
    }
    
    // 步骤 5: 发送请求
    await showKeyHint(page, '发送生成请求', 1500);
    const sendBtn = aiInputBar.locator('.ai-input-bar__send-btn').or(
      aiInputBar.locator('button[type="submit"]')
    ).first();
    
    if (await sendBtn.isVisible().catch(() => false)) {
      await clickWithEffect(page, sendBtn, '发送', 1500);
    }
    
    // 步骤 6: 自动打开 ChatDrawer
    await showKeyHint(page, '对话抽屉自动打开', 1500);
    await page.waitForTimeout(1000);
    
    const chatDrawer = page.getByTestId('chat-drawer').or(
      page.locator('.chat-drawer')
    );
    
    // 等待抽屉打开（最多 3 秒）
    try {
      await chatDrawer.waitFor({ state: 'visible', timeout: 3000 });
    } catch (e) {
      // 如果没有自动打开，手动打开
      const chatTrigger = page.locator('.chat-drawer-trigger').first();
      if (await chatTrigger.isVisible().catch(() => false)) {
        await clickWithEffect(page, chatTrigger, '打开抽屉', 1000);
      }
    }
    
    // 步骤 7: 展示工作流执行
    if (await chatDrawer.isVisible().catch(() => false)) {
      await showKeyHint(page, '工作流执行中', 2000);
      await page.waitForTimeout(1500);
      
      // 步骤 8: 展示消息气泡
      await showKeyHint(page, '实时状态更新', 1500);
      const messageBubble = chatDrawer.locator('.message-bubble').or(
        chatDrawer.locator('[class*="message"]')
      ).first();
      await page.waitForTimeout(1000);
      
      // 步骤 9: 展示工作流步骤（如果可见）
      await showKeyHint(page, '工作流步骤展示', 1500);
      const workflowSteps = chatDrawer.locator('.workflow-steps').or(
        chatDrawer.locator('[class*="workflow"]')
      );
      await page.waitForTimeout(1000);
      
      // 步骤 10: 关闭抽屉
      await showKeyHint(page, '查看完整历史', 1000);
      await page.waitForTimeout(1000);
    }
    
    // 最终等待
    await page.waitForTimeout(2000);
  });
});
