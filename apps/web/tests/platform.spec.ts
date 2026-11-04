import { test, expect } from '@playwright/test';
const email = process.env.TEST_ADMIN_EMAIL;
const password = process.env.TEST_ADMIN_PASSWORD;
test('anonymous users are sent to the login screen', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
test('sign-in form validates malformed email without a request', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('invalid');
  await page.getByLabel('Password').fill('invalid');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
});
test.describe('authenticated workflow', () => {
  test.skip(
    !email || !password,
    'Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD for a seeded local administrator.',
  );
  test.beforeEach(async ({ page }) => {
    if (!email || !password) throw new Error('Missing E2E credentials');
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
  test('creates a manual proposal and produces a reviewable developer package', async ({
    page,
  }) => {
    const suffix = Date.now().toString();
    const name = `E2E schema ${suffix}`;
    await page.getByRole('link', { name: 'Schema proposals', exact: true }).click();
    await page.getByRole('button', { name: 'New proposal', exact: true }).click();
    await page.getByLabel('Proposal name').fill(name);
    await page.getByLabel('Destination table').fill(`e2e_${suffix}`);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(
      page.getByText('Proposal saved. Review the contract before approving.'),
    ).toBeVisible();
    await page.getByRole('button', { name: /Approve saved version/ }).click();
    await expect(
      page.getByText(
        'Approved. No database tables have been created. Generate the developer handoff next.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Generate developer handoff', exact: true }).click();
    await expect(page.getByText(/Developer handoff generated/)).toBeVisible();
    await page.getByRole('link', { name: 'Developer handoffs', exact: true }).click();
    await expect(page.getByText(/These artifacts are proposed/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download package' })).toBeVisible();
    await expect(page.getByText('Choose one migration approach')).toBeVisible();
  });
  test('settings do not expose saved secret values', async ({ page }) => {
    await page.goto('/admin/settings/bedrock');
    await expect(page.getByRole('heading', { name: 'Amazon Bedrock connection' })).toBeVisible();
    await page.getByLabel('Authentication mode').selectOption('explicit');
    await expect(page.getByLabel('Secret access key', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Access key ID', { exact: true })).toHaveValue('');
  });
  test('users page manages roles and the relationships page offers value-based analysis', async ({
    page,
  }) => {
    await page.goto('/admin/settings/users');
    await expect(page.getByRole('link', { name: 'Users & access' })).toBeVisible();
    await expect(page.getByLabel('New user role')).toBeVisible();
    await page.goto('/admin/relationships');
    await expect(page.getByText('Analyze a reference')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run full-file analysis' })).toBeDisabled();
  });
});
