import { canViewAllAttendance, currentUser, jsonError } from "@/lib/auth";
import { callGoogleBackend } from "@/lib/google-backend";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  const fileId = new URL(request.url).searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return jsonError("invalid_photo_key");

  try {
    const result = await callGoogleBackend<{ ownerUserId: string; mimeType: string; base64: string }>("getPhoto", { fileId });
    if (result.ownerUserId !== user.id && !canViewAllAttendance(user.role)) return jsonError("forbidden", 403);
    return new Response(Buffer.from(result.base64, "base64"), {
      headers: {
        "Content-Type": result.mimeType || "image/jpeg",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "backend_error";
    return jsonError(message, message === "photo_not_found" ? 404 : 503);
  }
}
