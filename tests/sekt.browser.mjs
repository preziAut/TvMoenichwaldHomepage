import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { sektFixture } from './helpers/sekt-fixture.mjs';
import { onRequest as sekt } from '../functions/api/sekturniere/[[path]].ts';
import { onRequest as championships } from '../functions/api/meisterschaften/[[path]].ts';
import { onRequestGet as session } from '../functions/api/meisterschaft-session.ts';
import { onRequest as accounts } from '../functions/api/meisterschaft-konten.ts';

const fixture = await sektFixture();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHAMPIONSHIP_BROWSER_PATH });
const origin = 'https://club.test';
try {
  const { sqlite, db, admin } = fixture;
  const contactIds = [];
  for (let index = 0; index < 15; index++) {
    const id = crypto.randomUUID();
    contactIds.push(id);
    sqlite.prepare('INSERT INTO championship_players (id,first_name,last_name,display_name,contact_key) VALUES (?,?,?,?,?)')
      .run(id, 'Test', String(index), `Testperson ${String(index + 1).padStart(2, '0')}`, `test-${index}`);
  }
  const editor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const visitor = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const [cookieName, cookie] = admin.split('=');
  await editor.addCookies([{ name: cookieName, value: cookie, url: origin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const errors = [];
  let publicReads = 0;
  for (const context of [editor, visitor]) await context.route(origin + '/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) {
      const handler = url.pathname.startsWith('/api/sekturniere') ? sekt :
        url.pathname === '/api/meisterschaft-session' ? session :
        url.pathname === '/api/meisterschaft-konten' ? accounts :
        url.pathname.startsWith('/api/meisterschaften') ? championships : null;
      if (!handler) return route.fulfill({ status: 404 });
      if (context === visitor && url.pathname.startsWith('/api/sekturniere/')) publicReads++;
      const response = await handler({ env: { DB: db }, request: new Request(req.url(), {
        method: req.method(), headers: await req.allHeaders(), body: req.postData() || undefined,
      }) });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    try { return await route.fulfill({ path: 'dist' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : '') }); }
    catch { return route.fulfill({ status: 404 }); }
  });
  const page = await editor.newPage();
  const publicPage = await visitor.newPage();
  page.on('pageerror', error => errors.push(error.message));
  publicPage.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'Im Browser geprüft' : undefined));
  await page.goto(origin + '/meisterschaften/admin/?typ=sekt');
  await page.locator('#admin-workspace').waitFor();
  const create = page.locator('#create');
  await create.locator('[name=title]').fill('Browser-Sekturnier');
  await create.locator('[name=startsOn]').fill('2026-11-19');
  await create.locator('[name=defaultGames]').fill('4');
  await create.getByRole('button').click();
  await page.locator('#sekt-detail').waitFor();
  assert.equal(await page.locator('[data-championship-access][aria-current=page]').innerText(), 'Sekturniere');
  const eventId = new URL(page.url()).searchParams.get('id');
  assert.ok(eventId);
  for (const [index, id] of contactIds.entries()) {
    const reuse = page.locator('#sekt-reuse');
    await reuse.locator('[name=playerId]').selectOption(id);
    await reuse.locator('[name=pot]').selectOption(index < 8 ? '1' : '2');
    await reuse.getByRole('button').click();
    await page.waitForFunction(count => document.querySelectorAll('#sekt-entries li').length === count, index + 1);
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS total FROM championship_players').get().total, 15);
  for (let number = 1; number <= 2; number++) {
    await page.locator('#sekt-prepare').click();
    await page.locator('#sekt-draw').waitFor();
    assert.equal(await page.locator('#sekt-draw-submit').isDisabled(), true);
    const pot2 = page.locator('#sekt-pot-players [data-player]').filter({ has: page.locator('select option[value="2"]:checked') });
    await pot2.first().locator('input[type=checkbox]').check();
    await page.locator('#sekt-draw-submit').click();
    await page.waitForFunction(() => document.querySelectorAll('#sekt-matches article').length === 4 &&
      document.querySelector('#sekt-draw').hidden);
    assert.equal(await page.locator('#sekt-matches').getByText('Aushilfe · ohne eigene Wertung', { exact: false }).count(), 1);
    if (number === 1) {
      await publicPage.goto(origin + '/meisterschaften/sekturnier/?id=' + eventId);
      await publicPage.locator('#sekt-detail').waitFor();
      assert.equal(await publicPage.locator('#sekt-admin').isVisible(), false);
      assert.equal(await publicPage.locator('[data-result-form]').count(), 0);
      assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    for (let position = 0; position < 4; position++) {
      const card = page.locator('#sekt-matches article').nth(position);
      const scores = card.locator('input[type=number]');
      await scores.nth(0).fill('4');
      await scores.nth(1).fill('4');
      await card.getByRole('button', { name: 'Endergebnis speichern' }).click();
      await page.waitForFunction(position => document.querySelectorAll('#sekt-matches button')[position]?.textContent === 'Ergebnis korrigieren', position);
    }
    await page.locator('#sekt-close-round').click();
    await page.locator('#sekt-close-round').waitFor({ state: 'hidden' });
    await page.waitForFunction(total => [...document.querySelectorAll('#sekt-ranking tr')].every(row =>
      row.children[2].textContent === String(total)), number * 4);
    if (number === 1) {
      await publicPage.waitForFunction(() => [...document.querySelectorAll('#sekt-ranking tr')].every(row =>
        row.children[2].textContent === '4'), { timeout: 15000 });
      assert.ok(publicReads >= 2, 'Public standings update without reloading the page');
    }
  }
  await page.locator('#sekt-finish').click();
  await page.getByText('Endstand', { exact: true }).waitFor();
  const card = page.locator('#sekt-matches article').first();
  await card.locator('input[type=number]').nth(1).fill('3');
  await card.getByLabel('Korrekturkommentar').fill('Ergebnis gemeinsam geprüft');
  await card.getByRole('button', { name: 'Ergebnis korrigieren' }).click();
  await page.locator('#sekt-history-panel summary').click();
  await page.getByText('Ergebnis gemeinsam geprüft', { exact: true }).waitFor();
  await publicPage.waitForFunction(() => [...document.querySelectorAll('#sekt-ranking tr')].some(row =>
    row.children[2].textContent === '7'), { timeout: 15000 });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('Sekt UI passed with real handlers and isolated SQLite: 15 contacts, two rounds, helper, scores, correction, history and automatic public refresh at 375px.');
  await editor.close();
  await visitor.close();
} finally {
  await browser.close();
  fixture.sqlite.close();
}
