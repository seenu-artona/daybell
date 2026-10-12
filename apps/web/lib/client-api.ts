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

export type DownloadResult =
  | { ok: true; headers: Headers }
  | { ok: false; status: number; code: string; fields: Record<string, string> };

/**
 * POSTs to /api/v1 and saves the file it answers with (e.g. the QR card PDF, ADR 0015). The request body stays out of
 * the URL; the file is handed to the browser through a short-lived object URL and never kept.
 */
export async function download(path: string, body: unknown): Promise<DownloadResult> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, code: "network", fields: {} };
  }
  if (!res.ok) {
    const error = ((await res.json().catch(() => null)) as ApiErrorBody | null)?.error;
    return {
      ok: false,
      status: res.status,
      code: error?.code ?? "internal",
      fields: error?.fields ?? {},
    };
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "download";
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { ok: true, headers: res.headers };
}
