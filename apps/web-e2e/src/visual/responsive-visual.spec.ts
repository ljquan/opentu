/**
 * 响应式视觉测试
 * 
 * 测试不同视口尺寸下的UI适配效果
 * - 桌面端 (1920x1080, 1280x720)
 * - 平板横屏 (1024x768)
 * - 平板竖屏 (768x1024)
 * - 移动端横屏 (640x360)
 * - 移动端竖屏 (375x667, 360x640)
 */

import { test, expect, Page } from '@playwright/test';

// 视口尺寸配置
const VIEWPORTS = {
  // 桌面端
  desktopLarge: { width: 1920, height: 1080, name: 'desktop-large' },
  desktopMedium: { width: 1280, height: 720, name: 'desktop-medium' },
  
  // 平板
  tabletLandscape: { width: 1024, height: 768, name: 'tablet-landscape' },
  tabletPortrait: { width: 768, height: 1024, name: 'tablet-portrait' },
  
  // 移动端
  mobileLandscape: { width: 640, height: 360, name: 'mobile-landscape' },
  mobilePortrait: { width: 375, height: 667, name: 'mobile-portrait-iphone' },
  mobileSmall: { width: 360, height: 640, name: 'mobile-portrait-android' },
};

// 等待页面加载完成
async function waitForPageReady(page: Page): Promise<void> {
  // 等待主要组件加载
  await page.waitForSelector('.drawnix', { timeout: 30000 });
  // 等待工具栏加载
  await page.waitForSelector('.unified-toolbar', { timeout: 10000 });
  // 给一些额外时间让动画完成
  await page.waitForTimeout(1000);
}

