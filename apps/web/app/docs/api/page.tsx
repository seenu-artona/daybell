import { ROUTE_GROUPS, ROUTES, type RouteSpec } from "@daybell/api";
import { Badge, Card } from "@daybell/ui";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apiDocs");
  return { title: t("metaTitle") };
}

const METHOD_TONE = {
  GET: "selling",
  POST: "money",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "danger",
} as const;

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

/** Follows `$ref`s into `$defs` so named shapes show their fields. */
function resolve(s: JsonSchema, defs: Record<string, JsonSchema>): JsonSchema {
  if (s.$ref) {
    const name = s.$ref.split("/").pop() ?? "";
    const target = defs[name] ?? {};
    const description = s.description ?? target.description;
    return description === undefined ? target : { ...target, description };
  }
  return s;
}

function toSchema(
  schema: z.ZodType,
  io: "input" | "output" = "output",
): { root: JsonSchema; defs: Record<string, JsonSchema> } {
  const raw = z.toJSONSchema(schema, { unrepresentable: "any", io }) as JsonSchema;
  const defs = raw.$defs ?? {};
  return { root: resolve(raw, defs), defs };
}

/** Short type label; for `T | null` unions shows "T or null". */
function typeLabel(s: JsonSchema, defs: Record<string, JsonSchema>, arrayOf: string): string {
  const r = resolve(s, defs);
  const variants = r.anyOf ?? r.oneOf;
  if (variants) return variants.map((v) => typeLabel(v, defs, arrayOf)).join(" | ");
  if (r.const !== undefined) return JSON.stringify(r.const);
  if (r.enum) return r.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (r.type === "array" && r.items) return `${arrayOf} ${typeLabel(r.items, defs, arrayOf)}`;
  if (s.$ref) return s.$ref.split("/").pop() ?? "object";
  const type = Array.isArray(r.type) ? r.type.join(" | ") : (r.type ?? "object");
  return r.format ? `${type} (${r.format})` : type;
}

function Fields({
  schema,
  defs,
  depth = 0,
}: {
  schema: JsonSchema;
  defs: Record<string, JsonSchema>;
  depth?: number;
}) {
  const t = useTranslations("apiDocs");
  const s = resolve(schema, defs);
  const variants = s.anyOf ?? s.oneOf;
  if (variants?.some((v) => resolve(v, defs).properties)) {
    return (
      <div className="flex flex-col gap-3">
        {variants.map((v, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: variants are a fixed list.
          <div key={i}>
            <p className="m-0 mb-1 text-caption text-muted">{t("option", { n: i + 1 })}</p>
            <Fields schema={v} defs={defs} depth={depth} />
          </div>
        ))}
      </div>
    );
  }
  if (s.type === "array" && s.items) return <Fields schema={s.items} defs={defs} depth={depth} />;
  const props = Object.entries(s.properties ?? {});
  if (props.length === 0) return null;
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {props.map(([name, p]) => {
          const inner = resolve(p, defs);
          const nested =
            depth < 2 &&
            (inner.properties ||
              (inner.type === "array" && resolve(inner.items ?? {}, defs).properties));
          return (
            <tr key={name} className="border-b border-line align-top last:border-b-0">
              <td className="py-1.5 pr-3 font-mono text-label whitespace-nowrap">
                {name}
                {s.required?.includes(name) ? <span className="text-danger"> *</span> : null}
              </td>
              <td className="py-1.5 pr-3 font-mono text-label text-muted">
                {typeLabel(p, defs, t("arrayOf"))}
              </td>
              <td className="py-1.5 text-muted">
                {inner.description ?? ""}
                {nested ? (
                  <div className="mt-1 border-l-2 border-line pl-3">
                    <Fields schema={inner} defs={defs} depth={depth + 1} />
                  </div>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Route({ route }: { route: RouteSpec }) {
  const t = useTranslations("apiDocs");
  const query = route.query ? toSchema(route.query, "input") : null;
  const body = route.body ? toSchema(route.body) : null;
  const response = route.success.schema ? toSchema(route.success.schema) : null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={METHOD_TONE[route.method]}>{route.method}</Badge>
        <code className="font-mono text-sm font-semibold">/api/v1{route.path}</code>
        <span className="ml-auto text-caption text-muted">{t(`access.${route.access}`)}</span>
      </div>
      <p className="m-0 font-semibold">{route.summary}</p>
      {route.description ? <p className="m-0 text-muted">{route.description}</p> : null}
      {query ? (
        <div>
          <p className="m-0 mb-1 text-label">{t("query")}</p>
          <Fields schema={query.root} defs={query.defs} />
        </div>
      ) : null}
      {body ? (
        <div>
          <p className="m-0 mb-1 text-label">{t("body")}</p>
          <Fields schema={body.root} defs={body.defs} />
        </div>
      ) : null}
      <div>
        <p className="m-0 mb-1 text-label">
          {t("success", { status: route.success.status })} — {route.success.description}
        </p>
        {response ? <Fields schema={response.root} defs={response.defs} /> : null}
      </div>
      {route.errors.length ? (
        <p className="m-0 text-caption text-muted">
          {t("errors")}: {route.errors.join(", ")}
        </p>
      ) : null}
    </Card>
  );
}

/** Public API reference, generated from packages/api/src/routes.ts (D92, ADR 0007). */
export default function ApiDocsPage() {
  const t = useTranslations("apiDocs");
  return (
    <main className="mx-auto flex max-w-[880px] flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-h1">{t("title")}</h1>
        <p className="m-0 text-muted">{t("intro")}</p>
        <p className="m-0 text-caption text-muted">{t("englishOnly")}</p>
        <a href="/api/v1/openapi.json" className="font-semibold text-primary">
          {t("openapi")}
        </a>
      </header>
      {ROUTE_GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-3">
          <h2 className="m-0 text-h2">{t(`groups.${group}`)}</h2>
          {ROUTES.filter((r) => r.group === group).map((r) => (
            <Route key={`${r.method} ${r.path}`} route={r} />
          ))}
        </section>
      ))}
      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-h2">{t("errorsTitle")}</h2>
        <p className="m-0 text-muted">{t("errorsBody")}</p>
        <pre className="overflow-x-auto rounded-md bg-ink p-4 text-sm text-white">
          {`{ "error": { "code": "invalid_input", "message": "…", "fields": { "email": "validation.email" } } }`}
        </pre>
      </section>
    </main>
  );
}
