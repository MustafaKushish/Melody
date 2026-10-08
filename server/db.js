import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './config.js';

if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    pass_hash     TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    trial_ends    INTEGER NOT NULL DEFAULT 0,
    premium_until INTEGER NOT NULL DEFAULT 0,
    plan          TEXT,
    stripe_customer TEXT,
    stripe_sub    TEXT,
    sub_status    TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    code          TEXT PRIMARY KEY,
    months        INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    buyer_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    stripe_session TEXT UNIQUE,
    redeemed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    reference    TEXT,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_usage (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );

  CREATE TABLE IF NOT EXISTS preset_choice (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preset  TEXT NOT NULL,
    at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lyrics_cache (
    key        TEXT PRIMARY KEY,
    json       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`);

// Additive migrations for existing databases.
const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const [col, def] of [
  ['student_status', "TEXT NOT NULL DEFAULT 'none'"],
  ['student_type', 'TEXT'],
  ['student_school', 'TEXT'],
  ['student_valid_until', 'INTEGER NOT NULL DEFAULT 0'],
  ['student_requested_at', 'INTEGER'],
]) {
  if (!userCols.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
}

export const now = () => Date.now();

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
