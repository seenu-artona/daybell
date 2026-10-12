import { type DataRegion, isDataRegion } from "@daybell/config";
import { StorageError } from "@daybell/storage";
import { localStorageDriver } from "@/lib/photo-storage";
import { REGION_COOKIE } from "@/lib/region";

/**
 * The local storage driver's endpoint (STORAGE_DRIVER=local only: development, CI and end-to-end tests; ADR 0016). It
 * stands in for S3's presigned URLs: PUT one part of an upload, GET a preview. Every request must carry a valid,
 * unexpired signature made by this server process; with any other driver this route doesn't exist (404). Not part of
 * /api/v1. Keys hold IDs only.
 */
export const runtime = "nodejs";

type Ctx = { params: Promise<{ key: string[] }> };

const notFound = () => new Response(null, { status: 404 });

function driver(request: Request) {
  // Never on Vercel, whatever the settings say (review S7).
  if (process.env.VERCEL) return null;
  // The region a local stack runs (one database); the cookie only picks among those configured.
  const cookie = request.headers.get("cookie")?.match(new RegExp(`${REGION_COOKIE}=(\\w+)`))?.[1];
  const region: DataRegion = isDataRegion(cookie) ? cookie : "ca";
  return localStorageDriver(region) ?? localStorageDriver("ca");
}

function refused(err: unknown): Response {
  if (err instanceof StorageError && err.code === "not_found") return notFound();
  if (err instanceof StorageError) return new Response(null, { status: 403 });
  console.error("dev_storage_error", err instanceof Error ? err.name : "unknown");
  return new Response(null, { status: 500 });
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const storage = driver(request);
  if (!storage) return notFound();
  const key = (await ctx.params).key.join("/");
  try {
    const etag = await storage.receivePart(
      key,
      new URL(request.url).searchParams,
      new Uint8Array(await request.arrayBuffer()),
    );
    return new Response(null, { status: 200, headers: { etag } });
  } catch (err) {
    return refused(err);
  }
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const storage = driver(request);
  if (!storage) return notFound();
  const key = (await ctx.params).key.join("/");
  try {
    const body = await storage.readSigned(key, new URL(request.url).searchParams);
    return new Response(body, {
      headers: {
        "content-type": key.endsWith(".webp") ? "image/webp" : "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return refused(err);
  }
}
