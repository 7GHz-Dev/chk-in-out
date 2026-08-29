import { currentUser, jsonError, jsonOk } from "@/lib/auth";
import { callGoogleBackend } from "@/lib/google-backend";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const [{ userCount }, user] = await Promise.all([
      callGoogleBackend<{ userCount: number }>("status"),
      currentUser(request),
    ]);
    return jsonOk({
      needsSetup: Number(userCount || 0) === 0,
      user,
      // หน้าเว็บใช้ค่านี้เลือกว่าจะวาด thumbnail จากภาพ Google หรือจากไทล์ OpenStreetMap
      mapProvider: process.env.GOOGLE_MAPS_API_KEY ? "google" : "osm",
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "backend_error", 503);
  }
}
