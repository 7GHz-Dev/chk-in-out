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
