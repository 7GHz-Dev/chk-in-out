type BackendEnvelope = Record<string, unknown> & { ok: boolean; error?: string };

export async function callGoogleBackend<T extends Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const token = process.env.GOOGLE_APPS_SCRIPT_TOKEN;
  if (!url || !token) throw new Error("backend_not_configured");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, token, ...payload }),
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error("backend_unavailable");
  const result = await response.json().catch(() => null) as BackendEnvelope | null;
  if (!result) throw new Error("backend_invalid_response");
  if (!result.ok) throw new Error(String(result.error || "backend_error"));
  return result as T;
}
