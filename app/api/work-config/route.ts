import { currentUser, jsonError, jsonOk } from "@/lib/auth";
import { callGoogleBackend } from "@/lib/google-backend";

export const dynamic = "force-dynamic";

export type WorkSettings = { work_start: string; work_end: string; late_grace_minutes: string };
export type PayrollEntry = { user_id: string; salary: number; trip_rate: number; deduction: number; note: string; updated_at: string };
type WorkConfig = { settings: WorkSettings; payroll: PayrollEntry[] };

const DEFAULT_SETTINGS: WorkSettings = { work_start: "08:30", work_end: "17:30", late_grace_minutes: "10" };

// Apps Script รุ่นก่อนยังไม่รู้จัก action พวกนี้ — ถือว่า "ยังไม่ได้อัปเดตหลังบ้าน" ไม่ใช่ระบบพัง
const NOT_DEPLOYED = new Set(["invalid_action", "sheet_not_found"]);

function isNotDeployed(error: unknown) {
  return error instanceof Error && NOT_DEPLOYED.has(error.message);
}

function cleanTime(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function cleanMinutes(value: unknown, fallback: string) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 240 ? String(Math.round(number)) : fallback;
}

function cleanAmount(value: unknown, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) return null;
  return Math.round(number * 100) / 100;
}

function normalize(config: Partial<WorkConfig> | null): WorkConfig {
  const settings = config?.settings || ({} as Partial<WorkSettings>);
  return {
    settings: {
      work_start: cleanTime(settings.work_start, DEFAULT_SETTINGS.work_start),
      work_end: cleanTime(settings.work_end, DEFAULT_SETTINGS.work_end),
      late_grace_minutes: cleanMinutes(settings.late_grace_minutes, DEFAULT_SETTINGS.late_grace_minutes),
    },
    payroll: Array.isArray(config?.payroll) ? config.payroll : [],
  };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  if (user.role !== "admin" && user.role !== "hr") return jsonError("forbidden", 403);

  try {
    const config = await callGoogleBackend<WorkConfig>("getWorkConfig");
    return jsonOk({ ...normalize(config), backendReady: true });
  } catch (error) {
    if (isNotDeployed(error)) return jsonOk({ ...normalize(null), backendReady: false });
    return jsonError(error instanceof Error ? error.message : "backend_error", 503);
  }
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);
  if (user.role !== "admin") return jsonError("forbidden", 403);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  try {
    if (body.settings) {
      const supplied = body.settings as Partial<WorkSettings>;
      const settings: WorkSettings = {
        work_start: cleanTime(supplied.work_start, ""),
        work_end: cleanTime(supplied.work_end, ""),
        late_grace_minutes: cleanMinutes(supplied.late_grace_minutes, ""),
      };
      if (!settings.work_start || !settings.work_end) return jsonError("invalid_work_time");
      if (!settings.late_grace_minutes) return jsonError("invalid_grace_minutes");
      if (settings.work_end <= settings.work_start) return jsonError("work_end_before_start");
      const config = await callGoogleBackend<WorkConfig>("saveWorkSettings", { settings });
      return jsonOk({ ...normalize(config), backendReady: true });
    }

    if (body.payroll) {
      const supplied = body.payroll as Partial<PayrollEntry>;
      const userId = String(supplied.user_id || "").trim();
      const salary = cleanAmount(supplied.salary, 100_000_000);
      const tripRate = cleanAmount(supplied.trip_rate, 1_000_000);
      const deduction = cleanAmount(supplied.deduction, 100_000_000);
      if (!userId) return jsonError("invalid_payroll_user");
      if (salary === null || tripRate === null || deduction === null) return jsonError("invalid_payroll_amount");
      const config = await callGoogleBackend<WorkConfig>("savePayroll", {
        payroll: { user_id: userId, salary, trip_rate: tripRate, deduction, note: String(supplied.note || "").slice(0, 300) },
      });
      return jsonOk({ ...normalize(config), backendReady: true });
    }

    return jsonError("bad_request");
  } catch (error) {
    if (isNotDeployed(error)) return jsonError("work_config_not_deployed", 503);
    return jsonError(error instanceof Error ? error.message : "backend_error", 503);
  }
}
