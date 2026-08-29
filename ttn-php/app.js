"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const roles = {
  user: "ผู้ใช้งาน",
  admin: "ผู้ดูแลระบบ",
  hr: "ฝ่ายบุคคล",
  "employee-driver": "พนักงานขับรถ",
  "employee-office": "พนักงานออฟฟิศ",
};

const errors = {
  missing_credentials: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน",
  invalid_credentials: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  account_disabled: "บัญชีนี้ถูกปิดการใช้งาน",
  unauthorized: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
  photo_required: "กรุณาถ่ายรูปก่อนบันทึกเวลา",
  invalid_photo_type: "รองรับเฉพาะรูป JPG, PNG หรือ WebP",
  photo_too_large: "รูปมีขนาดใหญ่เกิน 8 MB",
  location_required: "ไม่สามารถอ่านตำแหน่งได้ กรุณาเปิด GPS",
  location_denied: "เบราว์เซอร์ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง",
  location_timeout: "ค้นหาตำแหน่งไม่สำเร็จ กรุณาเปิด GPS แล้วลองใหม่",
  line_browser_location: "กรุณาเปิดผ่าน Chrome หรือ Safari เพื่อให้ระบบอ่าน GPS ได้แน่นอน",
  already_checked_in: "วันนี้บันทึกเข้างานแล้ว",
  already_checked_out: "วันนี้บันทึกเลิกงานแล้ว",
  check_in_first: "กรุณาบันทึกเข้างานก่อน",
  invalid_username: "ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัว และใช้เฉพาะ a-z, 0-9, จุดหรือขีด",
  invalid_name: "กรุณากรอกชื่อที่ใช้แสดง",
  password_too_short: "รหัสผ่านต้องมีอย่างน้อย 8 ตัว",
  username_exists: "ชื่อผู้ใช้นี้มีอยู่แล้ว",
  invalid_datetime: "วันที่หรือเวลาไม่ถูกต้อง",
  check_out_before_check_in: "เวลาเลิกงานต้องอยู่หลังเวลาเข้างาน",
  duplicate_work_date: "พนักงานคนนี้มีรายการในวันที่เลือกแล้ว",
  backend_unavailable: "ฐานข้อมูลตอบสนองช้า กรุณาลองใหม่",
  server_error: "เซิร์ฟเวอร์ขัดข้อง กรุณาลองใหม่",
};

const state = {
  user: null,
  rows: [],
  today: null,
  photo: null,
  photoUrl: "",
  location: null,
  locationPromise: null,
  busy: false,
  view: "today",
  users: [],
  allowLineGps: false,
};

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "request_failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

function errorText(error) {
  return errors[error?.message] || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function toast(text, type = "success") {
  const element = $("#toast");
  element.className = `toast ${type}`;
  element.querySelector("b").textContent = type === "success" ? "✓" : "!";
  element.querySelector("span").textContent = text;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.add("hidden"), 6500);
}

