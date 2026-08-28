import { backendErrorStatus, createSession, hashPassword, jsonError, jsonOk, randomHex, setSessionCookie, type AppUser } from "@/lib/auth";
import { callGoogleBackend } from "@/lib/google-backend";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const username = String(body.username || "").trim();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (username.length < 3 || !/^[A-Za-z0-9._-]+$/.test(username)) return jsonError("invalid_username");
  if (name.length < 2) return jsonError("invalid_name");
  if (password.length < 8) return jsonError("password_too_short");

  try {
    const id = crypto.randomUUID();
    const salt = randomHex(16);
    const now = new Date().toISOString();
    const result = await callGoogleBackend<{ user: AppUser }>("createFirstAdmin", {
      user: { id, username, name, role: "admin", passwordHash: await hashPassword(password, salt), passwordSalt: salt, createdAt: now, updatedAt: now },
    });
    const token = await createSession(id);
    return setSessionCookie(jsonOk({ user: result.user }, 201), request, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "backend_error";
    return jsonError(message, backendErrorStatus(message));
  }
}
