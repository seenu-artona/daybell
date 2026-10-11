import { ACCESS_LABEL, ROUTES, type RouteSpec } from "@daybell/api";
import { Badge, Card } from "@daybell/ui";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { z } from "zod";

export const metadata: Metadata = { title: "Daybell API" };

const METHOD_TONE = { GET: "selling", POST: "money", PUT: "warning", DELETE: "danger" } as const;

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  format?: string;
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
}

function typeLabel(s: JsonSchema): string {
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.format) return `${s.type ?? "string"} (${s.format})`;
  return s.type ?? "object";
}

function Fields({ schema }: { schema: JsonSchema }) {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    return (
      <div className="flex flex-col gap-3">
        {variants.map((v, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: variants are a fixed list.
          <div key={i}>
            <p className="m-0 mb-1 text-caption text-muted">Option {i + 1}</p>
            <Fields schema={v} />
          </div>
        ))}
      </div>
    );
  }
  const props = Object.entries(schema.properties ?? {});
  if (props.length === 0) return null;
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {props.map(([name, p]) => (
          <tr key={name} className="border-b border-line last:border-b-0 align-top">
            <td className="py-1.5 pr-3 font-mono text-[13px] whitespace-nowrap">
              {name}
              {schema.required?.includes(name) ? <span className="text-danger"> *</span> : null}
            </td>
            <td className="py-1.5 pr-3 font-mono text-[13px] text-muted">{typeLabel(p)}</td>
            <td className="py-1.5 text-muted">{p.description ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Route({ route }: { route: RouteSpec }) {
  const t = useTranslations("apiDocs");
  const body = route.body
    ? (z.toJSONSchema(route.body, { unrepresentable: "any" }) as JsonSchema)
    : null;
  const response = route.success.schema
    ? (z.toJSONSchema(route.success.schema, { unrepresentable: "any" }) as JsonSchema)
    : null;
  return (
    <Card className="flex flex-col gap-3" id={`${route.method}-${route.path}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={METHOD_TONE[route.method]}>{route.method}</Badge>
        <code className="font-mono text-sm font-semibold">/api/v1{route.path}</code>
        <span className="ml-auto text-caption text-muted">{ACCESS_LABEL[route.access]}</span>
      </div>
      <p className="m-0 font-semibold">{route.summary}</p>
      {route.description ? <p className="m-0 text-muted">{route.description}</p> : null}
      {body ? (
        <div>
          <p className="m-0 mb-1 text-label">{t("body")}</p>
          <Fields schema={body} />
        </div>
      ) : null}
      <div>
        <p className="m-0 mb-1 text-label">
          {t("success", { status: route.success.status })} — {route.success.description}
        </p>
        {response ? <Fields schema={response} /> : null}
      </div>
      {route.errors.length ? (
        <p className="m-0 text-caption text-muted">
          {t("errors")}: {route.errors.join(", ")}
        </p>
      ) : null}
    </Card>
  );
}

/** Public API reference, generated from packages/api/src/routes.ts (D92). */
export default function ApiDocsPage() {
  const t = useTranslations("apiDocs");
  const groups = ["Account", "Team", "Studio"] as const;
  return (
    <main className="mx-auto flex max-w-[880px] flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-h1">{t("title")}</h1>
        <p className="m-0 text-muted">{t("intro")}</p>
        <a href="/api/v1/openapi.json" className="font-semibold text-primary">
          {t("openapi")}
        </a>
      </header>
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-3">
          <h2 className="m-0 text-h2">{group}</h2>
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
