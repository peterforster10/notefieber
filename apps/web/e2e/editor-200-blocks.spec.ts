// Abnahmekriterium aus E15: „Eine Seite mit 200 Blöcken ist in unter zwei Sekunden bearbeitbar.“
// Gemessen wird, was eine Person erlebt: vom Start der Navigation (performance.timeOrigin) bis ein
// getipptes Zeichen im Editor steht, also Laden der Seite, Anmelden am Collab-Server, erster
// Abgleich mit Yjs, Aufbau von BlockNote und die erste Eingabe. Dazu die Verzögerung beim Tippen
// in der vollen Seite. Ergebnis als Median und Maximum aus RUNS Läufen.
import { expect, test, type Page } from '@playwright/test';
import { createPage, signIn, trashPage } from './helpers';

const BLOCKS = 200;
const RUNS = Number(process.env.NF_E2E_RUNS ?? 5);
const LIMIT_MS = 2000;

/** 200 Blöcke, gemischt wie eine echte Seite: Überschriften, Absätze, Listen, Zitat, Code */
function content(): string {
  const parts: string[] = [];
  for (let i = 1; parts.length < BLOCKS; i++) {
    parts.push(
      `<h2>Abschnitt ${i}</h2>`,
      `<p>Absatz ${i}: Die Datenbank erzwingt die Rechte, deshalb darf die Oberfläche schnell entstehen. <strong>Wichtig</strong> ist, dass <em>jede</em> Seite durch page_rank geht.</p>`,
      `<p>Noch ein Absatz mit etwas mehr Text, damit die Seite nach einer echten Dokumentation aussieht und nicht nur aus kurzen Zeilen besteht. Abschnitt ${i}.</p>`,
      `<ul><li>Punkt eins in Abschnitt ${i}</li><li>Punkt zwei in Abschnitt ${i}</li></ul>`,
      `<ol><li>Erster Schritt in Abschnitt ${i}</li></ol>`,
      `<blockquote>Zitat aus Abschnitt ${i}</blockquote>`,
      `<pre><code>SELECT set_config('app.tenant_id', $1, true); -- ${i}</code></pre>`,
      `<p>Letzter Absatz in Abschnitt ${i}.</p>`,
    );
  }
  return parts.slice(0, BLOCKS - 1).join('') + '<p>Ende der Seite.</p>';
}

const blocks = (page: Page) => page.locator('.bn-editor .bn-block-outer');
const editor = (page: Page) => page.locator('.bn-editor[contenteditable="true"]');

/** Inhalt einfügen wie aus der Zwischenablage (ProseMirror liest clipboardData aus dem Ereignis) */
async function paste(page: Page, html: string) {
  await editor(page).locator('.bn-block-content').first().click();
  await page.evaluate((h) => {
    const target = document.querySelector('.bn-editor[contenteditable="true"]');
    if (!target) throw new Error('kein Editor');
    const data = new DataTransfer();
    data.setData('text/html', h);
    data.setData('text/plain', 'Inhalt');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test('Seite mit 200 Blöcken ist in unter 2 s bearbeitbar', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  const { id, url } = await createPage(page, `Messung 200 Blöcke ${new Date().toISOString().slice(0, 19)}`);
  try {
    // Vorbereiten: 200 Blöcke einfügen und warten, bis der Collab-Server gespeichert hat
    await page.goto(url);
    await expect(editor(page)).toBeVisible({ timeout: 30_000 });
    await paste(page, content());
    await expect.poll(() => blocks(page).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(BLOCKS);
    await page.waitForTimeout(12_000); // Speichern entprellt: spätestens nach 10 s

    const loads: number[] = [];
    const typing: number[] = [];
    for (let run = 1; run <= RUNS; run++) {
      await page.goto(url, { waitUntil: 'commit' });
      await expect(editor(page)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => blocks(page).count()).toBeGreaterThanOrEqual(BLOCKS);
      // Ans Ende der letzten Zeile und ein Zeichen tippen
      const last = editor(page).locator('.bn-block-content').last();
      await last.click();
      await page.keyboard.press('End');
      const marker = `#${run}`;
      await page.keyboard.type(marker);
      await expect(last).toContainText(marker);
      loads.push(await page.evaluate(() => performance.now()));

      // Verzögerung beim Tippen: Taste bis Zeichen im DOM, in der Seite gemessen
      typing.push(
        await page.evaluate(async () => {
          const el = document.querySelectorAll('.bn-editor .bn-block-content');
          const target = el[el.length - 1]!;
          const before = target.textContent ?? '';
          const start = performance.now();
          document.execCommand('insertText', false, 'x');
          await new Promise<void>((resolve) => {
            const check = () => ((target.textContent ?? '') !== before ? resolve() : requestAnimationFrame(check));
            check();
          });
          return performance.now() - start;
        }),
      );
      // Zeichen wieder entfernen, damit jeder Lauf gleich startet
      for (let i = 0; i < marker.length + 1; i++) await page.keyboard.press('Backspace');
    }

    const result = {
      blocks: await blocks(page).count(),
      loadMedianMs: Math.round(median(loads)),
      loadMaxMs: Math.round(Math.max(...loads)),
      typingMedianMs: Math.round(median(typing) * 10) / 10,
      runs: loads.map(Math.round),
    };
    console.log(`Messung 200 Blöcke: ${JSON.stringify(result)}`);
    test.info().annotations.push({ type: 'messung', description: JSON.stringify(result) });
    expect(result.loadMaxMs, `bearbeitbar nach ${result.runs.join(', ')} ms`).toBeLessThan(LIMIT_MS);
  } finally {
    await trashPage(page, id);
  }
});
