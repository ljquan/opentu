import { expect, test } from '@playwright/test';

test.describe('FoxVue product navigation', () => {
  test('connects the public product routes and interactive controls', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今天，想做点什么？' })).toBeVisible({ timeout: 30000 });

    const search = page.getByRole('textbox', {
      name: '搜索模板、作品和工作流',
    });
    await search.fill('模型');
    await search.press('Enter');
    await expect(page.getByRole('dialog', { name: '模型广场' })).toBeVisible();
    await page.getByRole('button', { name: '关闭模型广场' }).click();

    await page.goto('/creative-center');
    await page.getByRole('button', { name: '模型广场' }).click();
    await expect(page).toHaveURL(/\/#models$/);
    await expect(page.getByRole('dialog', { name: '模型广场' })).toBeVisible();
    await page.getByRole('button', { name: '关闭模型广场' }).click();

    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '我的作品' })
      .click();
    await expect(page).toHaveURL(/\/works$/);
    await expect(page.getByRole('heading', { name: '我的作品' })).toBeVisible();
    await page.getByRole('tab', { name: '图片' }).click();
    await expect(page.getByRole('tab', { name: '图片' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await page.goto('/workflows');
    await page.getByRole('button', { name: '使用工作流' }).first().click();
    await expect(page).toHaveURL(/\/creative-center$/);
    await expect(page.getByRole('textbox', { name: '描述你的创意' })).toHaveValue(
      '从一句方向开始，整理参考图、色彩和三组视觉方案。'
    );
    await page.getByRole('combobox', { name: '画面比例' }).selectOption('16:9');
    await page.getByRole('combobox', { name: '生成清晰度' }).selectOption('standard');
    await expect(page.getByRole('combobox', { name: '画面比例' })).toHaveValue('16:9');
    await page.getByRole('button', { name: /帮助与反馈/ }).click();
    await expect(page).toHaveURL(/\/user-manual\/index\.html$/);
    await expect(
      page.getByRole('heading', { name: '欢迎使用 Opentu（开图）' })
    ).toBeVisible();

    await page.goto('/music-station');
    await page.getByRole('button', { name: '精选歌单' }).click();
    await expect(page.getByRole('status')).toContainText('精选歌单暂未开放');
    await expect(page.getByRole('heading', { name: '我的作品' }).first()).toBeVisible();
    await page.getByRole('navigation', { name: '音乐台导航' }).getByRole('button', { name: '音乐台' }).click();
    const playButton = page.getByRole('button', { name: '播放', exact: true });
    if (await playButton.isVisible()) {
      await expect(playButton).toBeDisabled();
    }
    await page.getByRole('button', { name: '播放器设置' }).click();
    await expect(page.getByRole('slider', { name: '播放器音量' })).toBeVisible();
    await page.getByRole('button', { name: '账户设置' }).click();
    await expect(page).toHaveURL(/\/account\?next=%2Fmusic-station$/);
    await expect(page.getByRole('button', { name: '切换到注册' })).toBeVisible();
    await page.getByRole('button', { name: '切换到注册' }).click();
    await expect(page.getByRole('heading', { name: '创建账户' })).toBeVisible();
    await page.getByRole('button', { name: '切换到登录' }).click();
    await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('creates a canvas and connects workspace navigation', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/creative-center');
    await page.getByRole('tab', { name: '画布' }).click();
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page).toHaveURL(/\?board=/, { timeout: 30000 });
    await expect(page.getByRole('complementary', { name: '工作区导航' })).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole('button', { name: /创作空间/ }).first().click();
    await expect(page.getByRole('dialog', { name: '项目切换器' })).toBeVisible();
    await page.getByRole('button', { name: /创作空间/, expanded: true }).click();

    await page
      .getByRole('complementary', { name: '工作区导航' })
      .getByRole('button', { name: '我的 Workflow' })
      .click();
    await expect(page).toHaveURL(/\/workflows$/);
    await expect(page.getByRole('heading', { name: '工作流', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
