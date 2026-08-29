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

type Locality = { tambon: string; amphoe: string; province: string; postcode: string };

const TAMBON_PREFIXES = ["ตำบล", "ตําบล", "แขวง", "ต.", "Tambon", "Khwaeng"];
const AMPHOE_PREFIXES = ["อำเภอ", "อําเภอ", "เขต", "อ.", "Amphoe", "Khet"];

function firstOf(source: Record<string, string | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = String(source[key] || "").trim();
    if (value) return value;
  }
  return "";
}

/** กรุงเทพฯ ใช้ แขวง/เขต ส่วนจังหวัดอื่นใช้ ตำบล/อำเภอ และไม่เติมซ้ำถ้าชื่อมีคำนำหน้าอยู่แล้ว */
function withPrefix(value: string, prefixes: string[], preferred: string) {
  if (!value) return "";
  return prefixes.some((prefix) => value.startsWith(prefix)) ? value : preferred + value;
}

function composeLocality(parts: Locality) {
  const bangkok = /กรุงเทพ|Bangkok/i.test(parts.province);
  const pieces = [
    withPrefix(parts.tambon, TAMBON_PREFIXES, bangkok ? "แขวง" : "ตำบล"),
    withPrefix(parts.amphoe, AMPHOE_PREFIXES, bangkok ? "เขต" : "อำเภอ"),
    parts.province,
    parts.postcode,
  ];
  return pieces.filter(Boolean).join(" ");
}

async function lookupGoogle(lat: number, lng: number, key: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("language", "th");
  url.searchParams.set("region", "TH");
  url.searchParams.set("result_type", "sublocality|locality|administrative_area_level_1|administrative_area_level_2");
  url.searchParams.set("key", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6_000) });
  if (!response.ok) return "";
  const payload = await response.json() as {
    status?: string;
    results?: { address_components?: { long_name?: string; types?: string[] }[] }[];
  };
  if (payload.status !== "OK") return "";

  const byType: Record<string, string> = {};
  for (const result of payload.results || []) {
    for (const component of result.address_components || []) {
      for (const type of component.types || []) {
        if (!byType[type]) byType[type] = String(component.long_name || "");
      }
    }
  }
  return composeLocality({
    tambon: firstOf(byType, ["sublocality_level_2", "sublocality_level_1", "sublocality", "administrative_area_level_3", "neighborhood"]),
    amphoe: firstOf(byType, ["administrative_area_level_2", "locality"]),
    province: firstOf(byType, ["administrative_area_level_1"]),
    postcode: firstOf(byType, ["postal_code"]),
  });
}

async function lookupNominatim(lat: number, lng: number) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "16");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "th");
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
    // Nominatim บังคับให้ระบุตัวตนของแอปที่เรียก ไม่งั้นโดนบล็อก
    headers: { "User-Agent": "T-TIME-Attendance/1.0 (https://chk-in-out.vercel.app)", accept: "application/json" },
  });
  if (!response.ok) return "";
  const payload = await response.json() as { address?: Record<string, string | undefined>; display_name?: string };
  const address = payload.address;
  if (!address) return String(payload.display_name || "");

  // ชื่อไทยจาก OSM มีคำนำหน้าติดมาอยู่แล้ว (ตำบล.../อำเภอ.../จังหวัด...) แยกจากคำนำหน้าจึงแม่นกว่า
  // ดูจากชื่อฟิลด์ เพราะ Thailand ใช้ city_district เป็นตำบล และ county เป็นอำเภอ ซึ่งสวนทางกับชื่อฟิลด์
  const parts = { tambon: "", amphoe: "", province: "" };
  for (const [key, raw] of Object.entries(address)) {
    if (key === "country_code" || key.startsWith("ISO")) continue;
    const value = String(raw || "").trim();
    if (!value) continue;
    if (!parts.tambon && TAMBON_PREFIXES.some((prefix) => value.startsWith(prefix))) parts.tambon = value;
    else if (!parts.amphoe && AMPHOE_PREFIXES.some((prefix) => value.startsWith(prefix))) parts.amphoe = value;
    else if (!parts.province && value.startsWith("จังหวัด")) parts.province = value;
  }

  const tambon = parts.tambon || firstOf(address, ["suburb", "quarter", "village", "neighbourhood", "hamlet"]);
  const amphoe = parts.amphoe || firstOf(address, ["county", "city_district", "district", "municipality", "town", "city"]);
  // กรุงเทพฯ ไม่มีฟิลด์จังหวัด ชื่อ "กรุงเทพมหานคร" มาในฟิลด์ city จึงต้องเผื่อไว้ แต่กันไม่ให้ซ้ำกับอำเภอ
  const province = parts.province || firstOf(address, ["province", "state", "city"]);
  const locality = composeLocality({
    tambon,
    amphoe,
    province: province === amphoe ? "" : province,
    postcode: firstOf(address, ["postcode"]),
  });
  // บางจุด OSM ไม่มีข้อมูลเขตการปกครองครบ ใช้ชื่อยาวของมันไปก่อนดีกว่าไม่แสดงอะไรเลย
  return locality || String(payload.display_name || "");
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
