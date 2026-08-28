import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the PHP API and lightweight attendance UI", async () => {
  const [html, javascript, php, config] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../api/index.php", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /T TIME/);
  assert.match(javascript, /check-in/);
  assert.match(javascript, /check-out/);
  assert.match(javascript, /employee-driver/);
  assert.match(javascript, /employee-office/);
  assert.match(javascript, /LOCATION_SOURCE_SETTINGS/);
  assert.match(javascript, /App-Prefs:Privacy/);
  assert.match(php, /hash_pbkdf2\('sha256'/);
  assert.match(php, /hash_hmac\('sha256'/);
  assert.match(php, /backend\('recordAttendance'/);
  assert.match(php, /require_role\(\$user, 'hr'\)/);
  assert.match(config, /vercel-php@0\.9\.0/);
  assert.match(config, /"sin1"/);
  assert.doesNotMatch(html + javascript + php, /AKfycbzmhkDeleDam/);
});

