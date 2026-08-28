import { createSession, hashPassword, jsonError, jsonOk, passwordsMatch, setSessionCookie } from "@/lib/auth";
import { ensureDatabase, getBindings, normalizeRole } from "@/lib/database";

type LoginRow = {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  name: string;
  role: string;
  active: number;
};

export async function POST(request: Request) {
  await ensureDatabase();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return jsonError("missing_credentials");

  const { db } = getBindings();
  const row = await db.prepare(`SELECT id, username, password_hash, password_salt, name, role, active
    FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`).bind(username).first<LoginRow>();
  if (!row || !passwordsMatch(await hashPassword(password, row.password_salt), row.password_hash)) {
    return jsonError("invalid_credentials", 401);
  }
  if (!row.active) return jsonError("account_disabled", 403);

  const token = await createSession(row.id);
  return setSessionCookie(jsonOk({
    user: { id: row.id, username: row.username, name: row.name, role: normalizeRole(row.role), active: true },
  }), request, token);
}
