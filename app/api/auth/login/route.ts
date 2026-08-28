import { createSession, hashPassword, jsonError, jsonOk, passwordsMatch, setSessionCookie, type StoredUser } from "@/lib/auth";
import { callGoogleBackend } from "@/lib/google-backend";
import { normalizeRole } from "@/lib/database";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return jsonError("missing_credentials");

  try {
    const { user } = await callGoogleBackend<{ user: StoredUser | null }>("findUser", { username });
    if (!user || !passwordsMatch(await hashPassword(password, user.passwordSalt), user.passwordHash)) {
      return jsonError("invalid_credentials", 401);
    }
    if (!user.active) return jsonError("account_disabled", 403);
    const token = await createSession(user.id);
    return setSessionCookie(jsonOk({
      user: { id: user.id, username: user.username, name: user.name, role: normalizeRole(user.role), active: true },
    }), request, token);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "backend_error", 503);
  }
}
