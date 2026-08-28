import { createSession, hashPassword, jsonError, jsonOk, randomHex, setSessionCookie } from "@/lib/auth";
import { ensureDatabase, getBindings } from "@/lib/database";

export async function POST(request: Request) {
  await ensureDatabase();
  const { db } = getBindings();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if (Number(count?.count || 0) > 0) return jsonError("setup_already_complete", 409);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const username = String(body.username || "").trim();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (username.length < 3 || !/^[A-Za-z0-9._-]+$/.test(username)) return jsonError("invalid_username");
  if (name.length < 2) return jsonError("invalid_name");
  if (password.length < 8) return jsonError("password_too_short");

  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const now = new Date().toISOString();
  const inserted = await db.prepare(`INSERT INTO users
    (id, username, password_hash, password_salt, name, role, active, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, 'admin', 1, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM users)`)
    .bind(id, username, await hashPassword(password, salt), salt, name, now, now).run();
  if (Number(inserted.meta?.changes || 0) !== 1) return jsonError("setup_already_complete", 409);

  const token = await createSession(id);
  return setSessionCookie(jsonOk({
    user: { id, username, name, role: "admin", active: true },
  }, 201), request, token);
}
