import { Pool } from 'pg';

export interface Connection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database {
  transaction<T>(work: (connection: Connection) => Promise<T>): Promise<T>;
}

export function connectBookingDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  return { database: postgresDatabase(pool), close: () => pool.end() };
}

export function postgresDatabase(pool: Pool): Database {
  return {
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work(client);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
