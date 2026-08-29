import { currentUser, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Static Maps รับได้สูงสุด 640x640 ต่อภาพ (คูณ scale อีกทีตอนส่งกลับ)
const MIN_SIZE = 80;
const MAX_SIZE = 640;

function clampNumber(value: string | null, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * พร็อกซีภาพแผนที่จาก Google Static Maps — ไม่ส่ง API key ออกไปที่เบราว์เซอร์
 * ทำให้จำกัด key ไว้เฉพาะ IP ของเซิร์ฟเวอร์ได้ และกันคนอื่นเอา key ไปใช้จนโดนคิดเงิน
 */
export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("unauthorized", 401);

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return jsonError("maps_not_configured", 503);

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return jsonError("invalid_coordinates");
  }

  const width = clampNumber(params.get("w"), MIN_SIZE, MAX_SIZE, 320);
  const height = clampNumber(params.get("h"), MIN_SIZE, MAX_SIZE, 190);
  const zoom = clampNumber(params.get("zoom"), 1, 20, 16);
  const center = `${lat.toFixed(6)},${lng.toFixed(6)}`;

  const target = new URL("https://maps.googleapis.com/maps/api/staticmap");
  target.searchParams.set("center", center);
  target.searchParams.set("zoom", String(zoom));
  target.searchParams.set("size", `${width}x${height}`);
  target.searchParams.set("scale", "2");
  target.searchParams.set("maptype", "roadmap");
  target.searchParams.set("language", "th");
  target.searchParams.set("region", "TH");
  target.searchParams.set("markers", `color:0xed5f42|${center}`);
  target.searchParams.set("key", key);

  try {
    const response = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.startsWith("image/")) return jsonError("maps_unavailable", 502);
    return new Response(Buffer.from(await response.arrayBuffer()), {
      headers: {
        "Content-Type": type,
        // ภาพแผนที่ของพิกัดหนึ่ง ๆ ไม่มีวันเปลี่ยน เก็บไว้ในเครื่องผู้ใช้ได้ยาว ๆ
        "Cache-Control": "private, max-age=604800, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("maps_unavailable", 502);
  }
}
