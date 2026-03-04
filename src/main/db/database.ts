import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

const DB_VERSION = 4;

function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'berkeley-calendar.db');
}

export function initDatabase(): void {
  const dbPath = getDbPath();

  // Ensure directory exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null } | undefined;
  const currentVersion = row?.v ?? 0;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sent_reminders (
        assignment_id TEXT NOT NULL,
        source TEXT NOT NULL,
        threshold TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (assignment_id, source, threshold)
      );

      CREATE TABLE IF NOT EXISTS completed_assignments (
        assignment_id TEXT NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (assignment_id, source)
      );

      INSERT OR REPLACE INTO schema_version (version) VALUES (1);
    `);
  }

  if (currentVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dismissed_submissions (
        assignment_id TEXT NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (assignment_id, source)
      );

      INSERT OR REPLACE INTO schema_version (version) VALUES (2);
    `);
  }

  if (currentVersion < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        color TEXT,
        all_day INTEGER NOT NULL DEFAULT 0,
        location TEXT,
        google_event_id TEXT,
        google_calendar_id TEXT,
        etag TEXT,
        source TEXT NOT NULL DEFAULT 'local',
        last_synced_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_events_time ON events (start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_events_google_id ON events (google_event_id);

      CREATE TABLE IF NOT EXISTS google_sync_state (
        calendar_id TEXT PRIMARY KEY,
        sync_token TEXT,
        last_full_sync TEXT
      );

      CREATE TABLE IF NOT EXISTS google_auth_tokens (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expiry_date INTEGER NOT NULL,
        scope TEXT
      );

      INSERT OR REPLACE INTO schema_version (version) VALUES (3);
    `);
  }

  if (currentVersion < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assignment_calendar_entries (
        assignment_id TEXT NOT NULL,
        source TEXT NOT NULL,
        google_event_id TEXT,
        removed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (assignment_id, source)
      );

      INSERT OR REPLACE INTO schema_version (version) VALUES (4);
    `);
  }
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
