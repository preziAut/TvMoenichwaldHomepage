import assert from 'node:assert/strict';
import test from 'node:test';
import { world4youEmail } from '../championships/server/email.ts';

function transport({ tls = true } = {}) {
  const commands = [];
  const encoder = new TextEncoder();
  const scripted = (name, initial, replies) => {
    let controller;
    const readable = new ReadableStream({ start(c) { controller = c; if (initial) c.enqueue(encoder.encode(initial)); } });
    const writable = new WritableStream({ write(data) {
      commands.push([name, new TextDecoder().decode(data)]);
      const reply = replies.shift();
      if (reply) controller.enqueue(encoder.encode(reply));
    } });
    return { opened: Promise.resolve(), readable, writable, async close() {} };
  };
  const secure = scripted('tls', '', ['250-server\r\n250 AUTH PLAIN LOGIN\r\n', '235 ok\r\n', '250 ok\r\n', '250 ok\r\n', '354 send\r\n', '250 queued\r\n']);
  const plain = scripted('plain', '220 hello\r\n', [tls ? '250-server\r\n250 STARTTLS\r\n' : '250 AUTH PLAIN\r\n', '220 continue\r\n']);
  const service = world4youEmail((address, options) => {
    assert.deepEqual(address, { hostname: 'smtp.world4you.com', port: 587 });
    assert.equal(options.secureTransport, 'starttls');
    return { ...plain, startTls: () => secure };
  }, { username: 'club@example.test', password: 'test-only' });
  return { commands, service };
}

test('world4you credentials and message are sent only after STARTTLS', async () => {
  const config = transport();
  await config.service.send({ to: 'player@example.test', subject: 'Einladung', text: 'Dein Link' });
  assert.deepEqual(config.commands.filter(([name]) => name === 'plain').map(([, command]) => command), ['EHLO tv-moenichwald.at\r\n', 'STARTTLS\r\n']);
  assert.match(config.commands[3][1], /^AUTH PLAIN /);
  assert.equal(config.commands[3][0], 'tls');
  const downgrade = transport({ tls: false });
  await assert.rejects(() => downgrade.service.send({ to: 'player@example.test', subject: 'Einladung', text: 'Dein Link' }), /kein STARTTLS/);
  assert.equal(downgrade.commands.length, 1);
});
