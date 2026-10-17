const { chromium, expect } = require('@playwright/test');
const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { Client } = require('pg');

async function main() {
  const email = `browser-smoke-${randomUUID()}@example.invalid`;
  const password = randomBytes(20).toString('hex');
  const replacement = randomBytes(20).toString('hex');
  const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:7200').replace(/\/+$/, '');
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  fs.mkdirSync('dist/account-checks', { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') failures.push(message.text());
    });
    await page.goto(`${baseUrl}/account?next=%2Faccount`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '切换到注册', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换到注册', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('名称', { exact: true }).fill('Browser Smoke');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    const focusCheck = page.waitForResponse(response => response.url().endsWith('/api/session-status'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await focusCheck;
    await expect(page.getByLabel('密码', { exact: true })).toHaveValue(password);
    await page.getByLabel('确认密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('我的账户', { timeout: 30000 });
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.locator('h1')).toHaveText('登录', { timeout: 30000 });
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('我的账户', { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toHaveText('我的账户', { timeout: 30000 });
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await page.getByLabel('新密码', { exact: true }).fill(replacement);
    await page.getByLabel('确认密码', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('密码已更新');
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.locator('h1')).toHaveText('登录', { timeout: 30000 });
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('我的账户', { timeout: 30000 });
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.locator('h1')).toHaveText('登录', { timeout: 30000 });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['small-mobile', 320, 568]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.locator('.account-brand img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      if (!fits) throw new Error(`${name}: horizontal overflow`);
      await page.screenshot({ path: `dist/account-checks/${name}.png`, fullPage: true });
    }
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('PASS: browser registration, persisted session, password change, logout, new-password login and responsive screenshots. No provider called.');
  } finally {
    await browser.close();
    if (!process.env.POSTGRES_URL) {
      throw new Error('POSTGRES_URL is required to clean up the browser smoke account');
    }
    const client = new Client({ connectionString: process.env.POSTGRES_URL });
    await client.connect();
    try {
      // The generated UUID email is the sole cleanup target; no real accounts are touched.
      await client.query('DELETE FROM opentu_auth_user WHERE email = $1', [email]);
    } finally {
      await client.end();
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
