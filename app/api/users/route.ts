import { currentUser, hashPassword, jsonError, jsonOk, randomHex } from "@/lib/auth";
import { ensureDatabase, getBindings, normalizeRole, ROLES } from "@/lib/database";

type UserListRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  active: number;
  created_at: string;
};

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  if (user.role !== "admin") return jsonError("forbidden", 403);
  const { db } = getBindings();
  const result = await db.prepare(`SELECT id, username, name, role, active, created_at
    FROM users ORDER BY active DESC, name COLLATE NOCASE`).all<UserListRow>();
  return jsonOk({
    users: (result.results || []).map((row) => ({
      id: row.id,
      username: row.username,
      name: row.name,
      role: normalizeRole(row.role),
      active: Boolean(row.active),
      createdAt: row.created_at,
    })),
  });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const admin = await currentUser(request);
  if (!admin) return jsonError("unauthorized", 401);
  if (admin.role !== "admin") return jsonError("forbidden", 403);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const username = String(body.username || "").trim();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  const requestedRole = String(body.role || "").trim().toLowerCase().replaceAll("_", "-");
  if (![...ROLES, "employee-shipping", "shipping", "driver", "office"].includes(requestedRole as typeof ROLES[number])) {
    return jsonError("invalid_role");
  }
  const role = normalizeRole(requestedRole);
  if (username.length < 3 || !/^[A-Za-z0-9._-]+$/.test(username)) return jsonError("invalid_username");
  if (name.length < 2) return jsonError("invalid_name");
  if (password.length < 8) return jsonError("password_too_short");

  const { db } = getBindings();
  const duplicate = await db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
    .bind(username).first();
  if (duplicate) return jsonError("username_exists", 409);

  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO users
    (id, username, password_hash, password_salt, name, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(
      id, username, await hashPassword(password, salt), salt, name, role, now, now,
    ).run();
  return jsonOk({ user: { id, username, name, role, active: true, createdAt: now } }, 201);
}
