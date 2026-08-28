const baseUrl = process.env.TTN_TEST_URL || "http://localhost:3000";
const username = process.env.TTN_TEST_USERNAME || "integration_admin";
const password = process.env.TTN_TEST_PASSWORD || `TTN-test-${crypto.randomUUID()}`;

async function json(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

const session = await json(await fetch(`${baseUrl}/api/session`));
let cookie = "";

if (session.needsSetup) {
  const response = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, name: "Integration Admin", password }),
  });
  cookie = (response.headers.get("set-cookie") || "").split(";")[0];
  await json(response);
} else {
  if (!process.env.TTN_TEST_PASSWORD) {
    throw new Error("Set TTN_TEST_USERNAME and TTN_TEST_PASSWORD when the local database is already initialized.");
  }
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  cookie = (response.headers.get("set-cookie") || "").split(";")[0];
  await json(response);
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0pQAAAAASUVORK5CYII=", "base64");

async function record(action) {
  const form = new FormData();
  form.set("action", action);
  form.set("photo", new Blob([png], { type: "image/png" }), "proof.png");
  form.set("lat", "13.7563");
  form.set("lng", "100.5018");
  form.set("accuracy", "8");
  form.set("device_time", new Date().toISOString());
  return json(await fetch(`${baseUrl}/api/attendance`, { method: "POST", headers: { cookie }, body: form }));
}

await record("check-in");
await record("check-out");

const list = await json(await fetch(`${baseUrl}/api/attendance?scope=all`, { headers: { cookie } }));
if (list.rows.length !== 1 || !list.today?.check_out_at) throw new Error("Attendance round-trip did not complete.");

const photo = await fetch(`${baseUrl}${list.rows[0].check_in_photo_url}`, { headers: { cookie } });
if (!photo.ok || photo.headers.get("content-type") !== "image/png") throw new Error("Stored photo could not be read back.");

console.log(JSON.stringify({ setup: true, checkIn: true, checkOut: true, rows: list.rows.length, photo: photo.status }));
