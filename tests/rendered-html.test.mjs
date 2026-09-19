import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships T TIME metadata and removes the starter preview", async () => {
  const [page, layout, client, backend, report, workConfig, users] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AttendanceApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/report/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/work-config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AttendanceApp/);
  assert.match(layout, /T TIME/);
  assert.match(client, /เข้างาน/);
  assert.match(client, /เลิกงาน/);
  assert.match(client, /enableHighAccuracy: false/);
  assert.match(client, /enableHighAccuracy: true/);
  assert.match(client, /location-help/);
  assert.match(client, /LOCATION_SOURCE_SETTINGS/);
  assert.match(client, /App-Prefs:Privacy/);
  assert.match(client, /openExternalBrowser/);
  assert.match(client, /isLineBrowser/);
  assert.match(client, /line-browser-help/);
  assert.match(client, /attendanceDate/);
  assert.match(client, /รายงานเวลาทำงาน/);
  assert.match(client, /MapThumbnail/);
  assert.match(client, /maps\.google\.com\/maps\?q=/);
  assert.match(client, /output=embed/);
  assert.match(client, /\/api\/map\?lat=/);
  assert.match(client, /formatWeekdayDate/);
  assert.match(client, /PhotoThumbnail/);
  assert.match(client, /EvidencePopup/);
  assert.match(client, /openPreview\(\{ type: "photo"/);
  assert.match(client, /openPreview\(\{ type: "map"/);
  assert.match(client, /dashboard-kpis/);
  assert.match(client, /payroll-row/);
  assert.match(client, /\/api\/work-config/);
  assert.match(client, /attendance-group-head/);
  assert.match(client, /AttendanceTable/);
  assert.doesNotMatch(client, /สถานที่เข้างาน/);
  assert.doesNotMatch(client, /สถานที่เลิกงาน/);
  assert.doesNotMatch(client, />แดชบอร์ด<\/button>/);
  assert.doesNotMatch(client, /EvidencePair/);
  assert.doesNotMatch(client, /จัดการเวลา/);
  assert.match(client, /user-edit-form/);
  assert.match(client, /async function saveUser/);
  assert.match(client, /async function toggleUserActive/);
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /method: "DELETE"/);
  assert.match(backend, /function ttnWorkDate_/);
  assert.match(backend, /work_date: ttnWorkDate_/);
  assert.match(backend, /Math\.min\(5000/);
  assert.match(backend, /function ttnWorkConfig_/);
  assert.match(backend, /function ttnSavePayroll_/);
  assert.match(backend, /function ttnUpdateUser_/);
  assert.match(backend, /function ttnSetUserActive_/);
  assert.match(backend, /case "updateUser"/);
  assert.match(backend, /case "setUserActive"/);
  assert.match(backend, /throw new Error\("last_admin"\)/);
  assert.match(users, /export async function PATCH/);
  assert.match(users, /export async function DELETE/);
  assert.match(users, /cannot_disable_self/);
  // ทุก handler ของหน้าผู้ใช้ต้องกันคนที่ไม่ใช่แอดมินออกก่อนแตะข้อมูล
  assert.equal(users.match(/admin\.role !== "admin"/g)?.length, 3);
  assert.match(workConfig, /user\.role !== "admin" && user\.role !== "hr"/);
  assert.match(workConfig, /backendReady/);
  assert.match(report, /user\.role !== "admin" && user\.role !== "hr"/);
  assert.match(report, /limit: MAX_REPORT_ROWS/);
  assert.match(report, /addWorksheet\("สรุปรายงาน"/);
  assert.match(report, /addWorksheet\("สรุปรายบุคคล"/);
  assert.match(report, /addWorksheet\("รายละเอียดลงเวลา"/);
  assert.match(report, /sheet\.autoFilter/);
  assert.match(report, /workbook\.xlsx\.writeBuffer/);
  assert.doesNotMatch(client, /พร้อม\{nextAction\}/);
  assert.doesNotMatch(client, /ถ่ายรูป ยืนยันตำแหน่ง แล้วบันทึกเวลาได้ในไม่กี่วินาที/);
  assert.doesNotMatch(page + layout + client, /SkeletonPreview|codex-preview/);
});
