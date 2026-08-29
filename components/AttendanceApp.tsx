"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
type View = "today" | "history" | "users" | "attendance-management";
type LocationHelp = { href: string | null; instructions: string };

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

function formatDate(value: string) {
  const date = attendanceDate(value);
  if (!date) return value || "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
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

function toBangkokDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
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

  useEffect(() => {
    void (async () => {
      try {
        const data = await api("/api/session");
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

  async function updateAttendance(event: FormEvent<HTMLFormElement>, record: Attendance) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const fields = new FormData(event.currentTarget);
    const checkOutAt = String(fields.get("checkOutAt") || "");
    try {
      await api("/api/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: record.id,
          checkInAt: fields.get("checkInAt"),
          ...(checkOutAt ? { checkOutAt } : {}),
        }),
      });
      setMessage({ type: "success", text: `แก้ไขเวลาของ ${record.name} เรียบร้อย` });
      if (user) await loadAttendance(user);
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

  if (phase === "loading") return <main className="loading-page"><Logo /><span className="loading-bar" /><p>กำลังเตรียมระบบ…</p></main>;
  if (phase === "setup") return <AuthPanel setup onSuccess={(next) => { setUser(next); setPhase("ready"); void loadAttendance(next); }} />;
  if (phase === "login") return <AuthPanel setup={false} onSuccess={(next) => { setUser(next); setPhase("ready"); void loadAttendance(next); }} />;
  if (!user) return null;

  const todayState = !today ? "not-started" : today.check_out_at ? "complete" : "working";
  const statusText = todayState === "not-started" ? "ยังไม่ได้เข้างาน" : todayState === "working" ? "กำลังทำงาน" : "บันทึกครบแล้ว";
  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="logo-button" type="button" onClick={() => setView("today")}><Logo /></button>
        <nav className="desktop-nav" aria-label="เมนูหลัก">
          <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}>วันนี้</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>ประวัติ</button>
          {user.role === "admin" && <button className={view === "users" ? "active" : ""} onClick={openUsers}>ผู้ใช้งาน</button>}
          {user.role === "hr" && <button className={view === "attendance-management" ? "active" : ""} onClick={() => setView("attendance-management")}>จัดการเวลา</button>}
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
                <small>{new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(clock)}</small>
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

      {view === "attendance-management" && user.role === "hr" && (
        <section className="content-page attendance-management-page">
          <div className="content-heading">
            <div><p className="eyebrow">ฝ่ายบุคคล</p><h1>จัดการเวลาเข้า–ออก</h1><p>แก้ไขวันที่และเวลาที่บันทึกผิด โดยยังคงหลักฐานรูปและตำแหน่งเดิมไว้</p></div>
            <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ วันที่ หรือ role" /></label>
          </div>
          <div className="attendance-edit-list">
            {filteredRows.length ? filteredRows.map((record) => (
              <form className="attendance-edit-row" key={`${record.id}-${record.check_in_at}-${record.check_out_at || "open"}`} onSubmit={(event) => void updateAttendance(event, record)}>
                <div className="attendance-edit-owner">
                  <span className="avatar">{record.name.trim().charAt(0)}</span>
                  <span><strong>{record.name}</strong><small>@{record.username} · {roleLabels[record.role]}</small></span>
                </div>
                <label>เวลาเข้างาน<input name="checkInAt" type="datetime-local" defaultValue={toBangkokDateTimeInput(record.check_in_at)} required /></label>
                <label>เวลาเลิกงาน<input name="checkOutAt" type="datetime-local" defaultValue={toBangkokDateTimeInput(record.check_out_at)} /></label>
                <button type="submit" disabled={busy}>บันทึก</button>
              </form>
            )) : <div className="empty-state"><span>○</span><h3>ไม่พบข้อมูล</h3><p>ลองเปลี่ยนคำค้นหาอีกครั้ง</p></div>}
          </div>
        </section>
      )}

      <nav className="mobile-nav" aria-label="เมนูหลักบนมือถือ">
        <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}><b>●</b><span>วันนี้</span></button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><b>≡</b><span>ประวัติ</span></button>
        {user.role === "admin" && <button className={view === "users" ? "active" : ""} onClick={openUsers}><b>+</b><span>ผู้ใช้งาน</span></button>}
        {user.role === "hr" && <button className={view === "attendance-management" ? "active" : ""} onClick={() => setView("attendance-management")}><b>✎</b><span>จัดการเวลา</span></button>}
      </nav>
    </main>
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
              <a className="map-link" href={mapUrl(record.check_in_lat, record.check_in_lng)} target="_blank" rel="noreferrer">ดูตำแหน่งเข้างาน ↗</a>
              {record.check_out_photo_url && record.check_out_lat !== null && record.check_out_lng !== null ? (
                <>
                  <a className="evidence" href={record.check_out_photo_url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={record.check_out_photo_url} alt={`รูปเลิกงาน ${record.name}`} loading="lazy" />
                    <span><strong>รูปเลิกงาน</strong><small>{record.check_out_accuracy ? `GPS ±${Math.round(record.check_out_accuracy)} ม.` : "GPS"}</small></span>
                  </a>
                  <a className="map-link" href={mapUrl(record.check_out_lat, record.check_out_lng)} target="_blank" rel="noreferrer">ดูตำแหน่งเลิกงาน ↗</a>
                </>
              ) : <div className="waiting-evidence">รอบันทึกเลิกงาน</div>}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
