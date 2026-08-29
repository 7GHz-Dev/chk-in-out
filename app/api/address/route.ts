import { currentUser, jsonError, jsonOk } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_POINTS = 40;
// ค้นที่อยู่ใหม่ได้ไม่เกินนี้ต่อ 1 คำขอ ที่เหลือรอรอบถัดไป — กันยิงบริการภายนอกรัวเกินไป
const MAX_LOOKUPS = 8;
const NOMINATIM_GAP_MS = 1_100;
const USER_AGENT = "T-TIME-Attendance/1.0 (https://chk-in-out.vercel.app)";

/**
 * พิกัดเดิมถูกเรียกซ้ำทั้งวัน (พนักงานเข้างานที่เดิม) จึงจำคำตอบไว้ในหน่วยความจำของ
 * instance นั้น ๆ ตารางทั้งหน้าจึงมักเหลือที่อยู่ใหม่ให้ค้นแค่ไม่กี่จุด
 */
const cache = new Map<string, { text: string; at: number }>();
// จุดที่หาไม่เจอเก็บไว้ชั่วคราวเท่านั้น ผ่านไปสิบนาทีค่อยลองใหม่ เผื่อผู้ให้บริการล่มชั่วคราว
const MISS_RETRY_MS = 10 * 60 * 1000;

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
  const bangkok = /กรุงเทพ|Bangkok/i.test(`${parts.province} ${parts.amphoe} ${parts.tambon}`);
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

/**
 * ทั้ง Nominatim และ Photon คืนชื่อไทยที่มีคำนำหน้าติดมา (ตำบล.../อำเภอ.../จังหวัด...)
 * จึงคัดจากคำนำหน้าก่อน แล้วค่อยถอยไปดูชื่อฟิลด์ เพราะไทยใช้ city_district เป็นตำบล
 * และ county เป็นอำเภอ ซึ่งสวนทางกับความหมายของชื่อฟิลด์
 */
function localityFromParts(
  source: Record<string, string | undefined>,
  fallback: { tambon: string[]; amphoe: string[]; province: string[] },
) {
  const parts = { tambon: "", amphoe: "", province: "" };
  for (const [key, raw] of Object.entries(source)) {
    if (key === "country_code" || key === "countrycode" || key.startsWith("ISO")) continue;
    const value = String(raw || "").trim();
    if (!value) continue;
    if (!parts.tambon && TAMBON_PREFIXES.some((prefix) => value.startsWith(prefix))) parts.tambon = value;
    else if (!parts.amphoe && AMPHOE_PREFIXES.some((prefix) => value.startsWith(prefix))) parts.amphoe = value;
    else if (!parts.province && value.startsWith("จังหวัด")) parts.province = value;
  }

  const tambon = parts.tambon || firstOf(source, fallback.tambon);
  let amphoe = parts.amphoe || firstOf(source, fallback.amphoe);
  // กรุงเทพฯ ไม่มีฟิลด์จังหวัด ชื่อ "กรุงเทพมหานคร" มาในฟิลด์ city ซึ่งบางเจ้าถูกหยิบไปเป็นอำเภอ
  let province = parts.province || firstOf(source, fallback.province);
  if (/กรุงเทพ|Bangkok/i.test(`${province} ${amphoe}`)) {
    province = "กรุงเทพมหานคร";
    if (/กรุงเทพ|Bangkok/i.test(amphoe)) amphoe = "";
  }
  return composeLocality({
    tambon,
    amphoe,
    province: province === amphoe ? "" : province,
    postcode: firstOf(source, ["postcode"]),
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
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) return "";
  const payload = await response.json() as { address?: Record<string, string | undefined> };
  if (!payload.address) return "";
  return localityFromParts(payload.address, {
    tambon: ["suburb", "quarter", "village", "neighbourhood", "hamlet"],
    amphoe: ["county", "city_district", "district", "municipality", "town", "city"],
    province: ["province", "state", "city"],
  });
}

/** Photon ของ komoot อ่านข้อมูล OSM ชุดเดียวกันแต่ผ่อนปรนกับการเรียกจากเซิร์ฟเวอร์มากกว่า */
async function lookupPhoton(lat: number, lng: number) {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("lang", "default");
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) return "";
  const payload = await response.json() as { features?: { properties?: Record<string, string | undefined> }[] };
  const properties = payload.features?.[0]?.properties;
  if (!properties) return "";
  return localityFromParts(properties, {
    tambon: ["district", "locality", "suburb", "quarter"],
    amphoe: ["county", "city", "town"],
    province: ["state", "province", "city"],
  });
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);

  const points = parsePoints(new URL(request.url).searchParams.get("points") || "");
  const addresses: Record<string, string> = {};
  const pending = points.filter((point) => {
    const cached = cache.get(point.key);
    if (!cached) return true;
    if (!cached.text && Date.now() - cached.at > MISS_RETRY_MS) return true;
    addresses[point.key] = cached.text;
    return false;
  });

  const googleKey = process.env.GOOGLE_MAPS_API_KEY || "";
  // ไล่ทีละเจ้าจนกว่าจะได้ชื่อพื้นที่ ผู้ให้บริการฟรีบางเจ้าบล็อก IP ของคลาวด์เป็นครั้งคราว
  const providers: { name: string; run: (lat: number, lng: number) => Promise<string> }[] = [];
  if (googleKey) providers.push({ name: "google", run: (lat, lng) => lookupGoogle(lat, lng, googleKey) });
  providers.push({ name: "photon", run: lookupPhoton });
  providers.push({ name: "nominatim", run: lookupNominatim });

  const lookups = pending.slice(0, MAX_LOOKUPS);
  for (let index = 0; index < lookups.length; index += 1) {
    const point = lookups[index];
    let address = "";
    for (const provider of providers) {
      try {
        if (provider.name === "nominatim" && index > 0) {
          await new Promise((resolve) => setTimeout(resolve, NOMINATIM_GAP_MS));
        }
        address = await provider.run(point.lat, point.lng);
        if (address) break;
      } catch {
        // เจ้านี้ล่มหรือโดนปฏิเสธ ลองเจ้าถัดไป
      }
    }
    cache.set(point.key, { text: address, at: Date.now() });
    addresses[point.key] = address;
  }

  return jsonOk({ addresses, pending: Math.max(0, pending.length - lookups.length) });
}
