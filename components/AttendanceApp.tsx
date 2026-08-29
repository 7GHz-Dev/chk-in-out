"use client";

import { CSSProperties, createContext, FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type Role = "user" | "admin" | "hr" | "employee-driver" | "employee-office";
type AppUser = { id: string; username: string; name: string; role: Role; active: boolean };
type ManagedUser = AppUser & { createdAt: string };
type LocationData = { lat: number; lng: number; accuracy: number };
type Attendance = {
  id: string;
  user_id: string;
  username: string;
  name: string;
  role: Role;
  work_date: string;
  check_in_at: string;
  check_in_lat: number;
  check_in_lng: number;
  check_in_accuracy: number;
  check_in_photo_url: string;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_accuracy: number | null;
  check_out_photo_url: string | null;
};

type ApiResponse = Record<string, unknown> & { ok?: boolean; error?: string };
type View = "today" | "history" | "report" | "users";
type LocationHelp = { href: string | null; instructions: string };
type ReportStatus = "all" | "complete" | "open";

const REPORT_PAGE_SIZE = 25;

type MapProvider = "google" | "osm";
const MapProviderContext = createContext<MapProvider>("osm");

// ขนาดภาพแผนที่ (พิกเซล) — ส่งให้ Static Maps ตรง ๆ และใช้กำหนดกรอบใน CSS ด้วย
const MAP_SIZES = {
  card: { width: 320, height: 190 },
  table: { width: 244, height: 152 },
} as const;

const roleLabels: Record<Role, string> = {
  user: "ผู้ใช้งาน",
  admin: "ผู้ดูแลระบบ",
  hr: "ฝ่ายบุคคล",
  "employee-driver": "พนักงานขับรถ",
  "employee-office": "พนักงานออฟฟิศ",
};

const errorLabels: Record<string, string> = {
  missing_credentials: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน",
  invalid_credentials: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  account_disabled: "บัญชีนี้ถูกปิดการใช้งาน",
  invalid_username: "ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัว และใช้เฉพาะ a-z, 0-9, จุด ขีดกลาง หรือขีดล่าง",
  invalid_name: "กรุณากรอกชื่อที่ใช้แสดง",
  password_too_short: "รหัสผ่านต้องมีอย่างน้อย 8 ตัว",
  username_exists: "ชื่อผู้ใช้นี้มีอยู่แล้ว",
  photo_required: "กรุณาถ่ายรูปก่อนบันทึกเวลา",
  invalid_photo_type: "รองรับเฉพาะรูป JPG, PNG หรือ WebP",
  photo_too_large: "รูปมีขนาดใหญ่เกิน 8 MB",
  location_required: "ไม่สามารถอ่านตำแหน่งได้ กรุณาอนุญาต GPS แล้วลองใหม่",
  location_denied: "กรุณาเปิดบริการตำแหน่งและอนุญาตให้เบราว์เซอร์เข้าถึงตำแหน่ง (iPhone: การตั้งค่า > ความเป็นส่วนตัว > บริการหาตำแหน่ง, Android: การตั้งค่าเว็บไซต์ > ตำแหน่ง)",
  location_timeout: "ยังหาตำแหน่งไม่สำเร็จ กรุณาเปิด GPS ออกไปอยู่ในที่โล่ง แล้วแตะตรวจสอบตำแหน่งอีกครั้ง",
  location_https_required: "การตรวจสอบตำแหน่งใช้งานได้ผ่านเว็บไซต์ HTTPS เท่านั้น",
  line_browser_location: "กรุณาเปิดผ่าน Chrome หรือ Safari เพื่อให้ระบบอ่าน GPS ได้แน่นอน",
  already_checked_in: "วันนี้บันทึกเข้างานแล้ว",
  already_checked_out: "วันนี้บันทึกเลิกงานแล้ว",
  check_in_first: "กรุณาบันทึกเข้างานก่อน",
  unauthorized: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
  invalid_datetime: "วันที่หรือเวลาไม่ถูกต้อง",
  check_out_before_check_in: "เวลาเลิกงานต้องอยู่หลังเวลาเข้างาน",
  attendance_not_found: "ไม่พบรายการลงเวลานี้",
  duplicate_work_date: "พนักงานคนนี้มีรายการในวันที่เลือกอยู่แล้ว",
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  const data = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok || data.ok === false) throw new Error(data.error || "request_failed");
  return data;
}

function thaiError(error: unknown) {
  const key = error instanceof Error ? error.message : "request_failed";
  return errorLabels[key] || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}

function errorKey(error: unknown) {
  return error instanceof Error ? error.message : "request_failed";
}

function isLocationError(error: unknown) {
  return ["location_required", "location_denied", "location_timeout", "location_https_required", "line_browser_location"].includes(errorKey(error));
}

function locationHelpForDevice(): LocationHelp {
  const userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) {
    return {
      href: "intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end",
      instructions: "Android: เปิดตำแหน่ง (GPS) แล้วกลับมาที่ Chrome แตะไอคอนแม่กุญแจข้างที่อยู่เว็บ > สิทธิ์ > ตำแหน่ง > อนุญาต",
    };
  }
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return {
      href: "App-Prefs:Privacy&path=LOCATION",
      instructions: "iPhone/iPad: การตั้งค่า > ความเป็นส่วนตัวและความปลอดภัย > บริการหาตำแหน่ง > Safari Websites > ขณะใช้แอป และเปิดตำแหน่งที่ตั้งจริง",
    };
  }
  return {
    href: null,
    instructions: "เปิดบริการตำแหน่งของเครื่อง แล้วอนุญาตตำแหน่งให้เว็บไซต์นี้จากไอคอนข้างช่องที่อยู่ของเบราว์เซอร์",
  };
}

