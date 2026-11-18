import { writeFile } from 'node:fs/promises';

const source = process.env.BOOKING_PAGES_POSTGRES === 'true'
  ? "export { connectBookingDatabase } from './database.ts';\n"
  : "export function connectBookingDatabase() { throw new Error('PostgreSQL is disabled in this Pages build'); }\n";

await writeFile(new URL('../src/pages-driver.generated.mjs', import.meta.url), source);
