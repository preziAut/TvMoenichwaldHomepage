import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = 'https://meisterschaften-preview.tv-moenichwald.pages.dev';
const [email, password] = (await readFile(process.env.CHAMPIONSHIP_PREVIEW_CREDENTIALS, 'utf8')).trim().split(/\r?\n/);
const browser = await chromium.launch({ executablePath: process.env.CHAMPIONSHIP_BROWSER_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/meisterschaften/anmelden/`);
  const login = page.getByRole('form', { name: 'Admin-Anmeldung' });
  await login.getByLabel('E-Mail-Adresse').fill(email);
  await login.getByLabel('Passwort').fill(password);
  await login.getByRole('button', { name: 'Mit Passwort anmelden' }).click();
  await page.waitForURL('**/meisterschaften/admin/');

  async function json(path, data) {
    const headers = { Origin: origin };
    const response = data === undefined ? await page.request.get(`${origin}/api/${path}`, { headers }) :
      await page.request.post(`${origin}/api/${path}`, { headers, data });
    const output = await response.json();
    assert.ok(response.ok(), `${path}: ${response.status()} ${output.error ?? ''}`);
    return output;
  }

  const title = 'Testmeisterschaft · 25 Teilnehmer und 5 Gruppen';
  const draft = await json('meisterschaften', { title, startsOn: '2026-11-17', phaseTwo: 'knockout', visibility: 'public',
    description: 'Demoturnier mit fiktiven Kontakten und Ergebnissen. 15 gesetzte und 10 ungesetzte Teilnehmer, fünf Vorrundengruppen und eine K.-o.-Runde mit acht Qualifikanten.' });
  const base = `meisterschaften/${draft.id}`;
  const contacts = new Map((await json('meisterschaft-konten')).players.map(player => [player.display_name, player.id]));
  let current = draft;
  for (let i = 1; i <= 25; i++) {
    const firstName = `Demo ${String(i).padStart(2, '0')}`;
    const lastName = 'Tennis';
    const playerId = contacts.get(`${firstName} ${lastName}`);
    current = await json(`${base}/teilnehmer`, { version: current.version, ...(playerId ? { playerId } : { firstName, lastName }) });
  }
  const entries = (await json(`${base}/teilnehmer`)).sort((a, b) => a.display_name.localeCompare(b.display_name));
  assert.equal(new Set(entries.map(entry => entry.id)).size, 25);
  current = await json(`${base}/setzliste`, { version: current.version, order: entries.slice(0, 15).map(row => row.id) });
  await page.goto(`${origin}/meisterschaften/admin/?id=${draft.id}`);
  await page.getByLabel('Anzahl Gruppen').fill('5');
  await page.getByRole('button', { name: 'Auslosung ansehen' }).click();
  await page.locator('#preview li').nth(4).waitFor();
  await page.locator('#start').getByLabel('Spielplan und Ergebnisse ab Start freigeben').check();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Vorrunde starten' }).click();
  await page.getByText('Vorrunde gestartet. Die Ergebnisse können jetzt eingetragen werden.').waitFor();

  const groupStage = await json(base);
  assert.deepEqual(groupStage.tables.map(table => table.rows.length), [5, 5, 5, 5, 5]);
  assert.ok(groupStage.tables.every(table => table.rows.filter(row => /^Demo 0[1-5] Tennis$/.test(row.name)).length === 1));
  assert.equal(groupStage.matches.length, 50);
  const score = (match, index) => {
    const first = index % 3 === 0 ? [[6, 3], [4, 6], [6, 2]] : index % 2 ? [[7, 5], [6, 2]] : [[6, 4], [6, 1]];
    return match.home_name.localeCompare(match.away_name) < 0 ? first : first.map(set => set.toReversed());
  };
  const opening = groupStage.matches[0];
  const firstCard = page.locator(`[data-match="${opening.id}"]`);
  for (const [index, value] of score(opening, 0).flat().entries()) await firstCard.getByRole('spinbutton').nth(index).fill(String(value));
  await firstCard.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await firstCard.getByText('Vorrunde · Bestätigt').waitFor();
  for (const [index, match] of groupStage.matches.slice(1).entries()) {
    await json(`spiele/${match.id}/ergebnis`, { version: match.version, score: score(match, index + 1) });
  }
  await page.reload();
  await page.getByLabel('Anzahl Qualifikanten (K.-o.)').fill('8');
  await page.getByLabel('Spiel um Platz 3').check();
  await page.getByRole('button', { name: 'Folgephase ansehen' }).click();
  await page.getByText('8 Begegnungen im K.-o.-Spielplan.').waitFor();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Folgephase starten' }).click();
  await page.getByText('Folgephase gestartet.', { exact: true }).waitFor();
  for (let round = 1; round <= 3; round++) {
    const { matches } = await json(base);
    const roundMatches = matches.filter(match => match.phase === 2 && match.round === round);
    for (const [index, match] of roundMatches.entries()) {
      assert.ok(match.home_name && match.away_name, 'Beide Finalisten müssen automatisch gesetzt sein.');
      await json(`spiele/${match.id}/ergebnis`, { version: match.version, score: score(match, index) });
    }
  }
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Meisterschaft abschließen' }).click();
  await page.getByText('Meisterschaft abgeschlossen.', { exact: true }).waitFor();
  const finished = await json(base);
  assert.equal(finished.championship.status, 'finished');
  assert.equal(finished.matches.filter(match => match.score).length, 58);
  const final = finished.matches.find(match => match.phase === 2 && match.round === 3 && match.bracket_position === 1);
  const winner = final.winner === final.home ? final.home_name : final.away_name;
  await page.getByRole('link', { name: 'Spielplan und Tabelle ansehen' }).click();
  await page.getByRole('region', { name: 'Podium' }).getByText('3. Platz', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: /^Vorrunde · Gruppe/ }).count(), 5);
  console.log(JSON.stringify({ url: page.url(), adminUrl: `${origin}/meisterschaften/admin/?id=${draft.id}`, winner, final: final.score, matches: 58 }));
} finally {
  await browser.close();
}
