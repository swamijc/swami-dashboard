import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByPlaceholder('admin').fill('admin');
  await page.locator('input[type="password"]').fill('Admin@1234!');
  await Promise.all([
    page.waitForURL('**/', { waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name: 'Sign In' }).click()
  ]);
  await expect(page.getByRole('heading', { name: /^Portfolio Dashboard$/ })).toBeVisible();
}

async function login(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('admin').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: /^Portfolio Dashboard$/ })).toBeVisible();
}

test('anonymous users are redirected to login for protected pages', async ({ page }) => {
  await page.goto('/quality');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: "Swami's Portfolio Dashboard" })).toBeVisible();

  await page.goto('/release');
  await expect(page).toHaveURL(/\/login$/);
});

test('admin can login and view the code quality dashboard', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/quality');
  await expect(page.getByRole('heading', { name: 'Code Quality Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dependency Audit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pen Test Baseline' })).toBeVisible();

  await page.goto('/release');
  await expect(page.getByRole('heading', { name: 'Release Tracking' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Environment Promotion' })).toBeVisible();
  await expect(page.getByText('Release Version Number')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Environment Test URLs' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open DEV' }).first()).toHaveAttribute('href', /localhost:5173|http/);
  await expect(page.getByText('QA URL not configured')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Environment Push Details' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve Move to QA|Approving QA/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve Move to PROD|Approving PROD/ })).toBeVisible();
});

test('viewer can open Jira Onboarding and Quality in read-only mode', async ({ page }) => {
  await loginAsAdmin(page);
  const username = `viewer-${Date.now()}`;
  await page.request.post('/api/admin/users', {
    data: {
      username,
      email: `${username}@dashboard.local`,
      password: 'Viewer@1234!',
      role: 'viewer'
    }
  });
  await page.getByRole('button', { name: /Sign out/ }).click();

  await login(page, username, 'Viewer@1234!');
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: /JIRA/ })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: /Onboarding/ })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: /Quality/ })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: /Release/ })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: /Admin/ })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: /Timesheet/ })).toHaveCount(0);

  await page.goto('/quality');
  await expect(page.getByRole('heading', { name: 'Code Quality Dashboard' })).toBeVisible();

  await page.goto('/jira');
  await expect(page.getByRole('heading', { name: 'JIRA Query' })).toBeVisible();
  await expect(page.locator('textarea')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Execute' })).toHaveCount(0);

  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: 'Onboarding', exact: true })).toBeVisible();
  await expect(page.getByText('Viewer access shows workflow status only.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to workflow' })).toHaveCount(0);

  await page.goto('/release');
  await expect(page.getByRole('heading', { name: 'Release Tracking' })).toBeVisible();
  const releasePage = page.locator('body');
  await expect(releasePage.getByRole('heading', { name: 'DEV' }).first()).toBeVisible();
  await expect(releasePage.getByRole('heading', { name: 'QA' }).first()).toBeVisible();
  await expect(releasePage.getByRole('heading', { name: 'PROD' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Environment Test URLs' })).toBeVisible();
  await expect(page.getByText('QA URL not configured')).toBeVisible();
  await expect(page.getByText('PROD URL not configured')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Environment Push Details' })).toBeVisible();
  await expect(page.getByText('View-only access')).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve Move to QA|Approving QA/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Approve Move to PROD|Approving PROD/ })).toHaveCount(0);
});

test('login and quality pages have no critical accessibility violations', async ({ page }) => {
  await page.goto('/login');
  const loginResults = await new AxeBuilder({ page }).analyze();
  expect(loginResults.violations.filter(violation => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([]);

  await loginAsAdmin(page);
  await page.goto('/quality');
  await expect(page.getByRole('heading', { name: 'Code Quality Dashboard' })).toBeVisible();
  const qualityResults = await new AxeBuilder({ page }).analyze();
  expect(qualityResults.violations.filter(violation => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([]);
});