import { test, expect } from '@playwright/test';

for (const width of [390, 768, 769, 900, 1024, 1025, 1440]) {
  test(`download and community entries remain accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: '下载兔子助手', exact: true });
    const trigger = page.getByTestId('toolbar-resources');
    await expect(trigger).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '确认下载' })).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(trigger).toBeVisible();
    await expect(dialog).toHaveCount(0);

    if (width <= 1024) {
      await page.getByRole('button', { name: '展开工具栏', exact: true }).click();
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }

    await page.getByTestId('toolbar-feedback').click();
    const community = page.locator('.feedback-qrcode-content');
    await expect(community.getByAltText('用户反馈群二维码')).toBeVisible();
    const follow = community.getByRole('link', { name: /关注 @shuidiyuAI/ });
    await expect(follow).toBeVisible();
    await expect(follow).toHaveAttribute('href', 'https://x.com/shuidiyuAI');
    const bounds = await community.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  });
}
