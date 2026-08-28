import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships T TIME metadata and removes the starter preview", async () => {
  const [page, layout, client] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AttendanceApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AttendanceApp/);
  assert.match(layout, /T TIME/);
  assert.match(client, /เข้างาน/);
  assert.match(client, /เลิกงาน/);
  assert.match(client, /attendance-management/);
  assert.match(client, /enableHighAccuracy: false/);
  assert.match(client, /enableHighAccuracy: true/);
  assert.doesNotMatch(client, /พร้อม\{nextAction\}/);
  assert.doesNotMatch(client, /ถ่ายรูป ยืนยันตำแหน่ง แล้วบันทึกเวลาได้ในไม่กี่วินาที/);
  assert.doesNotMatch(page + layout + client, /SkeletonPreview|codex-preview/);
});