function isLineBrowser() {
  return /\bLine\/[\d.]+/i.test(navigator.userAgent);
}

function externalBrowserUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("openInAppBrowser");
  url.searchParams.set("openExternalBrowser", "1");
  return url.toString();
}

function attendanceDate(value: string) {
  const source = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+07:00` : value;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// ทั้งแอปใช้ dd/mm/yyyy ปี ค.ศ. — en-GB ให้รูปแบบนี้ตรง ๆ และไม่แปลงเป็น พ.ศ. แบบ th-TH
function formatDate(value: string) {
  const date = attendanceDate(value);
  if (!date) return value || "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatWeekdayDate(date: Date) {
  const weekday = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "Asia/Bangkok", weekday: "long" }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(date);
  return `${weekday} ${day}`;
}

function formatDay(value: string) {
  const date = attendanceDate(value);
  return date ? new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "Asia/Bangkok" }).format(date) : "—";
}

function formatMonth(value: string) {
  const date = attendanceDate(value);
  return date ? new Intl.DateTimeFormat("th-TH", { month: "short", timeZone: "Asia/Bangkok" }).format(date) : "—";
}

function mapUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function bangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: value.year, month: value.month, day: value.day };
}

function currentMonthRange() {
  const { year, month } = bangkokDateParts();
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(lastDay).padStart(2, "0")}` };
}

