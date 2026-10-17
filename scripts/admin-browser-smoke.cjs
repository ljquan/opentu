const { chromium, expect } = require('@playwright/test');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client } = require('pg');

async function main() {
  const email = `admin-browser-${randomUUID()}@example.invalid`;
  const password = randomBytes(20).toString('hex');
  const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:7200').replace(/\/+$/, '');
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL is required');
  const db = new Client({ connectionString: databaseUrl });
  let databaseConnected = false;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/admin/providers`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/account\?next=%2Fadmin%2Fproviders$/);
    await page.getByRole('button', { name: '切换到注册', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('Admin Browser Smoke');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByLabel('确认密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('没有管理权限', { timeout: 30000 });
    await page.goto(`${baseUrl}/account?next=%2Fadmin%2Fproviders`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toHaveText('我的账户', { timeout: 30000 });

    await db.connect();
    databaseConnected = true;
    await db.query('UPDATE opentu_auth_user SET "appRole" = 5 WHERE email = $1', [email]);
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.locator('h1')).toHaveText('登录', { timeout: 30000 });
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '模型服务管理' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: '新增供应商' }).click();
    await page.getByLabel('显示名称', { exact: true }).fill('Smoke Provider');
    await page.getByLabel('Base URL', { exact: true }).fill('https://provider.invalid/v1');
    await page.getByLabel(/API Key/).fill('smoke-provider-secret');
    await page.getByRole('button', { name: '保存配置' }).click();
    await expect(page.getByRole('button', { name: /Smoke Provider/ })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('服务端托管')).toBeVisible();
    console.log('PASS: anonymous admin redirect, ordinary users are gated by role, admin provider save path works. No provider request was made.');
  } finally {
    await browser.close();
    if (!databaseConnected) await db.connect();
    await db.query('DELETE FROM opentu_provider_profiles WHERE name = $1', ['Smoke Provider']);
    await db.query('DELETE FROM opentu_auth_user WHERE email = $1', [email]);
    await db.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
