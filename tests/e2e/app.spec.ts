import { test, expect } from '@playwright/test';

test('loads, renders the science sample, and changes output modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your notes, beautifully translated.' })).toBeVisible();
  await expect(page.locator('.status-pill')).not.toContainText('Rendering', { timeout: 30_000 });
  await expect(page.locator('.document-preview mjx-container > svg')).toHaveCount(4);
  await expect(page.locator('.document-preview')).toContainText('The pathway: Ras → p120RasGAP → c-Src');
  await expect(page.locator('.document-preview')).not.toContainText('');
  await page.getByRole('button', { name: 'Plain text', exact: true }).click();
  await expect(page.locator('.plain-preview')).toContainText('বাংলায় নোট');
});

test('disables single-dollar math but keeps bracket equations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status-pill')).not.toContainText('Rendering', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Document' }).click();
  await page.getByText('Recognize $…$ math').click();
  await expect(page.locator('.document-preview')).toContainText('$\\rightarrow$');
});
