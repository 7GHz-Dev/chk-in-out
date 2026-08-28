import { ensureDatabase, getBindings, normalizeRole, type Role } from "./database";

const COOKIE_NAME = "ttn_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export type AppUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
};

type UserRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  active: number;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const matches = value.match(/.{1,2}/g) || [];
  return new Uint8Array(matches.map((byte) => Number.parseInt(byte, 16)));
}

export function randomHex(size = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hashPassword(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: hexToBytes(saltHex),
    iterations: 120_000,
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

export function passwordsMatch(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function parseCookies(request: Request) {
  return Object.fromEntries((request.headers.get("cookie") || "").split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [name, decodeURIComponent(rest.join("="))];
  }).filter(([name]) => name));
}

export async function getSessionToken(request: Request) {
  return parseCookies(request)[COOKIE_NAME] || "";
}

function toUser(row: UserRow): AppUser {
  return { id: row.id, username: row.username, name: row.name, role: normalizeRole(row.role), active: Boolean(row.active) };
}

export async function currentUser(request: Request): Promise<AppUser | null> {
  await ensureDatabase();
  const rawToken = await getSessionToken(request);
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const { db } = getBindings();
  const row = await db.prepare(`SELECT u.id, u.username, u.name, u.role, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? LIMIT 1`).bind(tokenHash).first<UserRow & { expires_at: string }>();
  if (!row || !row.active || row.expires_at <= new Date().toISOString()) {
    if (row) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return toUser(row);
}

export async function createSession(userId: string) {
  const rawToken = randomHex(32);
  const tokenHash = await sha256(rawToken);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const { db } = getBindings();
  await db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, userId, now.toISOString(), expires.toISOString()).run();
  return rawToken;
}

export function setSessionCookie(response: Response, request: Request, rawToken: string) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
  return response;
}

export async function clearSession(request: Request, response: Response) {
  const rawToken = await getSessionToken(request);
  if (rawToken) {
    const { db } = getBindings();
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(rawToken)).run();
  }
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}

export function canViewAllAttendance(role: Role) {
  return role === "admin" || role === "hr";
}

export function jsonError(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk(data: Record<string, unknown> = {}, status = 200) {
  return Response.json({ ok: true, ...data }, { status, headers: { "Cache-Control": "no-store" } });
}
