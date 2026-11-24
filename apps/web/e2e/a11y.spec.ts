// Barrierefreiheit nach WCAG 2.2 AA (E15): axe auf den wichtigsten Ansichten und in jedem Dialog,
// am Desktop und auf Tablet-Breite (Schublade), dazu Bedienung nur mit der Tastatur. Die Kontraste
// aller Farbpaare prüft zusätzlich src/app/contrast.test.mjs, auch für Zustände wie Hover.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary, 'Befunde von axe').toEqual([]);
}

/** Space ENTW, Seite „Personalplanung 2027“ (eigene Rechte, aus seed.sql) */
async function openRestrictedPage(page: Page) {
  await page.goto('/s/entw');
  // Unter 1024 px steht der Baum in der Schublade
  const menu = page.getByRole('button', { name: 'Navigation öffnen' });
  await page.getByRole('tree', { includeHidden: true }).waitFor({ state: 'attached' });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('treeitem', { name: /Betrieb/ })
    .first()
    .waitFor();
  const betrieb = page.locator('[data-tree-link]', { hasText: 'Betrieb' }).first();
  await betrieb.focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-tree-link]', { hasText: 'Personalplanung 2027' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Personalplanung 2027' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const viewport of [
  { name: 'Desktop', width: 1280, height: 900 },
  { name: 'Tablet', width: 768, height: 1024 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Startseite, Space, Seite und Einstellungen ohne Befunde', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await axe(page);

      await openRestrictedPage(page);
      await expect(page.locator('.bn-editor')).toBeVisible();
      await axe(page);

      await page.goto('/s/entw/settings');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await axe(page);
    });

    test('Dialoge ohne Befunde, Esc schließt, Fokus zurück zum Knopf', async ({ page }) => {
      await openRestrictedPage(page);
      for (const name of ['Teilen und Rechte', 'Versionen', 'Exportieren']) {
        const button = page.getByRole('button', { name, exact: true });
        await button.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await axe(page, 'dialog[open]');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(button).toBeFocused();
      }
    });
  });
}

test.describe('Tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('Schublade öffnet und schließt per Tastatur', async ({ page }) => {
    await page.goto('/s/entw');
    const open = page.getByRole('button', { name: 'Navigation öffnen' });
    await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeHidden();
    await open.click();
    await expect(page.getByRole('button', { name: 'Navigation schließen' })).toBeFocused();
    await axe(page);
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeHidden();
  });
});

test('Tastatur: Zum Inhalt springen, Seitenbaum mit Pfeiltasten', async ({ page }) => {
  await page.goto('/s/entw');
  await page.getByRole('tree').waitFor();
  // Nur unter next dev: Der Knopf der Entwicklerwerkzeuge von Next.js wäre der erste Tab-Stopp
  await page.evaluate(() => document.querySelector('nextjs-portal')?.remove());
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeFocused();

  // Ein Tab-Stopp für den Baum; Pfeiltasten wandern, → klappt auf und geht hinein, ← zurück
  const links = page.locator('[data-tree-link]');
  await expect(page.locator('[data-tree-link][tabindex="0"]')).toHaveCount(1);
  await links.first().focus();
  await page.keyboard.press('End');
  await expect(links.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(links.first()).toBeFocused();
  const betrieb = page.locator('[data-tree-link]', { hasText: 'Betrieb' }).first();
  await betrieb.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[role="treeitem"][aria-expanded="true"]', { has: betrieb })).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[role="treeitem"][aria-level="2"] [data-tree-link]').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(betrieb).toBeFocused();
});

test('Alte Adressen /spaces/…/pages/… führen auf die kurzen', async ({ page }) => {
  await page.goto('/spaces/entw');
  await expect(page).toHaveURL(/\/s\/entw$/);
  await page.goto('/spaces/ENTW/settings');
  await expect(page).toHaveURL(/\/s\/entw\/settings$/);
});

test('Space-Einstellungen über „⋯“ im Space-Umschalter, mit Maus und Tastatur', async ({ page }) => {
  await page.goto('/s/entw');
  const card = page.getByRole('button', { name: /Space wechseln/ });
  // Maus: Karte öffnen, über „Entwicklung“ fahren, „⋯“ klappt das Untermenü nach rechts aus
  await card.click();
  const row = page.locator('.nf-menu-row', { hasText: 'Entwicklung' });
  await row.hover();
  const more = page.getByRole('menuitem', { name: 'Aktionen für Entwicklung' });
  await expect(more).toBeVisible();
  await more.click();
  const settings = page
    .getByRole('menu', { name: 'Aktionen für Entwicklung' })
    .getByRole('menuitem', { name: 'Einstellungen' });
  await expect(settings).toBeVisible();
  const [rowBox, subBox] = [await row.boundingBox(), await settings.boundingBox()];
  expect(subBox!.x, 'Untermenü rechts neben dem Eintrag').toBeGreaterThan(rowBox!.x + rowBox!.width - 1);
  await page.screenshot({ path: '../../.local/e2e-results/space-einstellungen.png' });
  await axe(page, '.nf-menu');
  await settings.click();
  await expect(page).toHaveURL(/\/s\/entw\/settings$/);

  // Tastatur: ↓ bis „Entwicklung“, → öffnet das Untermenü, Enter öffnet die Einstellungen
  await page.goto('/s/entw');
  await card.focus();
  await page.keyboard.press('ArrowDown');
  const entw = page.getByRole('menuitem', { name: 'Entwicklung', exact: true });
  while (!(await entw.evaluate((el) => el === document.activeElement))) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(settings).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(more).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/s\/entw\/settings$/);
});
