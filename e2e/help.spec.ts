/** Troubleshooting pages (FR-007.5) and the links that lead to them, on the demo hub. */
import { HELP_TOPICS } from '@uniwake/shared';
import { expect, expectAccessible, randomMac, test, uniq } from './fixtures';

test('AC-007-15: every help page renders without accessibility violations', async ({ page }) => {
  for (const topic of HELP_TOPICS) {
    await page.goto(`/ajuda/${topic}`);
    await expect(page.getByRole('heading', { level: 1 }), topic).toBeVisible();
    await expectAccessible(page);
  }
});

test('AC-007-15: a device problem in the diagnostics links to its help page', async ({
  page,
  api,
}) => {
  const device = (await (
    await api.post('/api/devices', { data: { name: uniq('PC Ajuda'), mac: randomMac() } })
  ).json()) as { device: { id: number } };
  await page.goto(`/dispositivos/${device.device.id}`);
  const diag = page.getByRole('region', { name: 'Diagnóstico' });
  await expect(diag.getByText('Nunca respondeu', { exact: true })).toBeVisible();
  await diag.getByRole('link', { name: 'Como resolver: Firewall e ping (ICMP)' }).click();
  await expect(page).toHaveURL(/\/ajuda\/firewall-icmp$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Firewall e ping (ICMP)');
});
