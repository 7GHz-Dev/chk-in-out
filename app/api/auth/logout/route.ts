import { clearSession, jsonOk } from "@/lib/auth";
import { ensureDatabase } from "@/lib/database";

export async function POST(request: Request) {
  await ensureDatabase();
  return clearSession(request, jsonOk());
}
