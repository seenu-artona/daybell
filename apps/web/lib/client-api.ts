import type { ApiErrorBody } from "@daybell/api";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; fields: Record<string, string> };

/** Calls /api/v1 from the browser. Screens use the same API as everyone else (D92). */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? null : JSON.stringify(init.body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: "", fields: {} };
  }
  if (res.ok) {
    const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    return { ok: true, data };
  }
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return {
    ok: false,
    status: res.status,
    code: body?.error.code ?? "internal",
    message: body?.error.message ?? "",
    fields: body?.error.fields ?? {},
  };
}
