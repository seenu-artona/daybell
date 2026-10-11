import { buildOpenApi } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { NextResponse } from "next/server";

/** GET /api/v1/openapi.json — machine-readable description of this API (D92). */
export function GET() {
  return NextResponse.json(buildOpenApi(siteUrl()), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
