import { test, expect } from '@playwright/test';

// No real API key or generation request: exercise the actual startup and selector
// against a controlled provider model-list response.
test('an app upgrade fetches models once and adds the new model without changing selections', async ({
  page,
}) => {
  let requests = 0;
  await page.route(
    'https://model-refresh.example.test/v1/models',
    async (route) => {
      requests += 1;
      await route.fulfill({
        json: {
          data: [
            { id: 'gpt-image-2' },
            { id: 'gpt-image-2.5' },
            { id: 'gpt-image-2.6-1k' },
          ],
        },
      });
    }
  );
  // Only the fake provider may receive discovery; never make a paid request.
  await page.route('**/images/generations**', (route) => route.abort());
  await page.addInitScript(() => {
    if (localStorage.getItem('version-model-refresh-seeded')) return;
    localStorage.setItem('version-model-refresh-seeded', 'true');
    localStorage.setItem('opentu-canvas-resources-2026-10-seen', 'true');
    const models = ['gpt-image-2', 'gpt-image-2.5'].map((id) => ({
      id,
      label: id,
      shortLabel: id,
      shortCode: id,
      type: 'image',
      vendor: 'GPT',
      tags: ['runtime'],
    }));
    localStorage.setItem(
      'drawnix_settings',
      JSON.stringify({
        gemini: {
          apiKey: '',
          baseUrl: 'https://model-refresh.example.test/v1',
          imageModelName: 'gpt-image-2.5',
        },
        providerProfiles: [
          {
            id: 'upgrade-test',
            name: 'Upgrade test',
            baseUrl: 'https://model-refresh.example.test/v1',
            apiKey: 'test-only-key',
            providerType: 'openai-compatible',
            authType: 'bearer',
            enabled: true,
            capabilities: {
              supportsModelsEndpoint: true,
              supportsImage: true,
              supportsText: true,
              supportsVideo: true,
              supportsAudio: true,
              supportsTools: true,
            },
          },
        ],
        providerCatalogs: [
          {
            profileId: 'upgrade-test',
            lastAutoRefreshVersion: '0.0.1',
            discoveredAt: 1,
            discoveredModels: models,
            selectedModelIds: ['gpt-image-2.5'],
          },
        ],
      })
    );
    localStorage.setItem(
      'ai_model_selection_cache',
      JSON.stringify({
        image: {
          modelId: 'gpt-image-2.5',
          modelRef: { profileId: 'upgrade-test', modelId: 'gpt-image-2.5' },
          providerIdHint: 'upgrade-test',
        },
      })
    );
  });
  await page.goto('/');
  const catalog = () =>
    page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('drawnix_settings') || '{}'
      ).providerCatalogs?.find(
        (item: { profileId: string }) => item.profileId === 'upgrade-test'
      )
    );
  await expect
    .poll(async () => (await catalog())?.selectedModelIds)
    .toEqual(['gpt-image-2.5', 'gpt-image-2.6-1k']);
  const version = (await catalog()).lastAutoRefreshVersion;
  expect(version).toBeTruthy();
  expect(version).not.toBe('0.0.1');
  expect(requests).toBe(1);
  await expect(page.getByTestId('model-selector').first()).toContainText(
    /2\.5|gpt25/i
  );
  await page.getByTestId('model-selector').first().click();
  await expect(
    page.getByRole('option').filter({ hasText: 'gpt-image-2.6-1k' }).first()
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByTestId('model-selector').first()).toBeVisible();
  // Allow the delayed startup to finish; the persisted version must suppress HTTP.
  await page.waitForTimeout(1800);
  expect(requests).toBe(1);
  expect((await catalog()).lastAutoRefreshVersion).toBe(version);
  expect((await catalog()).selectedModelIds).toEqual([
    'gpt-image-2.5',
    'gpt-image-2.6-1k',
  ]);
});
