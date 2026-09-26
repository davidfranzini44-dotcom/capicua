// Database connection for the edge functions.
//
// Every running copy of a function used to open its own direct Postgres
// connection and keep it until the copy was recycled, so one busy table filled
// all 60 database slots ("remaining connection slots are reserved…"). Going
// through Supabase's transaction pooler lets every copy share a small pool of
// real connections; the direct address is only a fallback.

import postgres from 'npm:postgres@3.4.5';

const DIRECT = Deno.env.get('SUPABASE_DB_URL')!;
/** Where the database lives (picks the pooler host) — not where the function runs. */
const DB_REGION = 'us-east-1';
const OPTIONS = { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 5 };

/**
 * Transaction-pooler addresses for this project. The shared pooler runs on one
 * of two clusters; capicua is on aws-0 (checked 2026-09-25), so it goes first —
 * almost every request starts a fresh copy of the function, and each wrong
 * guess costs a round trip.
 */
function poolerUrls(direct: string): string[] {
  const m = direct.match(/^(postgres(?:ql)?:\/\/)[^:@/]+:([^@]*)@db\.([a-z0-9]+)\.supabase\.co(?::\d+)?(\/.*)?$/);
  if (!m) return [];
  const [, scheme, password, ref, rest = '/postgres'] = m;
  return ['aws-0', 'aws-1'].map((cluster) => `${scheme}postgres.${ref}:${password}@${cluster}-${DB_REGION}.pooler.supabase.com:6543${rest}`);
}

// Only ever log the host: the URLs carry the database password.
const hostOf = (url: string) => url.replace(/^.*@/, '').replace(/[:/].*$/, '');

async function connect(): Promise<postgres.Sql> {
  for (const url of [...poolerUrls(DIRECT), DIRECT]) {
    const sql = postgres(url, OPTIONS);
    try {
      await sql`select 1`;
      console.log('db connected via', hostOf(url));
      return sql;
    } catch (e) {
      console.warn('db connect failed via', hostOf(url), (e as Error).message);
      await sql.end({ timeout: 0 });
    }
  }
  throw new Error('db_unavailable');
}

let pending: Promise<postgres.Sql> | null = null;

/** This copy's shared connection, opened on first use. */
export function db(): Promise<postgres.Sql> {
  pending ??= connect().catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}
