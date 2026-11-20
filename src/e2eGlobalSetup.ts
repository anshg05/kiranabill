import { Client } from "pg";

// SG-20 (D121): the migration starts sign-ups in ALLOWLIST mode (production). Every e2e file signs up throwaway *.local users and makes
// them a shop, so the LOCAL stack runs open; voiceLimits.e2e.test.ts tests the allowlist inside rolled-back transactions. Local only.
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export default async function setup(): Promise<void> {
  const pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  try {
    await pg.query(`update app_limits set signup_mode = 'open'`);
  } finally {
    await pg.end();
  }
}
