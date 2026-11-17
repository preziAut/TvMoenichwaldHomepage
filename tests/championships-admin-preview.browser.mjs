import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = 'https://meisterschaften-preview.tv-moenichwald.pages.dev';
const [email, password] = (await readFile(process.env.CHAMPIONSHIP_PREVIEW_CREDENTIALS, 'utf8')).trim().split(/\r?\n/);
assert.ok(email && password, 'Preview credentials are missing.');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHAMPIONSHIP_BROWSER_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const title = `UI-Test Einzel ${new Date().toISOString()}`;
  await page.goto(`${origin}/meisterschaften/anmelden/`);
  const login = page.getByRole('form', { name: 'Admin-Anmeldung' });
  await login.getByLabel('E-Mail-Adresse').fill(email);
  await login.getByLabel('Passwort').fill(password);
  await login.getByRole('button', { name: 'Mit Passwort anmelden' }).click();
  await page.waitForURL('**/meisterschaften/admin/');

  const create = page.locator('#create');
  await create.getByLabel('Titel').fill(title);
  await create.getByLabel('Beginn').fill(new Date().toISOString().slice(0, 10));
  await create.getByLabel('Folgephase').selectOption('knockout');
  await create.getByRole('button', { name: 'Entwurf anlegen' }).click();
  const player = page.locator('#player');
  await player.getByLabel('Vorname').waitFor();
  assert.equal(await create.isVisible(), false);
  await page.waitForFunction(() => document.activeElement === document.querySelector('#player input[name="firstName"]'));
  assert.equal(new URL(page.url()).searchParams.has('id'), true);
  await page.reload();
  await player.getByLabel('Vorname').waitFor();
  for (const name of ['Alex', 'Sam']) {
    await player.getByLabel('Vorname').fill(name);
    await player.getByLabel('Nachname').fill('UI-Test');
    await player.getByRole('button').click();
    await page.getByText('Teilnehmer hinzugefügt.', { exact: true }).waitFor();
  }
  await page.getByLabel('Anzahl Gruppen').fill('1');
  await page.getByRole('button', { name: 'Auslosung ansehen' }).click();
  await page.locator('#start').getByLabel('Meisterschaft veröffentlichen').check();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Vorrunde starten' }).click();
  await page.getByRole('heading', { name: 'Begegnungen und Ergebnisse' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  async function enter(card, numbers, name, reason) {
    const fields = card.getByRole('spinbutton');
    for (const [index, number] of numbers.entries()) await fields.nth(index).fill(String(number));
    if (reason) await card.getByLabel('Grund der Korrektur').fill(reason);
    await card.getByRole('button', { name }).click();
    await card.getByText(numbers.filter((_, i) => i % 2 === 0).map((n, i) => `${n}:${numbers[2 * i + 1]}`).join(', '), { exact: true }).waitFor();
  }
  await enter(page.locator('[data-match]').first(), [6, 3, 6, 4], 'Ergebnis speichern');
  await enter(page.locator('[data-match]').first(), [6, 2, 6, 4], 'Ergebnis korrigieren', 'UI-Test der Korrektur');
  await page.getByLabel('Anzahl Qualifikanten (K.-o.)').fill('2');
  await page.getByRole('button', { name: 'Folgephase ansehen' }).click();
  await page.getByText('1 Begegnungen im K.-o.-Spielplan.').waitFor();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Folgephase starten' }).click();
  await enter(page.locator('[data-match]').filter({ hasText: 'Folgephase' }), [7, 5, 6, 4], 'Ergebnis speichern');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Meisterschaft abschließen' }).click();
  await page.getByText('Meisterschaft abgeschlossen.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Spielplan und Tabelle ansehen' }).click();
  await page.getByRole('heading', { name: title }).waitFor();
  await page.getByText(/7:5, 6:4/).waitFor();
  console.log('UI-Test bei 375 px bestanden: Entwurf, Neuladen, Auslosung, Ergebnis, Korrektur, Finale und Abschluss.');
} finally {
  await browser.close();
}