function workHours(record: Attendance) {
  if (!record.check_out_at) return null;
  const start = new Date(record.check_in_at).getTime();
  const end = new Date(record.check_out_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3_600_000;
}

function formatHours(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ชม.`;
}

async function loadPhotoSource(file: File) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Older iOS devices can expose createImageBitmap but fail to decode camera files.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("photo_decode_failed"));
      image.src = url;
    });
    return { source: image as CanvasImageSource, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function optimizePhoto(file: File) {
  if (file.size <= 700 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  const decoded = await loadPhotoSource(file);
  const scale = Math.min(1, 1024 / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    decoded.close();
    return file;
  }
  context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  decoded.close();

  for (const quality of [0.82, 0.68, 0.54]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && (blob.size <= 700 * 1024 || quality === 0.54)) {
      return new File([blob], `attendance-${Date.now()}.jpg`, { type: "image/jpeg" });
    }
  }
  return file;
}

function Logo() {
  return (
    <span className="brand" aria-label="T TIME">
      <span className="brand-mark">T</span>
      <span className="brand-type"><strong>TIME</strong></span>
    </span>
  );
}

function positionFromBrowser(options: PositionOptions) {
  return new Promise<LocationData>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((position) => resolve({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: Math.max(0, position.coords.accuracy || 0),
    }), reject, options);
  });
}

function isLocationPermissionDenied(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && Number((error as { code: unknown }).code) === 1);
}

function AuthPanel({ setup, onSuccess }: { setup: boolean; onSuccess: (user: AppUser) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const result = await api(setup ? "/api/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: fields.get("username"),
          password: fields.get("password"),
          name: fields.get("name"),
        }),
      });
      onSuccess(result.user as AppUser);
    } catch (caught) {
      setError(thaiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Logo />
        <div>
          <p className="eyebrow">ATTENDANCE, SIMPLIFIED</p>
          <h1>เริ่มงานง่าย<br />จบในไม่กี่วินาที</h1>
          <p>บันทึกรูป ตำแหน่ง และเวลาในขั้นตอนเดียว พร้อมดูประวัติย้อนหลังได้ทุกอุปกรณ์</p>
        </div>
        <div className="auth-points" aria-label="ความสามารถหลัก">
          <span><b>01</b> ถ่ายรูป</span>
          <span><b>02</b> ยืนยัน GPS</span>
          <span><b>03</b> บันทึกเวลา</span>
        </div>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div className="mobile-logo"><Logo /></div>
          <p className="eyebrow">{setup ? "ตั้งค่าครั้งแรก" : "ยินดีต้อนรับกลับ"}</p>
          <h2>{setup ? "สร้างบัญชีผู้ดูแล" : "เข้าสู่ระบบ"}</h2>
          <p className="form-lead">{setup ? "บัญชีแรกจะได้รับสิทธิ์ผู้ดูแลระบบโดยอัตโนมัติ" : "กรอกข้อมูลเพื่อบันทึกเวลาเข้างาน"}</p>

          {setup && (
            <label>ชื่อที่ใช้แสดง<input name="name" autoComplete="name" placeholder="เช่น สมชาย ใจดี" required /></label>
          )}
          <label>ชื่อผู้ใช้<input name="username" autoCapitalize="none" autoComplete="username" placeholder="username" required /></label>
          <label>รหัสผ่าน<input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={8} placeholder="อย่างน้อย 8 ตัว" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={busy}>{busy ? "กำลังดำเนินการ…" : setup ? "สร้างบัญชีและเริ่มใช้งาน" : "เข้าสู่ระบบ"}</button>
          <small className="privacy-note">ข้อมูลรูปภาพและตำแหน่งจะถูกจำกัดการเข้าถึงตามสิทธิ์ของผู้ใช้</small>
        </form>
      </section>
    </main>
  );
}

export default function AttendanceApp() {
  const [phase, setPhase] = useState<"loading" | "setup" | "login" | "ready">("loading");
  const [user, setUser] = useState<AppUser | null>(null);
  const [view, setView] = useState<View>("today");
  const [rows, setRows] = useState<Attendance[]>([]);
  const [today, setToday] = useState<Attendance | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [locationHelp, setLocationHelp] = useState<LocationHelp | null>(null);
  const [lineBrowserHelp, setLineBrowserHelp] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [query, setQuery] = useState("");
  const [reportSource, setReportSource] = useState<Attendance[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportFrom, setReportFrom] = useState(() => currentMonthRange().from);
  const [reportTo, setReportTo] = useState(() => currentMonthRange().to);
  const [reportRole, setReportRole] = useState<Role | "all">("all");
  const [reportStatus, setReportStatus] = useState<ReportStatus>("all");
  const [reportQuery, setReportQuery] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const [mapProvider, setMapProvider] = useState<MapProvider>("osm");
  const fileInput = useRef<HTMLInputElement>(null);
  const locationRequest = useRef<Promise<LocationData> | null>(null);
  const allowLineGps = useRef(false);
  const photoUrl = useMemo(() => photo ? URL.createObjectURL(photo) : "", [photo]);

  const canViewAll = user?.role === "admin" || user?.role === "hr";

  const loadAttendance = useCallback(async (activeUser: AppUser) => {
    const scope = activeUser.role === "admin" || activeUser.role === "hr" ? "?scope=all" : "";
    const data = await api(`/api/attendance${scope}`);
    setRows((data.rows || []) as Attendance[]);
    setToday((data.today || null) as Attendance | null);
  }, []);

  const loadUsers = useCallback(async () => {
    const data = await api("/api/users");
    setManagedUsers((data.users || []) as ManagedUser[]);
  }, []);

  const loadReportRows = useCallback(async () => {
    const data = await api("/api/attendance?scope=all&limit=5000");
    setReportSource((data.rows || []) as Attendance[]);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api("/api/session");
        if (data.mapProvider === "google") setMapProvider("google");
        if (data.needsSetup) return setPhase("setup");
        if (!data.user) return setPhase("login");
        const activeUser = data.user as AppUser;
        setUser(activeUser);
        setPhase("ready");
        await loadAttendance(activeUser);
      } catch {
        setPhase("login");
      }
    })();
  }, [loadAttendance]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLineBrowser() || new URL(window.location.href).searchParams.has("openExternalBrowser")) return;
    const frame = window.requestAnimationFrame(() => setLineBrowserHelp(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  function reportLocationError(error: unknown) {
    setMessage({ type: "error", text: thaiError(error) });
    if (isLineBrowser()) setLineBrowserHelp(true);
    else setLocationHelp(locationHelpForDevice());
  }

  function requestLocation() {
    if (locationRequest.current) return locationRequest.current;
    if (isLineBrowser() && !allowLineGps.current) {
      setLineBrowserHelp(true);
      return Promise.reject(new Error("line_browser_location"));
    }
    if (!window.isSecureContext && window.location.hostname !== "localhost") return Promise.reject(new Error("location_https_required"));
    if (!navigator.geolocation) return Promise.reject(new Error("location_required"));

    setLocating(true);
    const request = positionFromBrowser({ enableHighAccuracy: false, timeout: 8_000, maximumAge: 5 * 60_000 })
      .catch((firstError: unknown) => {
        if (isLocationPermissionDenied(firstError)) throw new Error("location_denied");
        return positionFromBrowser({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 0 });
      })
      .catch((secondError: unknown) => {
        if (secondError instanceof Error && secondError.message === "location_denied") throw secondError;
        if (isLocationPermissionDenied(secondError)) throw new Error("location_denied");
        return positionFromBrowser({ enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 });
      })
      .catch((finalError: unknown) => {
        if (finalError instanceof Error && finalError.message === "location_denied") throw finalError;
        if (isLocationPermissionDenied(finalError)) throw new Error("location_denied");
        throw new Error("location_timeout");
      })
      .then((next) => {
        setLocation(next);
        setLocationHelp(null);
        return next;
      })
      .finally(() => {
        setLocating(false);
        locationRequest.current = null;
      });
    locationRequest.current = request;
    return request;
  }

  async function selectPhoto(file: File | null) {
    if (!file) return setPhoto(null);
    setMessage(null);
    try {
      setPhoto(await optimizePhoto(file));
      if (!location) void requestLocation().catch(reportLocationError);
    } catch {
      setMessage({ type: "error", text: "ไม่สามารถเตรียมรูปนี้ได้ กรุณาถ่ายใหม่อีกครั้ง" });
    }
  }

  async function recordAttendance(action: "check-in" | "check-out") {
    if (!photo) {
      setMessage({ type: "error", text: errorLabels.photo_required });
      fileInput.current?.click();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const point = location || await requestLocation();
      const form = new FormData();
      form.set("action", action);
      form.set("photo", photo);
      form.set("lat", String(point.lat));
      form.set("lng", String(point.lng));
      form.set("accuracy", String(point.accuracy));
      form.set("device_time", new Date().toISOString());
      await api("/api/attendance", { method: "POST", body: form });
      setPhoto(null);
      setLocation(null);
      setReportSource(null);
      setMessage({ type: "success", text: action === "check-in" ? "บันทึกเข้างานเรียบร้อย" : "บันทึกเลิกงานเรียบร้อย" });
      if (user) await loadAttendance(user);
    } catch (caught) {
      if (isLocationError(caught)) reportLocationError(caught);
      else setMessage({ type: "error", text: thaiError(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
    setUser(null);
    setRows([]);
    setToday(null);
    setReportSource(null);
    setPhase("login");
  }

  async function openUsers() {
    setView("users");
    try {
      await loadUsers();
    } catch (caught) {
      setMessage({ type: "error", text: thaiError(caught) });
    }
  }

  async function openReport() {
    setView("report");
    if (reportSource || reportLoading) return;
    setReportLoading(true);
    try {
      await loadReportRows();
    } catch (caught) {
      setMessage({ type: "error", text: thaiError(caught) });
    } finally {
      setReportLoading(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      await api("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(fields)),
      });
      form.reset();
      setMessage({ type: "success", text: "เพิ่มผู้ใช้งานเรียบร้อย" });
      await loadUsers();
    } catch (caught) {
      setMessage({ type: "error", text: thaiError(caught) });
    } finally {
      setBusy(false);
    }
  }

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("th");
    if (!needle) return rows;
    return rows.filter((row) => `${row.name} ${row.username} ${roleLabels[row.role]} ${row.work_date}`.toLocaleLowerCase("th").includes(needle));
  }, [query, rows]);

  const filteredReportRows = useMemo(() => {
    const needle = reportQuery.trim().toLocaleLowerCase("th");
    return (reportSource || rows).filter((record) => {
      if (reportFrom && record.work_date < reportFrom) return false;
      if (reportTo && record.work_date > reportTo) return false;
      if (reportRole !== "all" && record.role !== reportRole) return false;
      if (reportStatus === "complete" && !record.check_out_at) return false;
      if (reportStatus === "open" && record.check_out_at) return false;
      return !needle || `${record.name} ${record.username} ${roleLabels[record.role]} ${record.work_date}`.toLocaleLowerCase("th").includes(needle);
    });
  }, [reportFrom, reportQuery, reportRole, reportSource, reportStatus, reportTo, rows]);

  const reportMetrics = useMemo(() => {
    const completed = filteredReportRows.filter((record) => record.check_out_at);
    const durations = completed.map(workHours).filter((value): value is number => value !== null);
    return {
      records: filteredReportRows.length,
      employees: new Set(filteredReportRows.map((record) => record.user_id || record.username)).size,
      completed: completed.length,
      open: filteredReportRows.length - completed.length,
      averageHours: durations.length ? durations.reduce((total, value) => total + value, 0) / durations.length : null,
    };
  }, [filteredReportRows]);

  const reportRoleSummary = useMemo(() => Object.entries(roleLabels).map(([role, label]) => {
    const roleRows = filteredReportRows.filter((record) => record.role === role);
    const durations = roleRows.map(workHours).filter((value): value is number => value !== null);
    return {
      role,
      label,
      records: roleRows.length,
      employees: new Set(roleRows.map((record) => record.user_id || record.username)).size,
      completed: roleRows.filter((record) => record.check_out_at).length,
      averageHours: durations.length ? durations.reduce((total, value) => total + value, 0) / durations.length : null,
    };
  }).filter((summary) => summary.records > 0), [filteredReportRows]);

  const reportPageCount = Math.max(1, Math.ceil(filteredReportRows.length / REPORT_PAGE_SIZE));
  const safeReportPage = Math.min(reportPage, reportPageCount);
  const visibleReportRows = filteredReportRows.slice((safeReportPage - 1) * REPORT_PAGE_SIZE, safeReportPage * REPORT_PAGE_SIZE);
  const reportDownloadUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (reportFrom) params.set("from", reportFrom);
    if (reportTo) params.set("to", reportTo);
    if (reportRole !== "all") params.set("role", reportRole);
    if (reportStatus !== "all") params.set("status", reportStatus);
    if (reportQuery.trim()) params.set("q", reportQuery.trim());
    return `/api/report?${params.toString()}`;
  }, [reportFrom, reportQuery, reportRole, reportStatus, reportTo]);

  if (phase === "loading") return <main className="loading-page"><Logo /><span className="loading-bar" /><p>กำลังเตรียมระบบ…</p></main>;
  if (phase === "setup") return <AuthPanel setup onSuccess={(next) => { setUser(next); setPhase("ready"); void loadAttendance(next); }} />;
  if (phase === "login") return <AuthPanel setup={false} onSuccess={(next) => { setUser(next); setPhase("ready"); void loadAttendance(next); }} />;
  if (!user) return null;

  const todayState = !today ? "not-started" : today.check_out_at ? "complete" : "working";
  const statusText = todayState === "not-started" ? "ยังไม่ได้เข้างาน" : todayState === "working" ? "กำลังทำงาน" : "บันทึกครบแล้ว";
  return (
    <MapProviderContext value={mapProvider}>
    <main className="app-shell">
      <header className="topbar">
        <button className="logo-button" type="button" onClick={() => setView("today")}><Logo /></button>
        <nav className="desktop-nav" aria-label="เมนูหลัก">
          <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}>วันนี้</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>ประวัติ</button>
          {(user.role === "admin" || user.role === "hr") && <button className={view === "report" ? "active" : ""} onClick={() => void openReport()}>รายงาน</button>}
          {user.role === "admin" && <button className={view === "users" ? "active" : ""} onClick={openUsers}>ผู้ใช้งาน</button>}
        </nav>
        <div className="profile-menu">
          <span className="avatar">{user.name.trim().charAt(0)}</span>
          <span className="profile-copy"><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></span>
          <button className="logout-button" type="button" onClick={logout}>ออก</button>
        </div>
      </header>

      {message && <div className={`toast ${message.type}`} role="status"><span>{message.type === "success" ? "✓" : "!"}</span>{message.text}<button onClick={() => setMessage(null)} aria-label="ปิดข้อความ">×</button></div>}

      {lineBrowserHelp && (
        <div className="location-help-backdrop" role="presentation">
          <section className="location-help line-browser-help" role="alertdialog" aria-modal="true" aria-labelledby="line-browser-title">
            <span className="line-browser-badge">LINE</span>
            <h2 id="line-browser-title">เปิดผ่าน Chrome หรือ Safari</h2>
            <p>LINE browser อาจไม่ส่งตำแหน่ง GPS ให้เว็บไซต์ กรุณาเปิดแอปผ่านเบราว์เซอร์หลักก่อนลงเวลา</p>
            <small>Android จะเปิด Chrome และ iPhone/iPad จะเปิด Safari จากนั้นเข้าสู่ระบบและใช้งานได้ตามปกติ</small>
            <div className="location-help-actions line-browser-actions">
              <a className="settings-button line-external-button" href={externalBrowserUrl()}>เปิดเบราว์เซอร์ภายนอก</a>
              <button type="button" onClick={() => { if (!navigator.clipboard) return setMessage({ type: "error", text: "คัดลอกไม่ได้ กรุณาแตะเปิดเบราว์เซอร์ภายนอก" }); void navigator.clipboard.writeText(externalBrowserUrl()).then(() => setMessage({ type: "success", text: "คัดลอกลิงก์สำหรับเปิดภายนอกแล้ว" })).catch(() => setMessage({ type: "error", text: "คัดลอกไม่ได้ กรุณาแตะเปิดเบราว์เซอร์ภายนอก" })); }}>คัดลอกลิงก์</button>
            </div>
            <button className="line-continue-button" type="button" onClick={() => { allowLineGps.current = true; setLineBrowserHelp(false); void requestLocation().catch(reportLocationError); }}>เปิดสิทธิ์ตำแหน่งให้ LINE แล้ว — ลองต่อใน LINE</button>
          </section>
        </div>
      )}

      {locationHelp && (
        <div className="location-help-backdrop" role="presentation">
          <section className="location-help" role="alertdialog" aria-modal="true" aria-labelledby="location-help-title">
            <button className="location-help-close" type="button" onClick={() => setLocationHelp(null)} aria-label="ปิดคำแนะนำ">×</button>
            <span className="location-help-icon" aria-hidden="true">●</span>
            <h2 id="location-help-title">กรุณาเปิดตำแหน่ง</h2>
            <p>ยังไม่สามารถตรวจสอบตำแหน่งของเครื่องได้</p>
            <small>{locationHelp.instructions}</small>
            <div className="location-help-actions">
              {locationHelp.href && <a className="settings-button" href={locationHelp.href} target="_blank" rel="noreferrer">เปิดการตั้งค่า</a>}
              <button type="button" onClick={() => { setLocationHelp(null); void requestLocation().catch(reportLocationError); }}>ลองตรวจสอบอีกครั้ง</button>
            </div>
          </section>
        </div>
      )}

      {view === "today" && (
        <section className="dashboard" id="top">
          <section className={`check-card state-${todayState}`} aria-labelledby="today-heading">
            <div className="card-heading">
              <div>
                <span className="status-dot" /><p>สถานะวันนี้</p>
                <h2 id="today-heading">{statusText}</h2>
              </div>
              <time>
                <strong>{new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }).format(clock)}</strong>
                <small>{formatWeekdayDate(clock)}</small>
              </time>
            </div>

            {today && (
              <div className="today-summary">
                <span><small>เข้างาน</small><strong>{formatTime(today.check_in_at)}</strong></span>
                <i />
                <span><small>เลิกงาน</small><strong>{formatTime(today.check_out_at)}</strong></span>
              </div>
            )}

            <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void selectPhoto(event.target.files?.[0] || null)} />
            <button className={`camera-zone ${photoUrl ? "has-photo" : ""}`} type="button" onClick={() => fileInput.current?.click()} disabled={todayState === "complete"}>
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="รูปที่เตรียมบันทึกเวลา" />
              ) : (
                <><span className="camera-icon" aria-hidden="true">◎</span><strong>ถ่ายรูปเพื่อยืนยันตัวตน</strong><small>แตะเพื่อเปิดกล้อง</small></>
              )}
              {photoUrl && <span className="retake-label">ถ่ายใหม่</span>}
            </button>

            <button className={`location-row ${location ? "located" : ""}`} type="button" onClick={() => void requestLocation().catch(reportLocationError)} disabled={locating || todayState === "complete"}>
              <span className="location-pin">{location ? "✓" : "●"}</span>
              <span><strong>{locating ? "กำลังหาตำแหน่ง…" : location ? "ยืนยันตำแหน่งแล้ว" : "แตะเพื่อตรวจสอบตำแหน่ง"}</strong><small>{location ? `ความแม่นยำประมาณ ${Math.round(location.accuracy)} เมตร` : "ระบบต้องใช้ GPS เพื่อบันทึกเวลา"}</small></span>
            </button>

            <div className="action-grid">
              <button className="action-primary" type="button" disabled={busy || todayState !== "not-started"} onClick={() => recordAttendance("check-in")}>{busy && todayState === "not-started" ? "กำลังบันทึก…" : "เข้างาน"}</button>
              <button className="action-secondary" type="button" disabled={busy || todayState !== "working"} onClick={() => recordAttendance("check-out")}>{busy && todayState === "working" ? "กำลังบันทึก…" : "เลิกงาน"}</button>
            </div>
          </section>

          <section className="history-preview" aria-labelledby="recent-heading">
            <div className="section-heading">
              <div><p className="eyebrow">รายการล่าสุด</p><h2 id="recent-heading">ประวัติเข้างาน</h2></div>
              <button type="button" onClick={() => setView("history")}>ดูทั้งหมด →</button>
            </div>
            <HistoryList rows={rows.slice(0, 3)} compact />
          </section>
        </section>
      )}

      {view === "history" && (
        <section className="content-page">
          <div className="content-heading">
            <div><p className="eyebrow">{canViewAll ? "ภาพรวมทั้งองค์กร" : "ข้อมูลของฉัน"}</p><h1>ประวัติเข้างาน</h1><p>รูปภาพ ตำแหน่ง และเวลาเข้างาน–เลิกงาน</p></div>
            <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ วันที่ หรือ role" /></label>
          </div>
          <div className="stat-strip">
            <span><small>รายการทั้งหมด</small><strong>{filteredRows.length}</strong></span>
            <span><small>บันทึกครบ</small><strong>{filteredRows.filter((row) => row.check_out_at).length}</strong></span>
            <span><small>ยังไม่เลิกงาน</small><strong>{filteredRows.filter((row) => !row.check_out_at).length}</strong></span>
          </div>
          <HistoryList rows={filteredRows} showNames={Boolean(canViewAll)} />
        </section>
      )}

      {view === "report" && (user.role === "admin" || user.role === "hr") && (
        <section className="content-page report-page">
          <div className="content-heading report-heading">
            <div><p className="eyebrow">HR ATTENDANCE REPORT</p><h1>รายงานเวลาทำงาน</h1><p>สรุปการเข้างาน–เลิกงานตามช่วงเวลา พร้อมดาวน์โหลด Excel ที่จัดรูปแบบแล้ว</p></div>
            <a className="report-download" href={reportDownloadUrl}>ดาวน์โหลด Excel (.xlsx) ↓</a>
          </div>

          <div className="report-filters" aria-label="ตัวกรองรายงาน">
            <label>ตั้งแต่วันที่<input type="date" value={reportFrom} max={reportTo || undefined} onChange={(event) => { setReportFrom(event.target.value); setReportPage(1); }} /></label>
            <label>ถึงวันที่<input type="date" value={reportTo} min={reportFrom || undefined} onChange={(event) => { setReportTo(event.target.value); setReportPage(1); }} /></label>
            <label>บทบาท<select value={reportRole} onChange={(event) => { setReportRole(event.target.value as Role | "all"); setReportPage(1); }}><option value="all">ทุกบทบาท</option>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>สถานะ<select value={reportStatus} onChange={(event) => { setReportStatus(event.target.value as ReportStatus); setReportPage(1); }}><option value="all">ทุกสถานะ</option><option value="complete">ลงเวลาครบ</option><option value="open">ยังไม่เลิกงาน</option></select></label>
            <label className="report-search">ค้นหาพนักงาน<input value={reportQuery} onChange={(event) => { setReportQuery(event.target.value); setReportPage(1); }} placeholder="ชื่อหรือ username" /></label>
            <div className="report-filter-actions">
              <button type="button" onClick={() => { const range = currentMonthRange(); setReportFrom(range.from); setReportTo(range.to); setReportPage(1); }}>เดือนนี้</button>
              <button type="button" onClick={() => { setReportFrom(""); setReportTo(""); setReportRole("all"); setReportStatus("all"); setReportQuery(""); setReportPage(1); }}>ล้างทั้งหมด</button>
            </div>
          </div>

          {reportLoading && <div className="report-loading"><span className="loading-bar" /><p>กำลังโหลดข้อมูลรายงานทั้งหมด…</p></div>}

          <div className="report-kpis" aria-label="สรุปรายงาน">
            <article><small>รายการลงเวลา</small><strong>{reportMetrics.records.toLocaleString("th-TH")}</strong><span>รายการในช่วงที่เลือก</span></article>
            <article><small>พนักงาน</small><strong>{reportMetrics.employees.toLocaleString("th-TH")}</strong><span>คนที่มีการลงเวลา</span></article>
            <article className="kpi-complete"><small>ลงเวลาครบ</small><strong>{reportMetrics.completed.toLocaleString("th-TH")}</strong><span>มีเวลาเข้าและเลิกงาน</span></article>
            <article className="kpi-open"><small>ยังไม่เลิกงาน</small><strong>{reportMetrics.open.toLocaleString("th-TH")}</strong><span>ควรตรวจสอบรายการค้าง</span></article>
            <article><small>ชั่วโมงเฉลี่ย</small><strong>{reportMetrics.averageHours === null ? "—" : reportMetrics.averageHours.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><span>เฉพาะรายการที่ลงเวลาครบ</span></article>
          </div>

          <section className="role-summary-card" aria-labelledby="role-summary-heading">
            <div className="report-section-heading"><div><p className="eyebrow">SUMMARY BY ROLE</p><h2 id="role-summary-heading">สรุปตามบทบาท</h2></div><span>{reportRoleSummary.length} กลุ่ม</span></div>
            {reportRoleSummary.length ? (
              <div className="report-table-scroll">
                <table className="role-summary-table">
                  <thead><tr><th>บทบาท</th><th>พนักงาน</th><th>รายการ</th><th>ลงเวลาครบ</th><th>ยังไม่เลิกงาน</th><th>ชั่วโมงเฉลี่ย</th></tr></thead>
                  <tbody>{reportRoleSummary.map((summary) => <tr key={summary.role}><td><span className={`role-badge role-${summary.role}`}>{summary.label}</span></td><td>{summary.employees}</td><td>{summary.records}</td><td>{summary.completed}</td><td>{summary.records - summary.completed}</td><td>{formatHours(summary.averageHours)}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <p className="report-empty-copy">ไม่พบข้อมูลตามตัวกรองที่เลือก</p>}
          </section>

          <section className="report-detail-card" aria-labelledby="report-detail-heading">
            <div className="report-section-heading">
              <div><p className="eyebrow">ATTENDANCE DETAILS</p><h2 id="report-detail-heading">รายละเอียดการลงเวลา</h2></div>
              <span>หน้า {safeReportPage} / {reportPageCount} · {filteredReportRows.length.toLocaleString("th-TH")} รายการ</span>
            </div>
            {visibleReportRows.length ? (
              <div className="report-table-scroll">
                <table className="report-table">
                  <thead><tr><th>วันที่</th><th>พนักงาน</th><th>บทบาท</th><th>เข้างาน</th><th>เลิกงาน</th><th>ชั่วโมง</th><th>สถานะ</th><th>ตำแหน่งโดยประมาณ</th></tr></thead>
                  <tbody>{visibleReportRows.map((record) => (
                    <tr key={record.id}>
                      <td><strong>{formatDate(record.work_date)}</strong></td>
                      <td><strong>{record.name}</strong><small>@{record.username}</small></td>
                      <td><span className={`role-badge role-${record.role}`}>{roleLabels[record.role]}</span></td>
                      <td>{formatTime(record.check_in_at)}</td>
                      <td>{formatTime(record.check_out_at)}</td>
                      <td>{formatHours(workHours(record))}</td>
                      <td><span className={`complete-badge ${record.check_out_at ? "complete" : "pending"}`}>{record.check_out_at ? "ครบถ้วน" : "ยังไม่เลิกงาน"}</span></td>
                      <td><div className="report-map-pair"><MapThumbnail lat={record.check_in_lat} lng={record.check_in_lng} label="จุดเข้างาน" variant="table" />{record.check_out_lat !== null && record.check_out_lng !== null && <MapThumbnail lat={record.check_out_lat} lng={record.check_out_lng} label="จุดเลิกงาน" variant="table" />}</div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="empty-state"><span>○</span><h3>ไม่พบข้อมูลรายงาน</h3><p>ลองเปลี่ยนช่วงวันที่หรือเงื่อนไขตัวกรอง</p></div>}
            {reportPageCount > 1 && <div className="report-pagination"><button type="button" disabled={safeReportPage <= 1} onClick={() => setReportPage((page) => Math.max(1, page - 1))}>← ก่อนหน้า</button><span>{((safeReportPage - 1) * REPORT_PAGE_SIZE) + 1}–{Math.min(safeReportPage * REPORT_PAGE_SIZE, filteredReportRows.length)} จาก {filteredReportRows.length}</span><button type="button" disabled={safeReportPage >= reportPageCount} onClick={() => setReportPage((page) => Math.min(reportPageCount, page + 1))}>ถัดไป →</button></div>}
          </section>
        </section>
      )}

      {view === "users" && user.role === "admin" && (
        <section className="content-page users-page">
          <div className="content-heading">
            <div><p className="eyebrow">จัดการสิทธิ์</p><h1>ผู้ใช้งาน</h1><p>สร้างบัญชีใหม่และกำหนดบทบาทสำหรับระบบลงเวลา</p></div>
          </div>
          <div className="users-layout">
            <form className="user-form" onSubmit={createUser}>
              <h2>เพิ่มผู้ใช้งาน</h2>
              <label>ชื่อที่ใช้แสดง<input name="name" placeholder="ชื่อ–นามสกุล" required /></label>
              <label>ชื่อผู้ใช้<input name="username" autoCapitalize="none" placeholder="username" required /></label>
              <label>รหัสผ่าน<input name="password" type="password" minLength={8} placeholder="อย่างน้อย 8 ตัว" required /></label>
              <label>บทบาท<select name="role" defaultValue="user">{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <button className="submit-button" disabled={busy}>{busy ? "กำลังเพิ่ม…" : "เพิ่มผู้ใช้งาน"}</button>
            </form>
            <div className="user-list">
              <div className="user-list-head"><h2>บัญชีทั้งหมด</h2><span>{managedUsers.length} คน</span></div>
              {managedUsers.map((member) => (
                <article className="user-row" key={member.id}>
                  <span className="avatar">{member.name.charAt(0)}</span>
                  <span><strong>{member.name}</strong><small>@{member.username}</small></span>
                  <span className={`role-badge role-${member.role}`}>{roleLabels[member.role]}</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <nav className="mobile-nav" aria-label="เมนูหลักบนมือถือ">
        <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}><b>●</b><span>วันนี้</span></button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><b>≡</b><span>ประวัติ</span></button>
        {(user.role === "admin" || user.role === "hr") && <button className={view === "report" ? "active" : ""} onClick={() => void openReport()}><b>▤</b><span>รายงาน</span></button>}
        {user.role === "admin" && <button className={view === "users" ? "active" : ""} onClick={openUsers}><b>+</b><span>ผู้ใช้งาน</span></button>}
      </nav>
    </main>
    </MapProviderContext>
  );
}

function MapThumbnail({ lat, lng, label, variant = "card" }: { lat: number; lng: number; label: string; variant?: keyof typeof MAP_SIZES }) {
  const provider = useContext(MapProviderContext);
  const { width, height } = MAP_SIZES[variant];

  return (
    <div className="map-thumbnail" style={{ width, maxWidth: "100%" } satisfies CSSProperties}>
      <div className="map-thumbnail-canvas" style={{ height }}>
        {provider === "google" ? <GoogleMapImage lat={lat} lng={lng} label={label} width={width} height={height} /> : <GoogleMapEmbed lat={lat} lng={lng} label={label} />}
      </div>
      <a className="map-thumbnail-link" href={mapUrl(lat, lng)} target="_blank" rel="noreferrer">{label} · เปิดแผนที่เต็มจอ ↗</a>
    </div>
  );
}

/** ภาพนิ่งจาก Google Static Maps ผ่าน /api/map — หมุดถูกวาดมาในภาพแล้ว ไม่ต้องซ้อนเอง */
function GoogleMapImage({ lat, lng, label, width, height }: { lat: number; lng: number; label: string; width: number; height: number }) {
  const source = `/api/map?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&w=${width}&h=${height}`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="map-thumbnail-photo" src={source} alt={`แผนที่บริเวณ${label}`} width={width} height={height} loading="lazy" />;
}

/**
 * แผนที่ฝังของ Google — ไม่ต้องใช้ API key จึงใช้ได้ทันที
 * (จะเปลี่ยนเป็นภาพนิ่งจาก /api/map อัตโนมัติเมื่อมี GOOGLE_MAPS_API_KEY ซึ่งเบากว่าเพราะเป็นรูปใบเดียว)
 */
function GoogleMapEmbed({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const source = `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=16&output=embed`;
  return (
    <iframe
      className="map-thumbnail-frame"
      src={source}
      title={`แผนที่บริเวณ${label}`}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

function HistoryList({ rows, compact = false, showNames = false }: { rows: Attendance[]; compact?: boolean; showNames?: boolean }) {
  if (!rows.length) return <div className="empty-state"><span>○</span><h3>ยังไม่มีประวัติ</h3><p>เมื่อบันทึกเข้างาน รายการจะปรากฏที่นี่</p></div>;
  return (
    <div className={`history-list ${compact ? "compact" : "detailed"}`}>
      {rows.map((record) => (
        <article className="history-row" key={record.id}>
          <div className="date-tile"><strong>{formatDay(record.work_date)}</strong><small>{formatMonth(record.work_date)}</small></div>
          <div className="record-main">
            {showNames && <div className="record-owner"><strong>{record.name}</strong><span>{roleLabels[record.role]}</span></div>}
            {!showNames && !compact && <p className="record-date">{formatDate(record.work_date)}</p>}
            <div className="time-pair">
              <span><small>เข้างาน</small><strong>{formatTime(record.check_in_at)}</strong></span><i /><span><small>เลิกงาน</small><strong>{formatTime(record.check_out_at)}</strong></span>
            </div>
          </div>
          <span className={`complete-badge ${record.check_out_at ? "complete" : "pending"}`}>{record.check_out_at ? "ครบถ้วน" : "กำลังทำงาน"}</span>
          {!compact && (
            <div className="evidence-grid">
              <a className="evidence" href={record.check_in_photo_url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={record.check_in_photo_url} alt={`รูปเข้างาน ${record.name}`} loading="lazy" />
                <span><strong>รูปเข้างาน</strong><small>{record.check_in_accuracy ? `GPS ±${Math.round(record.check_in_accuracy)} ม.` : "GPS"}</small></span>
              </a>
              <MapThumbnail lat={record.check_in_lat} lng={record.check_in_lng} label="จุดเข้างาน" />
              {record.check_out_photo_url && record.check_out_lat !== null && record.check_out_lng !== null ? (
                <>
                  <a className="evidence" href={record.check_out_photo_url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={record.check_out_photo_url} alt={`รูปเลิกงาน ${record.name}`} loading="lazy" />
                    <span><strong>รูปเลิกงาน</strong><small>{record.check_out_accuracy ? `GPS ±${Math.round(record.check_out_accuracy)} ม.` : "GPS"}</small></span>
                  </a>
                  <MapThumbnail lat={record.check_out_lat} lng={record.check_out_lng} label="จุดเลิกงาน" />
                </>
              ) : <div className="waiting-evidence">รอบันทึกเลิกงาน</div>}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
