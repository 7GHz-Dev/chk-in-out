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
type View = "today" | "history" | "users";

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
  already_checked_in: "วันนี้บันทึกเข้างานแล้ว",
  already_checked_out: "วันนี้บันทึกเลิกงานแล้ว",
  check_in_first: "กรุณาบันทึกเข้างานก่อน",
  unauthorized: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
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

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function mapUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

async function optimizePhoto(file: File) {
  if (file.size <= 700 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

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
    <span className="brand" aria-label="TTN Time">
      <span className="brand-mark">T</span>
      <span className="brand-type"><strong>TTN</strong><small>TIME</small></span>
    </span>
  );
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
  const [clock, setClock] = useState(new Date());
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
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
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  function requestLocation() {
    return new Promise<LocationData>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("location_required"));
      setLocating(true);
      navigator.geolocation.getCurrentPosition((position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
        setLocation(next);
        setLocating(false);
        resolve(next);
      }, () => {
        setLocating(false);
        reject(new Error("location_required"));
      }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
    });
  }

  async function selectPhoto(file: File | null) {
    if (!file) return setPhoto(null);
    setMessage(null);
    try {
      setPhoto(await optimizePhoto(file));
      if (!location) void requestLocation().catch((caught) => setMessage({ type: "error", text: thaiError(caught) }));
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
      setMessage({ type: "error", text: thaiError(caught) });
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
  const nextAction = todayState === "not-started" ? "เข้างาน" : todayState === "working" ? "เลิกงาน" : "เสร็จสิ้นวันนี้";

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="logo-button" type="button" onClick={() => setView("today")}><Logo /></button>
        <nav className="desktop-nav" aria-label="เมนูหลัก">
          <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}>วันนี้</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>ประวัติ</button>
          {user.role === "admin" && <button className={view === "users" ? "active" : ""} onClick={openUsers}>ผู้ใช้งาน</button>}
        </nav>
        <div className="profile-menu">
          <span className="avatar">{user.name.trim().charAt(0)}</span>
          <span className="profile-copy"><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></span>
          <button className="logout-button" type="button" onClick={logout}>ออก</button>
        </div>
      </header>

      {message && <div className={`toast ${message.type}`} role="status"><span>{message.type === "success" ? "✓" : "!"}</span>{message.text}<button onClick={() => setMessage(null)} aria-label="ปิดข้อความ">×</button></div>}

      {view === "today" && (
        <section className="dashboard" id="top">
          <div className="hero-copy">
            <p className="eyebrow">{new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(clock)}</p>
            <h1>{todayState === "complete" ? <>วันนี้<br />เยี่ยมมาก!</> : <>พร้อม{nextAction}<br />หรือยัง?</>}</h1>
            <p className="subtitle">ถ่ายรูป ยืนยันตำแหน่ง แล้วบันทึกเวลาได้ในไม่กี่วินาที</p>
            {today && (
              <div className="today-summary">
                <span><small>เข้างาน</small><strong>{formatTime(today.check_in_at)}</strong></span>
                <i />
                <span><small>เลิกงาน</small><strong>{formatTime(today.check_out_at)}</strong></span>
              </div>
            )}
          </div>

          <section className={`check-card state-${todayState}`} aria-labelledby="today-heading">
            <div className="card-heading">
              <div>
                <span className="status-dot" /><p>สถานะวันนี้</p>
                <h2 id="today-heading">{statusText}</h2>
              </div>
              <time>{new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }).format(clock)}</time>
            </div>

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

            <button className={`location-row ${location ? "located" : ""}`} type="button" onClick={() => void requestLocation().catch((caught) => setMessage({ type: "error", text: thaiError(caught) }))} disabled={locating || todayState === "complete"}>
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

      <nav className="mobile-nav" aria-label="เมนูหลักบนมือถือ">
        <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}><b>●</b><span>วันนี้</span></button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><b>≡</b><span>ประวัติ</span></button>
        {user.role === "admin" && <button className={view === "users" ? "active" : ""} onClick={openUsers}><b>+</b><span>ผู้ใช้งาน</span></button>}
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
          <div className="date-tile"><strong>{new Date(`${record.work_date}T00:00:00+07:00`).getDate()}</strong><small>{new Intl.DateTimeFormat("th-TH", { month: "short" }).format(new Date(`${record.work_date}T00:00:00+07:00`))}</small></div>
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
