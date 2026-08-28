import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships TTN Time metadata and removes the starter preview", async () => {
  const [page, layout, client] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AttendanceApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AttendanceApp/);
  assert.match(layout, /TTN Time/);
  assert.match(client, /เข้างาน/);
  assert.match(client, /เลิกงาน/);
  assert.doesNotMatch(page + layout + client, /SkeletonPreview|codex-preview/);
});