function validDate(value) {
  const source = /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value}T00:00:00+07:00` : value;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeText(value) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "—";
}

function dateText(value) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(date) : String(value || "—");
}

function dateTile(value) {
  const date = validDate(value);
  if (!date) return "<span class=\"date-tile\"><strong>—</strong><small>—</small></span>";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", month: "short" }).format(date);
  return `<span class="date-tile"><strong>${day}</strong><small>${escapeHtml(month)}</small></span>`;
}

function localInput(value) {
  const date = validDate(value);
  if (!date) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function empty(text = "ยังไม่มีประวัติ") {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function cardMarkup(record) {
  return `<article class="history-card">
    ${dateTile(record.work_date)}
    <div class="time-pair"><span><small>เข้างาน</small><strong>${timeText(record.check_in_at)}</strong></span><i></i><span><small>เลิกงาน</small><strong>${timeText(record.check_out_at)}</strong></span></div>
    <span class="badge ${record.check_out_at ? "" : "pending"}">${record.check_out_at ? "ครบถ้วน" : "กำลังทำงาน"}</span>
  </article>`;
}

function historyMarkup(record) {
  const showName = ["admin", "hr"].includes(state.user.role);
  const owner = showName ? `<div class="owner"><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(roles[record.role] || record.role)}</small></div>` : `<div class="owner"><strong>${escapeHtml(dateText(record.work_date))}</strong></div>`;
  const checkout = record.check_out_photo_url && record.check_out_lat != null
    ? `<a class="evidence" href="${escapeHtml(record.check_out_photo_url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(record.check_out_photo_url)}" loading="lazy" alt="รูปเลิกงาน"><span><strong>รูปเลิกงาน</strong><small>GPS ±${Math.round(record.check_out_accuracy || 0)} ม.</small></span></a><a class="map-link" href="https://www.google.com/maps?q=${Number(record.check_out_lat)},${Number(record.check_out_lng)}" target="_blank" rel="noreferrer">ดูตำแหน่ง ↗</a>`
    : `<div class="waiting">รอบันทึกเลิกงาน</div>`;
  return `<article class="history-row">
    ${dateTile(record.work_date)}
    <div>${owner}<div class="time-pair"><span><small>เข้างาน</small><strong>${timeText(record.check_in_at)}</strong></span><i></i><span><small>เลิกงาน</small><strong>${timeText(record.check_out_at)}</strong></span></div></div>
    <span class="badge ${record.check_out_at ? "" : "pending"}">${record.check_out_at ? "ครบถ้วน" : "กำลังทำงาน"}</span>
    <div class="evidence-grid"><a class="evidence" href="${escapeHtml(record.check_in_photo_url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(record.check_in_photo_url)}" loading="lazy" alt="รูปเข้างาน"><span><strong>รูปเข้างาน</strong><small>GPS ±${Math.round(record.check_in_accuracy || 0)} ม.</small></span></a><a class="map-link" href="https://www.google.com/maps?q=${Number(record.check_in_lat)},${Number(record.check_in_lng)}" target="_blank" rel="noreferrer">ดูตำแหน่ง ↗</a>${checkout}</div>
  </article>`;
}

function filteredRows(query) {
  const needle = query.trim().toLocaleLowerCase("th");
  if (!needle) return state.rows;
  return state.rows.filter((row) => `${row.name} ${row.username} ${roles[row.role] || row.role} ${row.work_date}`.toLocaleLowerCase("th").includes(needle));
}

function renderAttendance() {
  const todayState = !state.today ? "not-started" : state.today.check_out_at ? "complete" : "working";
  $("#status-text").textContent = todayState === "not-started" ? "ยังไม่ได้เข้างาน" : todayState === "working" ? "กำลังทำงาน" : "บันทึกครบแล้ว";
  $("#check-card").dataset.state = todayState;
  $("#today-summary").classList.toggle("hidden", !state.today);
  if (state.today) {
    $("#today-in").textContent = timeText(state.today.check_in_at);
    $("#today-out").textContent = timeText(state.today.check_out_at);
  }
  $("#camera").disabled = todayState === "complete";
  $("#location-button").disabled = todayState === "complete";
  $("#check-in").disabled = state.busy || todayState !== "not-started";
  $("#check-out").disabled = state.busy || todayState !== "working";
  $("#recent-list").innerHTML = state.rows.length ? state.rows.slice(0, 3).map(cardMarkup).join("") : empty();
  renderHistory();
  if (state.user.role === "hr") renderManage();
}

function renderHistory() {
  const rows = filteredRows($("#history-search").value);
  $("#history-stats").innerHTML = `<span><small>ทั้งหมด</small><strong>${rows.length}</strong></span><span><small>ครบถ้วน</small><strong>${rows.filter((row) => row.check_out_at).length}</strong></span><span><small>ยังไม่เลิกงาน</small><strong>${rows.filter((row) => !row.check_out_at).length}</strong></span>`;
  $("#history-list").innerHTML = rows.length ? rows.map(historyMarkup).join("") : empty("ไม่พบข้อมูล");
}

function renderManage() {
  const rows = filteredRows($("#manage-search").value);
  $("#manage-list").innerHTML = rows.length ? rows.map((record) => `<form class="manage-row" data-id="${escapeHtml(record.id)}">
    <div class="manage-owner"><span class="avatar">${escapeHtml((record.name || "?").trim().charAt(0))}</span><span><strong>${escapeHtml(record.name)}</strong><small>@${escapeHtml(record.username)} · ${escapeHtml(roles[record.role] || record.role)}</small></span></div>
    <label>เวลาเข้างาน<input name="checkInAt" type="datetime-local" value="${escapeHtml(localInput(record.check_in_at))}" required></label>
    <label>เวลาเลิกงาน<input name="checkOutAt" type="datetime-local" value="${escapeHtml(localInput(record.check_out_at))}"></label>
    <button type="submit">บันทึก</button>
  </form>`).join("") : empty("ไม่พบข้อมูล");
}

async function loadAttendance() {
  const scope = ["admin", "hr"].includes(state.user.role) ? "?scope=all" : "";
  const data = await api(`/api/attendance${scope}`);
  state.rows = data.rows || [];
  state.today = data.today || null;
  renderAttendance();
}

function showApp(user) {
  state.user = user;
  $("#loading").classList.add("hidden");
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#profile-name").textContent = user.name;
  $("#profile-role").textContent = roles[user.role] || user.role;
  $("#profile-avatar").textContent = (user.name || "T").trim().charAt(0);
  $$(".role-only").forEach((element) => element.classList.toggle("hidden", element.dataset.role !== user.role));
  switchView("today");
}

function showLogin() {
  state.user = null;
  $("#loading").classList.add("hidden");
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
}

async function initialize() {
  try {
    const data = await api("/api/session");
    if (!data.user) return showLogin();
    showApp(data.user);
    await loadAttendance();
  } catch (error) {
    showLogin();
    $("#login-error").textContent = errorText(error);
    $("#login-error").classList.remove("hidden");
  }
}

function switchView(view) {
  if (view === "users" && state.user.role !== "admin") view = "today";
  if (view === "manage" && state.user.role !== "hr") view = "today";
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("hidden", element.id !== `view-${view}`));
  $$('[data-view]').forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "users") void loadUsers();
}

function position(options) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: Math.max(0, coords.accuracy || 0) }), reject, options));
}

function permissionDenied(error) {
  return Number(error?.code) === 1 || error?.message === "location_denied";
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

function showLineBrowserHelp() {
  $("#open-external-browser").href = externalBrowserUrl();
  $("#line-browser-dialog").classList.remove("hidden");
}

function requestLocation() {
  if (state.locationPromise) return state.locationPromise;
  if (isLineBrowser() && !state.allowLineGps) {
    showLineBrowserHelp();
    return Promise.reject(new Error("line_browser_location"));
  }
  if (!window.isSecureContext && location.hostname !== "localhost") return Promise.reject(new Error("location_required"));
  if (!navigator.geolocation) return Promise.reject(new Error("location_required"));
  $("#location-title").textContent = "กำลังหาตำแหน่ง…";
  $("#location-button").disabled = true;
  state.locationPromise = position({ enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 })
    .catch((error) => { if (permissionDenied(error)) throw new Error("location_denied"); return position({ enableHighAccuracy: false, timeout: 15000, maximumAge: 0 }); })
    .catch((error) => { if (permissionDenied(error)) throw new Error("location_denied"); return position({ enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }); })
    .catch((error) => { throw new Error(permissionDenied(error) ? "location_denied" : "location_timeout"); })
    .then((point) => {
      state.location = point;
      $("#location-button").classList.add("located");
      $("#location-icon").textContent = "✓";
      $("#location-title").textContent = "ยืนยันตำแหน่งแล้ว";
      $("#location-detail").textContent = `ความแม่นยำประมาณ ${Math.round(point.accuracy)} เมตร`;
      return point;
    })
    .finally(() => {
      state.locationPromise = null;
      $("#location-button").disabled = state.today?.check_out_at || false;
      if (!state.location) $("#location-title").textContent = "แตะเพื่อตรวจสอบตำแหน่ง";
    });
  return state.locationPromise;
}

function locationHelp() {
  const userAgent = navigator.userAgent;
  const android = /Android/i.test(userAgent);
  const ios = /iPhone|iPad|iPod/i.test(userAgent);
  $("#location-instructions").textContent = android
    ? "Android: เปิดตำแหน่ง แล้วกลับมาที่ Chrome แตะไอคอนข้างที่อยู่เว็บ > สิทธิ์ > ตำแหน่ง > อนุญาต"
    : ios ? "iPhone/iPad: การตั้งค่า > ความเป็นส่วนตัวและความปลอดภัย > บริการหาตำแหน่ง > Safari Websites > ขณะใช้แอป และเปิดตำแหน่งที่ตั้งจริง"
    : "เปิดบริการตำแหน่งของเครื่อง แล้วอนุญาตตำแหน่งให้เว็บไซต์จากไอคอนข้างช่องที่อยู่";
  const link = $("#open-settings");
  link.classList.toggle("hidden", !android && !ios);
  if (android) link.href = "intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end";
  if (ios) link.href = "App-Prefs:Privacy&path=LOCATION";
  $("#location-dialog").classList.remove("hidden");
}

function handleLocationError(error) {
  toast(errorText(error), "error");
  if (isLineBrowser()) showLineBrowserHelp();
  else locationHelp();
}

async function photoSource(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fallback for older iOS */ }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

async function optimizePhoto(file) {
  if (file.size <= 500 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  const decoded = await photoSource(file);
  const scale = Math.min(1, 960 / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const context = canvas.getContext("2d");
  if (!context) { decoded.close(); return file; }
  context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  decoded.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.68));
  return blob ? new File([blob], `attendance-${Date.now()}.jpg`, { type: "image/jpeg" }) : file;
}

function setPhoto(file) {
  state.photo = file;
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = file ? URL.createObjectURL(file) : "";
  $("#photo-preview").src = state.photoUrl;
  $("#photo-preview").classList.toggle("hidden", !file);
  $("#camera-empty").classList.toggle("hidden", Boolean(file));
  $("#retake").classList.toggle("hidden", !file);
}

async function record(action) {
  if (!state.photo) return $("#photo-input").click();
  if (state.busy) return;
  state.busy = true;
  renderAttendance();
  const button = action === "check-in" ? $("#check-in") : $("#check-out");
  const original = button.textContent;
  button.textContent = "กำลังบันทึก…";
  try {
    const point = state.location || await requestLocation();
    const form = new FormData();
    form.set("action", action);
    form.set("photo", state.photo);
    form.set("lat", String(point.lat));
    form.set("lng", String(point.lng));
    form.set("accuracy", String(point.accuracy));
    form.set("device_time", new Date().toISOString());
    await api("/api/attendance", { method: "POST", body: form });
    setPhoto(null);
    state.location = null;
    $("#location-button").classList.remove("located");
    $("#location-icon").textContent = "●";
    $("#location-title").textContent = "แตะเพื่อตรวจสอบตำแหน่ง";
    $("#location-detail").textContent = "ระบบต้องใช้ GPS เพื่อบันทึกเวลา";
    toast(action === "check-in" ? "บันทึกเข้างานเรียบร้อย" : "บันทึกเลิกงานเรียบร้อย");
    await loadAttendance();
  } catch (error) {
    if (["location_required", "location_denied", "location_timeout", "line_browser_location"].includes(error.message)) handleLocationError(error);
    else toast(errorText(error), "error");
    if (error.status === 401) showLogin();
  } finally {
    state.busy = false;
    button.textContent = original;
    if (state.user) renderAttendance();
  }
}

async function loadUsers() {
  try {
    const data = await api("/api/users");
    state.users = data.users || [];
    $("#user-count").textContent = `${state.users.length} คน`;
    $("#user-list").innerHTML = state.users.length ? state.users.map((user) => `<article class="user-row"><span class="avatar">${escapeHtml((user.name || "?").charAt(0))}</span><span><strong>${escapeHtml(user.name)}</strong><small>@${escapeHtml(user.username)}</small></span><b class="role-badge">${escapeHtml(roles[user.role] || user.role)}</b></article>`).join("") : empty("ยังไม่มีผู้ใช้งาน");
  } catch (error) { toast(errorText(error), "error"); }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  $("#login-error").classList.add("hidden");
  try {
    const fields = new FormData(form);
    const data = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: fields.get("username"), password: fields.get("password") }) });
    form.reset();
    showApp(data.user);
    await loadAttendance();
  } catch (error) {
    $("#login-error").textContent = errorText(error);
    $("#login-error").classList.remove("hidden");
  } finally { button.disabled = false; }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => null);
  state.rows = []; state.today = null; setPhoto(null); showLogin();
});

$("#logo-home").addEventListener("click", () => switchView("today"));
$$('[data-view]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#open-history").addEventListener("click", () => switchView("history"));
$("#toast button").addEventListener("click", () => $("#toast").classList.add("hidden"));
$("#camera").addEventListener("click", () => $("#photo-input").click());
$("#photo-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { setPhoto(await optimizePhoto(file)); if (!state.location) void requestLocation().catch(handleLocationError); }
  catch { toast("ไม่สามารถเตรียมรูปนี้ได้ กรุณาถ่ายใหม่", "error"); }
  event.target.value = "";
});
$("#location-button").addEventListener("click", () => void requestLocation().catch(handleLocationError));
$("#check-in").addEventListener("click", () => void record("check-in"));
$("#check-out").addEventListener("click", () => void record("check-out"));
$("#location-close").addEventListener("click", () => $("#location-dialog").classList.add("hidden"));
$("#retry-location").addEventListener("click", () => { $("#location-dialog").classList.add("hidden"); void requestLocation().catch(handleLocationError); });
$("#continue-line").addEventListener("click", () => {
  state.allowLineGps = true;
  $("#line-browser-dialog").classList.add("hidden");
  void requestLocation().catch(handleLocationError);
});
$("#copy-external-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(externalBrowserUrl());
    toast("คัดลอกลิงก์สำหรับเปิดภายนอกแล้ว");
  } catch {
    toast("คัดลอกไม่ได้ กรุณาแตะเปิดเบราว์เซอร์ภายนอก", "error");
  }
});
$("#history-search").addEventListener("input", renderHistory);
$("#manage-search").addEventListener("input", renderManage);

$("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset(); toast("เพิ่มผู้ใช้งานเรียบร้อย"); await loadUsers();
  } catch (error) { toast(errorText(error), "error"); }
  finally { button.disabled = false; }
});

$("#manage-list").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target.closest("form");
  if (!form) return;
  const button = form.querySelector("button");
  const fields = new FormData(form);
  button.disabled = true;
  try {
    await api("/api/attendance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: form.dataset.id, checkInAt: fields.get("checkInAt"), checkOutAt: fields.get("checkOutAt") }) });
    toast("แก้ไขเวลาเรียบร้อย"); await loadAttendance();
  } catch (error) { toast(errorText(error), "error"); }
  finally { button.disabled = false; }
});

function updateClock() {
  const now = new Date();
  $("#clock-time").textContent = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  $("#clock-date").textContent = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "full" }).format(now);
}

updateClock();
window.setInterval(updateClock, 1000);
if (isLineBrowser() && !new URL(window.location.href).searchParams.has("openExternalBrowser")) showLineBrowserHelp();
void initialize();
