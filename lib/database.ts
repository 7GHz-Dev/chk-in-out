import { env } from "cloudflare:workers";

export const ROLES = ["user", "admin", "hr", "employee-driver", "employee-office"] as const;
export type Role = (typeof ROLES)[number];

type QueryResult<T = Record<string, unknown>> = {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number };
};

export type PreparedStatement = {
  bind(...values: unknown[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
};

export type Database = {
  prepare(query: string): PreparedStatement;
  batch<T = Record<string, unknown>>(statements: PreparedStatement[]): Promise<QueryResult<T>[]>;
};

type PhotoObject = {
  body: ReadableStream;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
};

export type PhotoBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<PhotoObject | null>;
  delete(key: string): Promise<void>;
};

export function getBindings() {
  const bindings = env as unknown as { DB?: Database; PHOTOS?: PhotoBucket };
  if (!bindings.DB) throw new Error("database_unavailable");
  if (!bindings.PHOTOS) throw new Error("photo_storage_unavailable");
  return { db: bindings.DB, photos: bindings.PHOTOS };
}

let schemaPromise: Promise<void> | null = null;

export async function ensureDatabase() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    const { db } = getBindings();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','hr','employee-driver','employee-office')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        work_date TEXT NOT NULL,
        check_in_at TEXT NOT NULL,
        check_in_device_at TEXT NOT NULL DEFAULT '',
        check_in_lat REAL NOT NULL,
        check_in_lng REAL NOT NULL,
        check_in_accuracy REAL NOT NULL DEFAULT 0,
        check_in_photo_key TEXT NOT NULL,
        check_out_at TEXT,
        check_out_device_at TEXT,
        check_out_lat REAL,
        check_out_lng REAL,
        check_out_accuracy REAL,
        check_out_photo_key TEXT
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_users_active_role ON users(active, role)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at)"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, work_date)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_attendance_work_date ON attendance(work_date DESC)"),
    ]);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

export function bangkokDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function normalizeRole(value: unknown): Role {
  const role = String(value || "user").trim().toLowerCase().replaceAll("_", "-");
  if (role === "employee-shipping" || role === "shipping" || role === "driver") return "employee-driver";
  if (role === "office") return "employee-office";
  return ROLES.includes(role as Role) ? role as Role : "user";
}
