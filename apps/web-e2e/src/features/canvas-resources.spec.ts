import { test, expect } from '@playwright/test';

for (const width of [390, 768, 769, 900, 1024, 1025, 1440]) {
  test(`resources entry remains accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const panel = page.getByTestId('canvas-resources');
    const trigger = page.getByTestId('toolbar-resources');
    await expect(panel).toBeVisible();
    // The automatic display is recorded immediately, even before the user
    // closes it, so a reload cannot show the same release announcement again.
    await page.reload();
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: '关闭 OpenTu 资源' }).click();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: '关闭 OpenTu 资源' }).click();
    await page.reload();
    await expect(trigger).toBeVisible();
    await expect(panel).toHaveCount(0);

    if (width <= 1024) {
      await page.getByRole('button', { name: '展开工具栏', exact: true }).click();
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(panel).toBeVisible();
    }
  });
}
