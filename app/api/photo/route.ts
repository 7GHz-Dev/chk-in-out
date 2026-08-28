import { canViewAllAttendance, currentUser, jsonError } from "@/lib/auth";
import { ensureDatabase, getBindings } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!key.startsWith("attendance/") || key.includes("..")) return jsonError("invalid_photo_key");

  const { db, photos } = getBindings();
  const record = await db.prepare(`SELECT user_id FROM attendance
    WHERE check_in_photo_key = ? OR check_out_photo_key = ? LIMIT 1`).bind(key, key).first<{ user_id: string }>();
  if (!record) return jsonError("photo_not_found", 404);
  if (record.user_id !== user.id && !canViewAllAttendance(user.role)) return jsonError("forbidden", 403);

  const object = await photos.get(key);
  if (!object) return jsonError("photo_not_found", 404);
  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}
