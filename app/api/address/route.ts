import { currentUser, jsonError, jsonOk } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_POINTS = 40;
// ค้นที่อยู่ใหม่ได้ไม่เกินนี้ต่อ 1 คำขอ ที่เหลือรอรอบถัดไป — กันยิงบริการภายนอกรัวเกินไป
const MAX_LOOKUPS = 8;
const NOMINATIM_GAP_MS = 1_100;

/**
 * พิกัดเดิมถูกเรียกซ้ำทั้งวัน (พนักงานเข้างานที่เดิม) จึงจำคำตอบไว้ในหน่วยความจำของ
 * instance นั้น ๆ ตารางทั้งหน้าจึงมักเหลือที่อยู่ใหม่ให้ค้นแค่ไม่กี่จุด
 */
const cache = new Map<string, string>();

function pointKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function parsePoints(raw: string) {
  const points: { key: string; lat: number; lng: number }[] = [];
  const seen = new Set<string>();
  for (const part of raw.split("|")) {
    const [rawLat, rawLng] = part.split(",");
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const key = pointKey(lat, lng);
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ key, lat, lng });
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}

async function lookupGoogle(lat: number, lng: number, key: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("language", "th");
  url.searchParams.set("region", "TH");
  url.searchParams.set("key", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6_000) });
  if (!response.ok) return "";
  const payload = await response.json() as { status?: string; results?: { formatted_address?: string }[] };
  if (payload.status !== "OK") return "";
  return String(payload.results?.[0]?.formatted_address || "");
}

async function lookupNominatim(lat: number, lng: number) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", "th");
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
    // Nominatim บังคับให้ระบุตัวตนของแอปที่เรียก ไม่งั้นโดนบล็อก
    headers: { "User-Agent": "T-TIME-Attendance/1.0 (https://chk-in-out.vercel.app)", accept: "application/json" },
  });
  if (!response.ok) return "";
  const payload = await response.json() as { display_name?: string };
  return String(payload.display_name || "");
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);

  const points = parsePoints(new URL(request.url).searchParams.get("points") || "");
  const addresses: Record<string, string> = {};
  const pending = points.filter((point) => {
    const cached = cache.get(point.key);
    if (cached === undefined) return true;
    addresses[point.key] = cached;
    return false;
  });

  const googleKey = process.env.GOOGLE_MAPS_API_KEY || "";
  const lookups = pending.slice(0, MAX_LOOKUPS);
  for (let index = 0; index < lookups.length; index += 1) {
    const point = lookups[index];
    try {
      if (!googleKey && index > 0) await new Promise((resolve) => setTimeout(resolve, NOMINATIM_GAP_MS));
      const address = googleKey
        ? await lookupGoogle(point.lat, point.lng, googleKey)
        : await lookupNominatim(point.lat, point.lng);
      // จำผลว่างไว้ด้วย จะได้ไม่ยิงถามซ้ำจุดที่บริการตอบไม่ได้
      cache.set(point.key, address);
      addresses[point.key] = address;
    } catch {
      addresses[point.key] = "";
    }
  }

  return jsonOk({ addresses, pending: Math.max(0, pending.length - lookups.length) });
}
