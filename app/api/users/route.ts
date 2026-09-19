import { backendErrorStatus, currentUser, hashPassword, jsonError, jsonOk, randomHex, type AppUser } from "@/lib/auth";
import { normalizeRole, ROLES } from "@/lib/database";
import { callGoogleBackend } from "@/lib/google-backend";

type ManagedUser = AppUser & { createdAt: string };

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  if (user.role !== "admin") return jsonError("forbidden", 403);
  try {
    const result = await callGoogleBackend<{ users: ManagedUser[] }>("listUsers");
    return jsonOk({ users: result.users || [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "backend_error", 503);
  }
}

export async function POST(request: Request) {
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

  try {
    const id = crypto.randomUUID();
    const salt = randomHex(16);
    const now = new Date().toISOString();
    const result = await callGoogleBackend<{ user: ManagedUser }>("createUser", {
      user: { id, username, name, role, passwordHash: await hashPassword(password, salt), passwordSalt: salt, createdAt: now, updatedAt: now },
    });
    return jsonOk({ user: result.user }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "backend_error";
    return jsonError(message, backendErrorStatus(message));
  }
}

/** แก้ไขบัญชีที่มีอยู่ — ส่งมาเฉพาะช่องที่ต้องการเปลี่ยน ช่องที่ไม่ส่งจะคงค่าเดิม */
export async function PATCH(request: Request) {
  const admin = await currentUser(request);
  if (!admin) return jsonError("unauthorized", 401);
  if (admin.role !== "admin") return jsonError("forbidden", 403);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = String(body.id || "").trim();
  if (!id) return jsonError("invalid_user");

  const changes: Record<string, unknown> = { id };

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) return jsonError("invalid_name");
    changes.name = name;
  }

  if (body.role !== undefined) {
    const requestedRole = String(body.role).trim().toLowerCase().replaceAll("_", "-");
    if (![...ROLES, "employee-shipping", "shipping", "driver", "office"].includes(requestedRole as typeof ROLES[number])) {
      return jsonError("invalid_role");
    }
    changes.role = normalizeRole(requestedRole);
  }

  if (body.password !== undefined) {
    const password = String(body.password);
    if (password.length < 8) return jsonError("password_too_short");
    const salt = randomHex(16);
    changes.passwordSalt = salt;
    changes.passwordHash = await hashPassword(password, salt);
  }

  if (Object.keys(changes).length === 1) return jsonError("nothing_to_update");

  try {
    const result = await callGoogleBackend<{ user: ManagedUser }>("updateUser", { user: changes });
    return jsonOk({ user: result.user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "backend_error";
    return jsonError(message, backendErrorStatus(message));
  }
}

/** ปิดใช้งานบัญชี (หรือเปิดกลับด้วย `active: true`) — แถวยังอยู่ ประวัติลงเวลาเดิมจึงไม่กำพร้า */
export async function DELETE(request: Request) {
  const admin = await currentUser(request);
  if (!admin) return jsonError("unauthorized", 401);
  if (admin.role !== "admin") return jsonError("forbidden", 403);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const userId = String(body.id || "").trim();
  if (!userId) return jsonError("invalid_user");
  const active = body.active === true;
  if (!active && userId === admin.id) return jsonError("cannot_disable_self");

  try {
    const result = await callGoogleBackend<{ user: ManagedUser }>("setUserActive", { userId, active });
    return jsonOk({ user: result.user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "backend_error";
    return jsonError(message, backendErrorStatus(message));
  }
}