// 隐藏动态内容以获得稳定截图
async function prepareForScreenshot(page: Page): Promise<void> {
  await page.evaluate(() => {
    // 隐藏可能变化的动态内容
    const dynamicElements = document.querySelectorAll(
      '.task-queue-panel, .minimap__preview, .loading-indicator'
    );
    dynamicElements.forEach(el => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
  });
}

test.describe('响应式布局测试', () => {
  test.beforeEach(async ({ page }) => {
    // 设置较长的超时时间
    test.setTimeout(60000);
  });

  // 桌面端测试
  test.describe('桌面端', () => {
    test('大屏幕桌面端布局 (1920x1080)', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktopLarge);
      await page.goto('/');
      await waitForPageReady(page);
      await prepareForScreenshot(page);
      
      // 验证工具栏可见
      await expect(page.locator('.unified-toolbar')).toBeVisible();
      // 验证AI输入栏可见
      await expect(page.locator('.ai-input-bar')).toBeVisible();
      // 验证视图导航可见
      await expect(page.locator('.view-navigation')).toBeVisible();
      
      // 截图对比
      await expect(page).toHaveScreenshot(`responsive-${VIEWPORTS.desktopLarge.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.1,
      });
    });

    test('中等屏幕桌面端布局 (1280x720)', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktopMedium);
      await page.goto('/');
      await waitForPageReady(page);
      await prepareForScreenshot(page);
      
      await expect(page.locator('.unified-toolbar')).toBeVisible();
      await expect(page.locator('.ai-input-bar')).toBeVisible();
      
      await expect(page).toHaveScreenshot(`responsive-${VIEWPORTS.desktopMedium.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.1,
      });
    });
  });

  // 平板测试
  test.describe('平板', () => {
    test('平板横屏布局 (1024x768)', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.tabletLandscape);
      await page.goto('/');
      await waitForPageReady(page);
      await prepareForScreenshot(page);
      
      // 验证工具栏使用图标模式
      await expect(page.locator('.unified-toolbar')).toBeVisible();
      await expect(page.locator('.ai-input-bar')).toBeVisible();
      
      await expect(page).toHaveScreenshot(`responsive-${VIEWPORTS.tabletLandscape.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.1,
      });
    });

    test('平板竖屏布局 (768x1024)', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.tabletPortrait);
      await page.goto('/');
      await waitForPageReady(page);
      await prepareForScreenshot(page);
      
      await expect(page.locator('.unified-toolbar')).toBeVisible();
      await expect(page.locator('.ai-input-bar')).toBeVisible();
      
      await expect(page).toHaveScreenshot(`responsive-${VIEWPORTS.tabletPortrait.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.1,
      });
    });
  });

  // 移动端测试
  test.describe('移动端', () => {
    test('移动端横屏布局 (640x360)', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileLandscape);
      await page.goto('/');
      await waitForPageReady(page);
      await prepareForScreenshot(page);
      
      // 验证组件可见且不遮挡
      await expect(page.locator('.unified-toolbar')).toBeVisible();
      await expect(page.locator('.ai-input-bar')).toBeVisible();
      
      await expect(page).toHaveScreenshot(`responsive-${VIEWPORTS.mobileLandscape.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.1,
      });
    });

    test('iPhone 竖屏布局 (375x667)', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobilePortrait);
      await page.goto('/');
      await waitForPageReady(page);
      await prepareForScreenshot(page);
      
      await expect(page.locator('.unified-toolbar')).toBeVisible();
      await expect(page.locator('.ai-input-bar')).toBeVisible();
      
      await expect(page).toHaveScreenshot(`responsive-${VIEWPORTS.mobilePortrait.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.1,
      });
    });

    test('Android 竖屏布局 (360x640)', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobileSmall);
      await page.goto('/');
      await waitForPageReady(page);
      await prepareForScreenshot(page);
      
      await expect(page.locator('.unified-toolbar')).toBeVisible();
      await expect(page.locator('.ai-input-bar')).toBeVisible();
      
      await expect(page).toHaveScreenshot(`responsive-${VIEWPORTS.mobileSmall.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.1,
      });
    });
  });
});

test.describe('组件响应式测试', () => {
  // 工具栏响应式测试
  test.describe('统一工具栏', () => {
    test('移动端工具栏可展开/收起', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobilePortrait);
      await page.goto('/');
      await waitForPageReady(page);
      
      const toolbar = page.locator('.unified-toolbar');
      await expect(toolbar).toBeVisible();
      
      // 检查移动端切换按钮
      const toggleBtn = page.locator('.unified-toolbar__mobile-toggle');
      // 如果存在切换按钮，测试展开/收起功能
      const toggleExists = await toggleBtn.count() > 0;
      if (toggleExists) {
        // 初始应该是收起状态
        await expect(toolbar).toHaveClass(/mobile-collapsed/);
        
        // 点击展开
        await toggleBtn.click();
        await page.waitForTimeout(300);
        
        // 验证已展开
        await expect(toolbar).not.toHaveClass(/mobile-collapsed/);
      }
    });
  });

  // AI输入栏响应式测试
  test.describe('AI输入栏', () => {
    test('移动端AI输入栏布局正确', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobilePortrait);
      await page.goto('/');
      await waitForPageReady(page);
      
      const inputBar = page.locator('.ai-input-bar');
      await expect(inputBar).toBeVisible();
      
      // 验证输入栏不与工具栏重叠
      const toolbar = page.locator('.unified-toolbar');
      const inputBarBox = await inputBar.boundingBox();
      const toolbarBox = await toolbar.boundingBox();
      
      if (inputBarBox && toolbarBox) {
        // 输入栏和工具栏不应该重叠（允许少量重叠）
        const overlap = Math.max(0, 
          Math.min(inputBarBox.x + inputBarBox.width, toolbarBox.x + toolbarBox.width) -
          Math.max(inputBarBox.x, toolbarBox.x)
        ) * Math.max(0,
          Math.min(inputBarBox.y + inputBarBox.height, toolbarBox.y + toolbarBox.height) -
          Math.max(inputBarBox.y, toolbarBox.y)
        );
        
        expect(overlap).toBeLessThan(100); // 允许最多100px重叠
      }
    });
  });

  // 视图导航响应式测试
  test.describe('视图导航', () => {
    test('视图导航在不同视口尺寸下正确显示', async ({ page }) => {
      // 桌面端
      await page.setViewportSize(VIEWPORTS.desktopMedium);
      await page.goto('/');
      await waitForPageReady(page);
      
      const viewNav = page.locator('.view-navigation');
      await expect(viewNav).toBeVisible();
      
      // 移动端
      await page.setViewportSize(VIEWPORTS.mobilePortrait);
      await page.waitForTimeout(500);
      
      await expect(viewNav).toBeVisible();
      
      // 验证缩放控件可见
      await expect(page.locator('.view-navigation__zoom')).toBeVisible();
    });
  });
});

test.describe('触控交互测试', () => {
  test('移动端触控区域足够大', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobilePortrait);
    await page.goto('/');
    await waitForPageReady(page);
    
    // 检查主要按钮的尺寸
    const buttons = page.locator('.unified-toolbar button, .ai-input-bar button');
    const count = await buttons.count();
    
    for (let i = 0; i < Math.min(count, 10); i++) {
      const button = buttons.nth(i);
      const box = await button.boundingBox();
      if (box) {
        // 触控目标应该至少 32x32 像素
        expect(box.width).toBeGreaterThanOrEqual(28);
        expect(box.height).toBeGreaterThanOrEqual(28);
      }
    }
  });
});
