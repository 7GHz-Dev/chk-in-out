import { callGoogleBackend } from "./google-backend";
import { normalizeRole, type Role } from "./database";

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

export type StoredUser = AppUser & {
  passwordHash: string;
  passwordSalt: string;
  createdAt?: string;
  updatedAt?: string;
};

type SessionPayload = {
  id: string;
  exp: number;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const matches = value.match(/.{1,2}/g) || [];
  return new Uint8Array(matches.map((byte) => Number.parseInt(byte, 16)));
}

function base64UrlEncode(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("session_not_configured");
  return secret;
}

async function sessionSignature(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export function randomHex(size = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(size)));
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

async function verifySession(token: string): Promise<SessionPayload | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sessionSignature(payload);
  const actual = base64UrlDecode(signature);
  if (actual.length !== expected.length) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  if (difference !== 0) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
  if (!parsed.id || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
  return parsed;
}

function publicUser(user: StoredUser): AppUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: normalizeRole(user.role),
    active: Boolean(user.active),
  };
}

export async function currentUser(request: Request): Promise<AppUser | null> {
  const token = parseCookies(request)[COOKIE_NAME] || "";
  if (!token) return null;
  try {
    const session = await verifySession(token);
    if (!session) return null;
    const result = await callGoogleBackend<{ user: StoredUser | null }>("findUser", { userId: session.id });
    if (!result.user?.active) return null;
    return publicUser(result.user);
  } catch {
    return null;
  }
}

export async function createSession(userId: string) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    id: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  } satisfies SessionPayload)));
  return `${payload}.${base64UrlEncode(await sessionSignature(payload))}`;
}

export function setSessionCookie(response: Response, request: Request, token: string) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
  return response;
}

export function clearSession(response: Response) {
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`);
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

export function backendErrorStatus(message: string) {
  if (["username_exists", "setup_already_complete", "already_checked_in", "already_checked_out"].includes(message)) return 409;
  if (message === "account_disabled") return 403;
  if (message === "photo_not_found") return 404;
  if (["backend_not_configured", "backend_not_initialized", "backend_unavailable", "backend_invalid_response"].includes(message)) return 503;
  return 400;
}
