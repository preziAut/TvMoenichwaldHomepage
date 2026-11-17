export type EmailMessage = { to: string; subject: string; text: string };
export type EmailService = { send(message: EmailMessage): Promise<void> };

type Socket = {
  opened: Promise<unknown>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  startTls(): Socket;
  close(): Promise<void>;
};
type Connect = (address: { hostname: string; port: number }, options: { secureTransport: 'starttls' }) => Socket;

const hostname = 'smtp.world4you.com';
const encoder = new TextEncoder();
const address = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i;
const base64 = (input: string) => btoa(Array.from(encoder.encode(input), byte => String.fromCharCode(byte)).join(''));

function conversation(socket: Socket) {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffered = '';
  return {
    async expect(code: number) {
      const lines: string[] = [];
      while (lines.length < 80) {
        const newline = buffered.indexOf('\r\n');
        if (newline < 0) {
          const chunk = await reader.read();
          if (chunk.done || buffered.length + chunk.value.byteLength > 16384) throw new Error('SMTP-Antwort unvollständig.');
          buffered += decoder.decode(chunk.value, { stream: true });
          continue;
        }
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 2);
        if (!line.startsWith(`${code} `) && !line.startsWith(`${code}-`)) throw new Error(`SMTP erwartete Status ${code}.`);
        lines.push(line.slice(4));
        if (line[3] === ' ') return lines;
      }
      throw new Error('SMTP-Antwort zu lang.');
    },
    write: (line: string) => writer.write(encoder.encode(`${line}\r\n`)),
    release() { reader.releaseLock(); writer.releaseLock(); },
  };
}

/** Strict STARTTLS. The injected Worker TCP socket performs TLS and certificate validation. */
export function world4youEmail(connect: Connect, credentials: { username: string; password: string }): EmailService {
  return { async send({ to, subject, text }) {
    if (!address.test(to) || !address.test(credentials.username) || !credentials.password ||
        /[\r\n\0]/.test(subject) || subject.length > 160 || text.length > 20000) throw new Error('Ungültige E-Mail-Daten.');
    let socket = connect({ hostname, port: 587 }, { secureTransport: 'starttls' });
    const send = async () => {
      await socket.opened;
      const plain = conversation(socket);
      await plain.expect(220);
      await plain.write('EHLO tv-moenichwald.at');
      const capabilities = await plain.expect(250);
      if (!capabilities.some(line => /^STARTTLS$/i.test(line.trim()))) throw new Error('SMTP unterstützt kein STARTTLS.');
      await plain.write('STARTTLS');
      await plain.expect(220);
      plain.release();
      socket = socket.startTls();
      await socket.opened;
      const secure = conversation(socket);
      await secure.write('EHLO tv-moenichwald.at');
      const auth = await secure.expect(250);
      if (!auth.some(line => /^AUTH(?:\s|=).*\bPLAIN\b/i.test(line))) throw new Error('SMTP bietet AUTH PLAIN nicht über TLS an.');
      await secure.write(`AUTH PLAIN ${base64(`\0${credentials.username}\0${credentials.password}`)}`);
      await secure.expect(235);
      await secure.write(`MAIL FROM:<${credentials.username}>`);
      await secure.expect(250);
      await secure.write(`RCPT TO:<${to}>`);
      await secure.expect(250);
      await secure.write('DATA');
      await secure.expect(354);
      const payload = base64(text).match(/.{1,76}/g)?.join('\r\n') ?? '';
      await secure.write([`From: ${credentials.username}`, `To: ${to}`, `Subject: =?UTF-8?B?${base64(subject)}?=`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${credentials.username.split('@')[1]}>`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', payload, '.'].join('\r\n'));
      await secure.expect(250);
      secure.release();
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([send(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('SMTP-Zeitlimit überschritten.')), 12000);
      })]);
    } finally {
      clearTimeout(timeout);
      void socket.close().catch(() => {});
    }
  } };
}
