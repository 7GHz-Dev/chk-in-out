import { currentUser, jsonOk } from "@/lib/auth";
import { ensureDatabase, getBindings } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureDatabase();
  const { db } = getBindings();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  const user = await currentUser(request);
  return jsonOk({ needsSetup: Number(count?.count || 0) === 0, user });
}
