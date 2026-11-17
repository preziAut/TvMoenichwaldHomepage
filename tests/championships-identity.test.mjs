import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { digest, identity } from '../championships/server/identity.ts';

test('Better Auth verifies an email link once and saves only digests of both proofs', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of ['0001_competition.sql', '0002_sessions.sql', '0003_identity.sql']) {
      db.exec(readFileSync(new URL(`../championships/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const messages = [];
    const origin = 'https://verein.test';
    const claim = await identity(db, origin, 'a-test-only-secret-3bef52ba04192530', { send: async message => { messages.push(message); } });
    const headers = new Headers({ Origin: origin });
    await claim.api.signInMagicLink({ body: { email: 'member@example.test' }, headers });
    const token = messages[0].text.match(/#([a-f0-9]{64})/)[1];
    const pending = db.prepare('SELECT identifier,value FROM verification').get();
    assert.ok(!JSON.stringify(pending).includes(token));
    const verified = await claim.api.magicLinkVerify({ query: { token }, headers });
    assert.equal(verified.user.emailVerified, true);
    assert.equal(verified.user.email, 'member@example.test');
    assert.equal(db.prepare('SELECT token FROM session').get().token, await digest(verified.token));
    await assert.rejects(() => claim.api.magicLinkVerify({ query: { token }, headers }));
    assert.equal(db.prepare('SELECT count(*) AS total FROM verification').get().total, 0);
  } finally { db.close(); }
});
