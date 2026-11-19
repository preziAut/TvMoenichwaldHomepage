import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHAMPIONSHIP_BROWSER_PATH,
});

try {
  for (const scenario of [
    { width: 375, reducedMotion: 'no-preference' },
    { width: 1280, reducedMotion: 'no-preference' },
    { width: 375, reducedMotion: 'reduce' },
  ]) {
    const page = await browser.newPage({ viewport: { width: scenario.width, height: 900 },
      reducedMotion: scenario.reducedMotion });
    const errors = [];
    let role = 'admin';
    let documentRequests = 0;
    let loginRequests = 0;
    const sessionDelay = 300;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++;
    });
    await page.route('https://club.test/**', async route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/meisterschaft-session') {
        await new Promise(resolve => setTimeout(resolve, sessionDelay));
        return route.fulfill({ json: { role } });
      }
      if (pathname === '/api/meisterschaft-konten') return route.fulfill({ json: { accounts: [], players: [] } });
      if (pathname === '/api/meisterschaft-login/link') {
        loginRequests++;
        return route.fulfill({ json: { ok: true } });
      }
      if (pathname.startsWith('/api/')) return route.fulfill({ json: [] });
      if (pathname.startsWith('/_astro/')) return route.fulfill({ path: `dist${pathname}` });
      if (pathname.startsWith('/meisterschaften/') || pathname === '/turniere/') {
        return route.fulfill({
          contentType: 'text/html', body: await readFile(`dist${pathname}index.html`, 'utf8'),
        });
      }
      return route.fulfill({ status: 404 });
    });

    await page.goto('https://club.test/meisterschaften/');
    const nav = page.getByRole('navigation', { name: 'Meisterschaftsbereich' });
    await nav.getByRole('link', { name: 'Verwaltung' }).waitFor();
    await page.evaluate(() => {
      window.navigationSamples = [];
      window.observeNavigation = true;
      function sample() {
        const nav = document.querySelector('nav[aria-label="Meisterschaftsbereich"]');
        if (nav) window.navigationSamples.push({
          visible: [...nav.querySelectorAll('a')].filter(link => !link.hidden).length,
          top: nav.getBoundingClientRect().top + scrollY,
          height: nav.getBoundingClientRect().height,
        });
        if (window.observeNavigation) requestAnimationFrame(sample);
      }
      sample();
    });

    for (const name of ['Meine Spiele', 'Sekturniere', 'Verwaltung', 'Vereinskonto', 'Meine Spiele', 'Vereinskonto']) {
      await nav.getByRole('link', { name, exact: true }).click();
      await page.waitForFunction(label => {
        const active = document.querySelector('[data-championship-access][aria-current="page"]');
        return active?.textContent.trim() === label;
      }, name);
      await page.waitForLoadState('networkidle');
      assert.equal(await nav.locator('a:visible').count(), 4);
      assert.equal(await nav.locator('[aria-current="page"] svg').count(), 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (name === 'Meine Spiele') await page.getByText('Dir sind noch keine Begegnungen zugeordnet.').waitFor();
      if (name === 'Verwaltung') await page.locator('#admin-workspace').waitFor();
      if (name === 'Vereinskonto') {
        const email = page.locator('#email-form');
        await email.getByRole('textbox').fill('test@example.invalid');
        await email.getByRole('button').click();
        await page.getByText('Wenn deine Adresse freigeschaltet ist, erhältst du eine E-Mail.').waitFor();
      }
    }
    assert.equal(loginRequests, 2, 'The login form has one working submit handler after each return');
    await page.goBack();
    await page.waitForFunction(() => location.pathname === '/meisterschaften/meine-spiele/');
    await page.getByText('Dir sind noch keine Begegnungen zugeordnet.').waitFor();
    await page.goForward();
    await page.waitForFunction(() => location.pathname === '/meisterschaften/anmelden/');
    await nav.getByRole('link', { name: 'Vereinskonto' }).waitFor();
    const samples = await page.evaluate(() => {
      window.observeNavigation = false;
      return window.navigationSamples;
    });
    assert.ok(samples.length > 10);
    assert.equal(Math.min(...samples.map(sample => sample.visible)), 4, 'No navigation cards disappear during a transition');
    assert.ok(Math.max(...samples.map(sample => sample.height)) - Math.min(...samples.map(sample => sample.height)) < 1,
      'Navigation height is stable');
    assert.ok(Math.max(...samples.map(sample => sample.top)) - Math.min(...samples.map(sample => sample.top)) < 1,
      'Navigation position is stable');
    assert.equal(documentRequests, 1, 'Switching tabs and history do not reload the document');

    role = 'member';
    await nav.getByRole('link', { name: 'Meine Spiele' }).click();
    await page.waitForFunction(() => location.pathname === '/meisterschaften/meine-spiele/');
    await page.waitForLoadState('networkidle');
    assert.equal(await nav.locator('a:visible').count(), 3);
    role = null;
    await nav.getByRole('link', { name: 'Vereinskonto' }).click();
    await page.waitForFunction(() => location.pathname === '/meisterschaften/anmelden/');
    await page.waitForLoadState('networkidle');
    assert.equal(await nav.locator('a:visible').count(), 2, 'Expired sessions remove protected navigation links');
    assert.deepEqual(errors, []);
    console.log(`${scenario.width}px / reduced motion ${scenario.reducedMotion}: stable navigation, forms, history and permissions passed.`);
    await page.close();
  }
} finally {
  await browser.close();
}
