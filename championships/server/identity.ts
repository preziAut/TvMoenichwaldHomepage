import { betterAuth, type BetterAuthOptions, type DBAdapter } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { createKyselyAdapter, kyselyAdapter } from '@better-auth/kysely-adapter';
import type { EmailService } from './email.ts';

export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
export async function digest(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Better Auth issues a short-lived proof; persist only its token digest. */
export function hashProofTokens(adapter: DBAdapter): DBAdapter {
  const api = {
    ...adapter,
    create: (async input => {
      if (input.model !== 'session') return adapter.create(input);
      const token = (input.data as Record<string, unknown>).token;
      if (typeof token !== 'string' || token.length < 32) throw new Error('Ungültiger Authentifizierungsnachweis.');
      const result = await adapter.create({ ...input, data: { ...input.data, token: await digest(token) } });
      return { ...result, token };
    }) as DBAdapter['create'],
    delete: (async input => adapter.delete(input.model !== 'session' ? input : {
      ...input,
      where: await Promise.all(input.where.map(async filter => {
        if (filter.field !== 'token') return filter;
        if (typeof filter.value !== 'string') throw new Error('Ungültiger Session-Filter.');
        return { ...filter, value: await digest(filter.value) };
      })),
    })) as DBAdapter['delete'],
  };
  return new Proxy(api, {
    get(target, key, receiver) {
      if (typeof key !== 'string' || !['findOne', 'findMany', 'update', 'updateMany', 'incrementOne', 'consumeOne'].includes(key)) {
        if (key === 'transaction') return <T>(run: (trx: DBAdapter) => Promise<T>) => run(receiver as DBAdapter);
        return Reflect.get(target, key, receiver);
      }
      return (input: { model: string }) => {
        // The proof is exchanged immediately. These operations must never read or update a proof token.
        if (input.model === 'session') throw new Error('Authentifizierungsnachweise sind nur einmal zur Ausgabe verfügbar.');
        const method = Reflect.get(target, key);
        return method.call(target, input);
      };
    },
  });
}

export function identityOptions(database: BetterAuthOptions['database'], origin: string, secret: string, mail: EmailService) {
  return {
    database, baseURL: origin, basePath: '/api/meisterschaft-login', secret, telemetry: { enabled: false },
    advanced: { useSecureCookies: true },
    session: { expiresIn: 60, disableSessionRefresh: true, cookieCache: { enabled: false } },
    plugins: [magicLink({ expiresIn: 600, storeToken: 'hashed', generateToken: randomToken,
      async sendMagicLink({ email, token }) {
        const link = new URL('/meisterschaften/anmelden/', origin);
        link.hash = token;
        await mail.send({ to: email, subject: 'Anmeldelink für TV Mönichwald',
          text: `Öffne diesen Link und bestätige die Anmeldung. Der Link ist zehn Minuten gültig.\n\n${link.href}` });
      } })],
  } satisfies BetterAuthOptions;
}

export async function identity(database: BetterAuthOptions['database'], origin: string, secret: string, mail: EmailService) {
  const options = identityOptions(database, origin, secret, mail);
  const { kysely, databaseType } = await createKyselyAdapter(options);
  if (!kysely) throw new Error('Auth-Datenbank fehlt.');
  const adapter = kyselyAdapter(kysely, { type: databaseType ?? 'sqlite', transaction: false });
  return betterAuth({ ...options, database: (config: BetterAuthOptions) => hashProofTokens(adapter(config)) });
}
