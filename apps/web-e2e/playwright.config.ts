import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';

import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:7200';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  
  /* 测试超时设置 */
  timeout: 60000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
    },
  },
  
  /* 测试报告设置 */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  
  /* 截图和视频设置 */
  outputDir: 'test-results',
  
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* 失败时截图 */
    screenshot: 'only-on-failure',
    /* 视频录制 */
    video: 'retain-on-failure',
  },
  
  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'pnpm start:api',
      url: 'http://127.0.0.1:3101/api/session-status',
      reuseExistingServer: !process.env.CI,
      cwd: workspaceRoot,
      timeout: 120000,
    },
    {
      command: 'pnpm start:web',
      url: 'http://localhost:7200',
      reuseExistingServer: !process.env.CI,
      cwd: workspaceRoot,
      timeout: 120000,
    },
  ],
  
  projects: [
    // 冒烟测试 - 仅 Chromium，快速运行
    {
      name: 'smoke',
      testMatch: '**/smoke/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    
    // 视觉回归测试 - 仅 Chromium
    {
      name: 'visual',
      testMatch: '**/visual/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    
    // 功能测试 - 多浏览器
    {
      name: 'chromium',
      testMatch: '**/features/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      testMatch: '**/features/**/*.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      testMatch: '**/features/**/*.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
    
    // 手册截图生成测试 - 仅 Chromium，排除 GIF 录制测试
    {
      name: 'manual',
      testMatch: '**/manual-gen/**/*.spec.ts',
      testIgnore: '**/manual-gen/gif-*.spec.ts',  // 排除 GIF 录制测试
      use: { ...devices['Desktop Chrome'] },
    },
    
    // 手册 GIF 视频录制 - 需要视频录制功能
    {
      name: 'manual-video',
      testMatch: '**/manual-gen/gif-*.spec.ts',  // 只匹配 GIF 录制测试
      use: { 
        ...devices['Desktop Chrome'],
        video: 'on',
        viewport: { width: 1280, height: 720 },
      },
    },

    // 响应式测试 - 多视口尺寸
    {
      name: 'responsive',
      testMatch: '**/visual/responsive-visual.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    
    // 移动端浏览器测试
    {
      name: 'mobile-chrome',
      testMatch: '**/visual/responsive-visual.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      testMatch: '**/visual/responsive-visual.spec.ts',
      use: { ...devices['iPhone 12'] },
    },
    
    // 平板测试
    {
      name: 'tablet',
      testMatch: '**/visual/responsive-visual.spec.ts',
      use: { ...devices['iPad Pro 11'] },
    },

    // Uncomment for branded browsers
    /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    }, */
  ],
});
