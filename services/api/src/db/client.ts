import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema.js';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export type Db = ReturnType<typeof drizzle<typeof schema>>;
/** A transaction handle; same query API as `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface OpenDb {
  db: Db;
  close: () => void;
}

const writeQueues = new WeakMap<Db, Promise<unknown>>();

/** Message plus the driver's underlying cause, for matching SQLite error kinds. */
export function sqliteErrorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return e.cause instanceof Error ? `${e.message} ${e.cause.message}` : e.message;
}

const isBusy = (e: unknown): boolean => /SQLITE_BUSY|database is locked/i.test(sqliteErrorText(e));

/**
 * Runs a write transaction. SQLite allows one writer at a time, and libsql opens a fresh
 * connection per transaction (which doesn't inherit `busy_timeout`), so concurrent writers
 * in this process are queued, and a lock held by another process is retried briefly.
 * Postgres (prod) won't need the queue; the call sites stay the same.
 */
export function writeTransaction<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.transaction(work);
      } catch (e) {
        if (!isBusy(e) || attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
      }
    }
  };
  const previous = writeQueues.get(db) ?? Promise.resolve();
  const next = previous.then(run, run);
  // Keep the chain alive regardless of this write's outcome.
  writeQueues.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}

/** Opens (and migrates) a SQLite database. `url` is a libsql URL, e.g. `file:data/myna.db`. */
export async function openDb(url: string): Promise<OpenDb> {
  const client = createClient({ url });
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA busy_timeout = 5000');
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    db,
    close: () => {
      client.close();
    },
  };
}
