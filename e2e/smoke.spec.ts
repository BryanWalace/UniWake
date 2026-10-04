import { expect, test } from './fixtures';

test.describe('harness smoke (M2-T13)', () => {
  test('anonymous users see the login page with no console or CSP errors', async ({
    anonymousPage,
  }) => {
    await anonymousPage.goto('/dispositivos');
    await expect(anonymousPage.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await expect(anonymousPage).toHaveURL(/\/login\?next=%2Fdispositivos$/);
  });

  test('the logged-in admin sees the shell and can navigate', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    await page.getByRole('link', { name: 'Dispositivos' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dispositivos' })).toBeVisible();
    await expect(page).toHaveURL(/\/dispositivos$/);
  });

  test('the hub serves the panel with the CSP header', async ({ api }) => {
    const r = await api.get('/');
    expect(r.headers()['content-security-policy']).toContain("script-src 'self'");
  });
});
