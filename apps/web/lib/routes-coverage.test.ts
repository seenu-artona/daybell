import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROUTES } from "@daybell/api";
import { describe, expect, it } from "vitest";

// Every /api/v1 route file must be described in packages/api/src/routes.ts, and every description must have a route
// file, so the docs can never drift from the code (D92).
const ROOT = join(__dirname, "..", "app", "api", "v1");
const UNDOCUMENTED_BY_DESIGN = new Set(["GET /openapi.json"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /^route\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

function implemented(): string[] {
  return routeFiles(ROOT).flatMap((file) => {
    const path = `/${relative(ROOT, file).split(sep).slice(0, -1).join("/")}`.replace(
      /\[(\w+)\]/g,
      "{$1}",
    );
    const source = readFileSync(file, "utf8");
    const methods = [
      ...source.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g),
    ];
    return methods.map((m) => `${m[1]} ${path}`);
  });
}

describe("API docs coverage", () => {
  it("documents exactly the routes that exist", () => {
    const code = implemented()
      .filter((k) => !UNDOCUMENTED_BY_DESIGN.has(k))
      .sort();
    const docs = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(code).toEqual(docs);
  });
});
