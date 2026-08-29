import { backendErrorStatus, canViewAllAttendance, currentUser, jsonError, jsonOk } from "@/lib/auth";
import { callGoogleBackend } from "@/lib/google-backend";

export const dynamic = "force-dynamic";

type AttendanceRow = {
  id: string;
  user_id: string;
  username: string;
  name: string;
  role: string;
  work_date: string;
  check_in_at: string;
  check_in_lat: number;
  check_in_lng: number;
  check_in_accuracy: number;
  check_in_file_id: string;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_accuracy: number | null;
  check_out_file_id: string | null;
};

function publicAttendance(row: AttendanceRow) {
  const { check_in_file_id, check_out_file_id, ...safe } = row;
  return {
    ...safe,
    check_in_photo_url: `/api/photo?id=${encodeURIComponent(check_in_file_id)}`,
    check_out_photo_url: check_out_file_id ? `/api/photo?id=${encodeURIComponent(check_out_file_id)}` : null,
  };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  const url = new URL(request.url);
  const all = canViewAllAttendance(user.role) && url.searchParams.get("scope") === "all";
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const limit = all && Number.isFinite(requestedLimit) ? Math.max(1, Math.min(5000, requestedLimit)) : all ? 250 : 120;
  try {
    const result = await callGoogleBackend<{ rows: AttendanceRow[]; today: AttendanceRow | null }>("listAttendance", {
      userId: all ? "" : user.id,
      todayUserId: user.id,
      limit,
    });
    return jsonOk({
      rows: (result.rows || []).map(publicAttendance),
      today: result.today ? publicAttendance(result.today) : null,
      scope: all ? "all" : "mine",
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "backend_error", 503);
  }
}

function finiteNumber(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function POST(request: Request) {
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

  try {
    const result = await callGoogleBackend<{ attendanceAction: string; workDate: string }>("recordAttendance", {
      attendanceAction: action,
      userId: user.id,
      photoBase64: Buffer.from(await photo.arrayBuffer()).toString("base64"),
      mimeType: photo.type,
      lat,
      lng,
      accuracy,
      deviceTime: String(form.get("device_time") || ""),
    });
    return jsonOk({ action: result.attendanceAction, workDate: result.workDate }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "backend_error";
    return jsonError(message, backendErrorStatus(message));
  }
}

function bangkokLocalToIso(value: unknown) {
  const local = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  if (user.role !== "hr") return jsonError("forbidden", 403);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = String(body.id || "").trim();
  const checkInAt = bangkokLocalToIso(body.checkInAt);
  const hasCheckOut = typeof body.checkOutAt === "string" && body.checkOutAt !== "";
  const checkOutAt = hasCheckOut ? bangkokLocalToIso(body.checkOutAt) : null;
  if (!id || !checkInAt || (hasCheckOut && !checkOutAt)) return jsonError("invalid_datetime");
  if (checkOutAt && new Date(checkOutAt) < new Date(checkInAt)) return jsonError("check_out_before_check_in");

  try {
    await callGoogleBackend("updateAttendance", {
      id,
      checkInAt,
      ...(checkOutAt ? { checkOutAt } : {}),
    });
    return jsonOk();
  } catch (error) {
    const message = error instanceof Error ? error.message : "backend_error";
    return jsonError(message, backendErrorStatus(message));
  }
}
