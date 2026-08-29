import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the PHP API and lightweight attendance UI", async () => {
  const [html, javascript, php, css, readme, config] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../api/index.php", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /T TIME/);
  assert.match(javascript, /check-in/);
  assert.match(javascript, /check-out/);
  assert.match(javascript, /employee-driver/);
  assert.match(javascript, /employee-office/);
  assert.match(javascript, /LOCATION_SOURCE_SETTINGS/);
  assert.match(javascript, /App-Prefs:Privacy/);
  assert.match(javascript, /openExternalBrowser/);
  assert.match(javascript, /isLineBrowser/);
  assert.match(html, /line-browser-dialog/);
  assert.match(html, /view-report/);
  assert.match(html, /report-filters/);
  assert.match(html, /ดาวน์โหลด Excel/);
  assert.match(javascript, /\/api\/report\?/);
  assert.match(javascript, /\/api\/report-data/);
  assert.match(javascript, /IntersectionObserver/);
  assert.match(javascript, /maps\.google\.com\/maps\?q=/);
  assert.match(javascript, /output=embed/);
  assert.match(javascript, /\/api\/map\?lat=/);
  assert.match(javascript, /en-GB/);
  assert.match(php, /maps\/api\/staticmap/);
  assert.doesNotMatch(html + javascript, /จัดการเวลา/);
  assert.match(css, /\.map-thumb/);
  assert.match(php, /hash_pbkdf2\('sha256'/);
  assert.match(php, /hash_hmac\('sha256'/);
  assert.match(php, /backend\('recordAttendance'/);
  assert.match(php, /require_role\(\$user, 'hr'\)/);
  assert.match(php, /require_role\(\$user, 'admin', 'hr'\)/);
  assert.match(php, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(php, /ZipArchive/);
  assert.match(php, /zip_store/);
  assert.match(php, /Summary/);
  assert.match(php, /Attendance Details/);
  assert.match(php, /Employee Summary/);
  assert.match(php, /function report_employee_summary/);
  assert.match(php, /autoFilter/);
  assert.match(php, /'limit' => 5000/);
  assert.match(readme, /รายงาน Excel/);
  assert.match(config, /vercel-php@0\.9\.0/);
  assert.match(config, /"sin1"/);
  assert.doesNotMatch(html + javascript + php, /AKfycbzmhkDeleDam/);
});
