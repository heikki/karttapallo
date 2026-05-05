import { expect, test } from '@playwright/test';

test('GET /api/items returns the seeded fixture', async ({ request }) => {
  const res = await request.get('/api/items');
  expect(res.ok()).toBe(true);
  const items = (await res.json()) as Array<{ uuid: string }>;
  expect(items.length).toBeGreaterThan(0);
  expect(items.some((i) => i.uuid === 'e2e-fixture-1')).toBe(true);
});

test('page loads and mounts <app-root>', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-root')).toBeAttached();
});
