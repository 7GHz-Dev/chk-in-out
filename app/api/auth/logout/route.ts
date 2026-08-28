import { clearSession, jsonOk } from "@/lib/auth";

export async function POST() {
  return clearSession(jsonOk());
}
