import { bangkokDate, ensureDatabase, getBindings } from "@/lib/database";
import { canViewAllAttendance, currentUser, jsonError, jsonOk } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AttendanceRow = {
  id: string;
  user_id: string;
  username: string;
  name: string;
  role: string;
  work_date: string;
  check_in_at: string;
  check_in_device_at: string;
  check_in_lat: number;
  check_in_lng: number;
  check_in_accuracy: number;
  check_in_photo_key: string;
  check_out_at: string | null;
  check_out_device_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_accuracy: number | null;
  check_out_photo_key: string | null;
};

const selectAttendance = `SELECT
  a.id, a.user_id, u.username, u.name, u.role, a.work_date,
  a.check_in_at, a.check_in_device_at, a.check_in_lat, a.check_in_lng,
  a.check_in_accuracy, a.check_in_photo_key,
  a.check_out_at, a.check_out_device_at, a.check_out_lat, a.check_out_lng,
  a.check_out_accuracy, a.check_out_photo_key
  FROM attendance a JOIN users u ON u.id = a.user_id`;

function publicAttendance(row: AttendanceRow) {
  return {
    ...row,
    check_in_photo_url: `/api/photo?key=${encodeURIComponent(row.check_in_photo_key)}`,
    check_out_photo_url: row.check_out_photo_key
      ? `/api/photo?key=${encodeURIComponent(row.check_out_photo_key)}`
      : null,
    check_in_photo_key: undefined,
    check_out_photo_key: undefined,
  };
}

export async function GET(request: Request) {
  await ensureDatabase();
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  const { db } = getBindings();
  const all = canViewAllAttendance(user.role) && new URL(request.url).searchParams.get("scope") === "all";
  const query = all
    ? db.prepare(`${selectAttendance} ORDER BY a.work_date DESC, a.check_in_at DESC LIMIT 250`)
    : db.prepare(`${selectAttendance} WHERE a.user_id = ? ORDER BY a.work_date DESC LIMIT 120`).bind(user.id);
  const result = await query.all<AttendanceRow>();
  const today = await db.prepare(`${selectAttendance} WHERE a.user_id = ? AND a.work_date = ? LIMIT 1`)
    .bind(user.id, bangkokDate()).first<AttendanceRow>();
  return jsonOk({
    rows: (result.results || []).map(publicAttendance),
    today: today ? publicAttendance(today) : null,
    scope: all ? "all" : "mine",
  });
}

function photoExtension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function finiteNumber(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);

  const form = await request.formData();
  const action = String(form.get("action") || "");
  if (action !== "check-in" && action !== "check-out") return jsonError("invalid_action");

  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return jsonError("photo_required");
  if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) return jsonError("invalid_photo_type");
  if (photo.size > 8 * 1024 * 1024) return jsonError("photo_too_large");

  const lat = finiteNumber(form.get("lat"));
  const lng = finiteNumber(form.get("lng"));
  const accuracy = Math.max(0, finiteNumber(form.get("accuracy")) || 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return jsonError("location_required");
  }

  const { db, photos } = getBindings();
  const workDate = bangkokDate();
  const existing = await db.prepare("SELECT id, check_out_at FROM attendance WHERE user_id = ? AND work_date = ? LIMIT 1")
    .bind(user.id, workDate).first<{ id: string; check_out_at: string | null }>();
  if (action === "check-in" && existing) return jsonError("already_checked_in", 409);
  if (action === "check-out" && !existing) return jsonError("check_in_first", 409);
  if (action === "check-out" && existing?.check_out_at) return jsonError("already_checked_out", 409);

  const now = new Date().toISOString();
  const safeAction = action === "check-in" ? "in" : "out";
  const key = `attendance/${user.id}/${workDate}/${safeAction}-${Date.now()}.${photoExtension(photo.type)}`;
  await photos.put(key, await photo.arrayBuffer(), {
    httpMetadata: { contentType: photo.type },
    customMetadata: { userId: user.id, action, workDate },
  });

  try {
    if (action === "check-in") {
      await db.prepare(`INSERT INTO attendance (
        id, user_id, work_date, check_in_at, check_in_device_at,
        check_in_lat, check_in_lng, check_in_accuracy, check_in_photo_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        crypto.randomUUID(), user.id, workDate, now, String(form.get("device_time") || ""),
        lat, lng, accuracy, key,
      ).run();
    } else {
      const result = await db.prepare(`UPDATE attendance SET
        check_out_at = ?, check_out_device_at = ?, check_out_lat = ?,
        check_out_lng = ?, check_out_accuracy = ?, check_out_photo_key = ?
        WHERE id = ? AND check_out_at IS NULL`).bind(
        now, String(form.get("device_time") || ""), lat, lng, accuracy, key, existing?.id,
      ).run();
      if (Number(result.meta?.changes || 0) !== 1) throw new Error("attendance_update_conflict");
    }
  } catch (error) {
    await photos.delete(key);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return jsonError("already_checked_in", 409);
    throw error;
  }

  return jsonOk({ action, workDate }, 201);
}
