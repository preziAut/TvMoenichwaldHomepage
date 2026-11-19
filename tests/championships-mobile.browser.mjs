import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHAMPIONSHIP_BROWSER_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const match = { id: 'test', title: 'Einzel 2026', status: 'open', version: 0, home: 'Erika Test', away: 'Max Test', action: 'submit' };
  let sent;
  await page.route('https://club.test/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/meine-spiele') return route.fulfill({ json: [match] });
    if (pathname === '/api/spiele/test/ergebnis') {
      sent = route.request().postDataJSON();
      Object.assign(match, { status: 'submitted', version: 1, action: null });
      return route.fulfill({ json: { status: 'submitted' } });
    }
    if (/^\/(?:_astro|design)\/[\w.-]+\.(?:m?js|css|woff2|webp)$/.test(pathname)) {
      return route.fulfill({ path: `dist${pathname}` });
    }
    if (pathname === '/meisterschaften/meine-spiele/') return route.fulfill({
      contentType: 'text/html', body: await readFile('dist/meisterschaften/meine-spiele/index.html', 'utf8'),
    });
    return route.fulfill({ status: 404 });
  });
  await page.goto('https://club.test/meisterschaften/meine-spiele/');
  await page.getByRole('button', { name: 'Ergebnis melden' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const scores = page.getByRole('spinbutton');
  for (const [index, value] of ['6', '3', '6', '4'].entries()) await scores.nth(index).fill(value);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Ergebnis melden' }).click();
  await page.getByText('Wartet auf Bestätigung').waitFor();
  assert.deepEqual(sent, { version: 0, score: [[6, 3], [6, 4]], reason: '' });
  console.log('Mobile Ergebniseingabe bei 375 px erfolgreich.');
} finally {
  await browser.close();
}
