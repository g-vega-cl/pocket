import { test, expect } from '@playwright/test';

test('has start local session button', async ({ page }) => {
  await page.goto('http://localhost:3000/pocket');
  const localBtn = page.getByRole('button', { name: /Start Local Session/i });
  await expect(localBtn).toBeVisible();
});

test('starts local session and shows chat', async ({ page }) => {
  await page.goto('http://localhost:3000/pocket');
  await page.fill('textarea[placeholder*="Fix the login bug"]', 'Test local task');
  await page.click('button:has-text("Start Local Session")');

  await expect(page.getByText(/Local session ready/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Type your message/i)).toBeVisible();
});
