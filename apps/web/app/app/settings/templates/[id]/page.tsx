"use client";

import type {
  JobTemplate,
  JobTemplatePatch,
  JobTemplateResponse,
  PriceListsResponse,
} from "@daybell/api";
import { RULE_KEYS, type RuleKey, type RulesPatch } from "@daybell/core";
import { Badge, Banner, Button, IconButton, iconButtonVariants } from "@daybell/ui";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  Images,
  ListChecks,
  Mail,
  Pencil,
  Star,
  Store,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../../../dialog";
import { useStudio } from "../../../me-context";
import { MENU_ROW, Popover } from "../../../popover";
import { RuleForm } from "../../../templates/rule-form";
import { ruleLine } from "../../../templates/rules";
import { SETTINGS_HREF } from "../../sections";
import { NameForm } from "../name-form";

const TEMPLATE_SECTIONS = ["steps", "shop", "messages", "subjects"] as const;
type Section = (typeof TEMPLATE_SECTIONS)[number];
const SECTION_ICONS: Record<Section, typeof Store> = {
  steps: ListChecks,
  shop: Store,
  messages: Mail,
  subjects: Images,
};

/** Steps, grouped by stage as in a job's Progress (D154); Makeup day and Archive are not built (Soon). */
const STEP_GROUPS: {
  stage: "prepare" | "pictureDay" | "selling" | "wrapUp";
  steps: (RuleKey | "makeupDay" | "archive")[];
}[] = [
  { stage: "prepare", steps: ["qrCards"] },
  { stage: "pictureDay", steps: ["makeupDay"] },
  { stage: "selling", steps: ["shopOpens", "shopCloses"] },
  { stage: "wrapUp", steps: ["archive"] },
];

export default function TemplatePageRoute() {
  return (
    <Suspense>
      <TemplatePage />
    </Suspense>
  );
}

/**
 * A job template's page (D154; ADR 0029), in the D151 blueprint: back, the name (renamed in place), Default, "Used by
 * N jobs" and ⋯ (Make default, Duplicate, Delete) for owners and admins; sections on the left (Steps, Shop, Messages,
 * Subjects and photos), in the address as ?section= (an enum word only, D113); the section's white cards on the right.
 * Each step is a card that opens its small dialog. Everyone else reads it.
 */
function TemplatePage() {
  const t = useTranslations("app.templates");
  const text = useApiText();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { me } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const asked = useSearchParams().get("section");
  const section: Section = (TEMPLATE_SECTIONS as readonly string[]).includes(asked ?? "")
    ? (asked as Section)
    : "steps";
  const [template, setTemplate] = useState<JobTemplate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<"copy" | "delete" | RuleKey | null>(null);
  const [renaming, setRenaming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void api<JobTemplateResponse>(`/job-templates/${encodeURIComponent(id)}`).then((res) => {
      if (res.ok) setTemplate(res.data.template);
      else setProblem(res.code === "not_found" ? t("notFound") : text.error(res.code));
    });
  }, [id, t, text]);

  /** Saves a change; resolves to a problem, or null when saved. */
  const save = useCallback(
    async (patch: JobTemplatePatch | RulesPatch): Promise<string | null> => {
      const res = await api<JobTemplateResponse>(`/job-templates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
      });
      if (!res.ok) {
        const field = Object.values(res.fields)[0];
        return field ? (text.field(field) ?? text.error(res.code)) : text.error(res.code);
      }
      setTemplate(res.data.template);
      setOpen(null);
      setStatus(t("saved"));
      return null;
    },
    [id, t, text],
  );

  async function makeDefault() {
    const res = await api<JobTemplateResponse>(`/job-templates/${encodeURIComponent(id)}/default`, {
      method: "POST",
    });
    if (res.ok) {
      setTemplate(res.data.template);
      setStatus(t("madeDefault", { name: res.data.template.name }));
    } else setStatus(text.error(res.code));
    heading.current?.focus();
  }

  if (!template)
    return (
      <div className="flex flex-col gap-4 px-10 pt-8">
        <Link
          href={SETTINGS_HREF.templates}
          className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("back")}
        </Link>
        {problem ? (
          <Banner tone="danger" title={problem} />
        ) : (
          <p className="m-0 text-muted">{t("loading")}</p>
        )}
      </div>
    );

  return (
    <div className="flex w-full flex-col gap-7 px-10 pt-8 pb-12">
      <header className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center gap-3">
          <IconButton asChild label={t("back")}>
            <Link href={SETTINGS_HREF.templates}>
              <ArrowLeft aria-hidden="true" />
            </Link>
          </IconButton>
          {renaming ? (
            <InlineName
              name={template.name}
              onCancel={() => {
                setRenaming(false);
                setTimeout(() => heading.current?.focus(), 0);
              }}
              onSave={async (name) => {
                const failed = await save({ name });
                if (!failed) {
                  setRenaming(false);
                  setTimeout(() => heading.current?.focus(), 0);
                }
                return failed;
              }}
            />
          ) : (
            <>
              <h1
                ref={heading}
                tabIndex={-1}
                className="m-0 min-w-0 text-h1 break-words text-ink focus-visible:outline-2 focus-visible:outline-primary"
              >
                {template.name}
              </h1>
              {canManage ? (
                <IconButton label={t("rename")} tone="canvas" onClick={() => setRenaming(true)}>
                  <Pencil aria-hidden="true" />
                </IconButton>
              ) : null}
            </>
          )}
          {template.isDefault ? (
            <Badge tone="draft" className="before:hidden">
              {t("default")}
            </Badge>
          ) : null}
          <span className="text-body text-muted">{t("usedBy", { count: template.usedBy })}</span>
          <span className="flex-1" />
          {canManage ? (
            <Popover
              label={t("moreActions")}
              trigger={<Ellipsis aria-hidden="true" />}
              triggerClassName={iconButtonVariants()}
              panelClassName="w-60"
            >
              {(close) => (
                <>
                  {template.isDefault ? null : (
                    <button
                      type="button"
                      className={MENU_ROW}
                      onClick={() => {
                        close();
                        void makeDefault();
                      }}
                    >
                      <Star aria-hidden="true" />
                      {t("makeDefault")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={MENU_ROW}
                    onClick={() => {
                      close();
                      setOpen("copy");
                    }}
                  >
                    <Copy aria-hidden="true" />
                    {t("duplicate")}
                  </button>
                  {template.isDefault ? null : (
                    <button
                      type="button"
                      className={`${MENU_ROW} text-danger [&_svg]:text-danger`}
                      onClick={() => {
                        close();
                        setOpen("delete");
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("delete")}
                    </button>
                  )}
                </>
              )}
            </Popover>
          ) : null}
        </div>
        {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
        <p role="status" className="m-0 min-h-5 pl-14 text-caption text-muted">
          {status}
        </p>
      </header>

      <div className="flex items-start gap-14">
        <nav aria-label={t("sections.label")} className="w-85 shrink-0">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {TEMPLATE_SECTIONS.map((s) => {
              const Icon = SECTION_ICONS[s];
              return (
                <li key={s}>
                  <Link
                    href={`${SETTINGS_HREF.templates}/${template.id}?section=${s}`}
                    replace
                    scroll={false}
                    aria-current={section === s ? "page" : undefined}
                    className="group flex min-h-16 items-center gap-4 rounded-lg px-3 text-ink no-underline hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary aria-[current=page]:bg-surface"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary [&_svg]:size-5"
                    >
                      <Icon />
                    </span>
                    <span className="flex-1 text-h3 font-semibold">{t(`sections.${s}`)}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-5 text-line-strong group-hover:text-muted"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          {canManage ? null : <p className="m-0 text-sm text-muted">{t("readOnly")}</p>}
          {section === "steps" ? (
            <StepsSection template={template} canManage={canManage} onOpen={setOpen} />
          ) : section === "shop" ? (
            <ShopSection template={template} canManage={canManage} onSave={save} />
          ) : section === "messages" ? (
            <Group title={t("sections.messages")}>
              <p className="m-0 rounded-lg bg-surface px-6 py-5 text-muted shadow-sm">
                {t("messages.soon")}
              </p>
            </Group>
          ) : (
            <Group title={t("sections.subjects")}>
              <InfoCard label={t("subjects.accessCodes")} value={t("subjects.accessCodesValue")} />
              <InfoCard label={t("subjects.watermark")} value={t("subjects.watermarkValue")} />
            </Group>
          )}
        </div>
      </div>

      <Dialog open={open === "copy"} onClose={() => setOpen(null)} title={t("duplicate")}>
        <NameForm
          initial={t("copyName", { name: template.name })}
          submitLabel={t("duplicate")}
          onCancel={() => setOpen(null)}
          onSubmit={async (name) => {
            const res = await api<JobTemplateResponse>(
              `/job-templates/${encodeURIComponent(template.id)}/copy`,
              { method: "POST", body: { name } },
            );
            if (res.ok) {
              setOpen(null);
              router.push(`${SETTINGS_HREF.templates}/${res.data.template.id}`);
              return null;
            }
            return res.fields.name
              ? { field: text.field(res.fields.name) ?? "" }
              : { form: res.fields.form === "templates.limit" ? t("limit") : text.error(res.code) };
          }}
        />
      </Dialog>

      <Dialog open={open === "delete"} onClose={() => setOpen(null)} title={t("deleteTitle")}>
        <DeleteForm template={template} onCancel={() => setOpen(null)} />
      </Dialog>

      {RULE_KEYS.map((rule) => (
        <Dialog
          key={rule}
          open={open === rule}
          onClose={() => setOpen(null)}
          title={t(`steps.${rule}`)}
        >
          <RuleForm
            rule={rule}
            rules={template.rules}
            note={t("ruleNote")}
            onCancel={() => setOpen(null)}
            onSave={save}
          />
        </Dialog>
      ))}
    </div>
  );
}

/** The name, edited in place (D154): the h1 becomes its field, with Save and Cancel; Escape cancels. */
function InlineName({
  name,
  onCancel,
  onSave,
}: {
  name: string;
  onCancel: () => void;
  onSave: (name: string) => Promise<string | null>;
}) {
  const t = useTranslations("app.templates");
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = useRef(false);
  const id = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    if (!value.trim()) return setError(t("nameRequired"));
    busy.current = true;
    const failed = await onSave(value.trim());
    busy.current = false;
    setError(failed ?? undefined);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="flex min-w-0 flex-1 flex-wrap items-start gap-2"
    >
      <div className="flex min-w-60 flex-1 flex-col gap-1">
        <label htmlFor={id} className="sr-only">
          {t("renameLabel")}
        </label>
        <input
          id={id}
          autoFocus
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-h2 text-ink focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none"
        />
        {error ? (
          <span id={`${id}-error`} className="text-caption text-danger">
            {error}
          </span>
        ) : null}
      </div>
      <Button type="submit">{t("save")}</Button>
      <Button variant="secondary" onClick={onCancel}>
        {t("cancel")}
      </Button>
    </form>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="m-0 mt-2 text-title-sm text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface px-6 py-5 shadow-sm">
      <span className="text-h3 font-bold text-ink">{label}</span>
      <span className="text-body text-muted">{value}</span>
    </div>
  );
}

const CARD =
  "flex w-full items-center gap-4 rounded-lg bg-surface px-6 py-5 text-left text-ink shadow-sm";

/** Steps: the rules counted from picture day, grouped by stage; each card opens its dialog (owners and admins). */
function StepsSection({
  template,
  canManage,
  onOpen,
}: {
  template: JobTemplate;
  canManage: boolean;
  onOpen: (rule: RuleKey) => void;
}) {
  const t = useTranslations("app.templates");
  const tr = useTranslations("app.rules");
  return (
    <>
      {STEP_GROUPS.map((group) => (
        <Group key={group.stage} title={t(`stages.${group.stage}`)}>
          {group.steps.map((step) => {
            if (step === "makeupDay" || step === "archive")
              return (
                <div key={step} className={CARD}>
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="text-h3 font-bold text-muted">{t(`steps.${step}`)}</span>
                    <span className="text-body text-muted">{t(`${step}Soon`)}</span>
                  </span>
                  <Badge tone="draft" className="before:hidden">
                    {t("soon")}
                  </Badge>
                </div>
              );
            const line = ruleLine(step, template.rules);
            const body = (
              <span key="body" className="flex flex-1 flex-col gap-1">
                <span className="text-h3 font-bold">{t(`steps.${step}`)}</span>
                <span className="text-body text-muted">
                  {tr(line.message as Parameters<typeof tr>[0], line.values)}
                </span>
              </span>
            );
            return canManage ? (
              <button
                key={step}
                type="button"
                aria-haspopup="dialog"
                onClick={() => onOpen(step)}
                className={`${CARD} group hover:shadow-card focus-visible:outline-2 focus-visible:outline-primary`}
              >
                {body}
                <ChevronRight
                  aria-hidden="true"
                  className="size-5 text-line-strong group-hover:text-muted"
                />
              </button>
            ) : (
              <div key={step} className={CARD}>
                {body}
              </div>
            );
          })}
        </Group>
      ))}
    </>
  );
}

/** Shop: the price list new jobs get (the studio's lists) and school delivery (the existing option). */
function ShopSection({
  template,
  canManage,
  onSave,
}: {
  template: JobTemplate;
  canManage: boolean;
  onSave: (patch: JobTemplatePatch) => Promise<string | null>;
}) {
  const t = useTranslations("app.templates.shop");
  const [lists, setLists] = useState<PriceListsResponse["priceLists"] | null>(null);
  const [priceListId, setPriceListId] = useState(template.priceListId ?? "");
  const [toSchool, setToSchool] = useState(template.deliverToSchool);
  const [problem, setProblem] = useState("");
  const busy = useRef(false);
  const checkboxId = useId();

  useEffect(() => {
    void api<PriceListsResponse>("/price-lists").then((res) => {
      if (res.ok) setLists(res.data.priceLists);
    });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setProblem(
      (await onSave({ priceListId: priceListId || null, deliverToSchool: toSchool })) ?? "",
    );
    busy.current = false;
  }

  const chosen = lists?.find((l) => l.id === template.priceListId)?.name ?? t("studioDefault");
  if (!canManage)
    return (
      <>
        <InfoCard label={t("priceList")} value={chosen} />
        <InfoCard
          label={t("delivery")}
          value={template.deliverToSchool ? t("toSchoolOn") : t("toSchoolOff")}
        />
      </>
    );
  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-5 rounded-lg bg-surface px-6 py-5 shadow-sm"
    >
      <SelectField
        label={t("priceList")}
        value={priceListId}
        onChange={setPriceListId}
        options={[
          { value: "", label: t("studioDefault") },
          ...(lists ?? []).map((l) => ({ value: l.id, label: l.name })),
        ]}
      />
      <div className="flex flex-col gap-1">
        <span className="text-label text-ink">{t("delivery")}</span>
        <label
          htmlFor={checkboxId}
          className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={toSchool}
            onChange={(e) => setToSchool(e.target.checked)}
            className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          {t("toSchool")}
        </label>
        <span className="text-caption text-muted">{t("toSchoolHelp")}</span>
      </div>
      <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
        {problem}
      </p>
      <div>
        <Button type="submit">{t("save")}</Button>
      </div>
    </form>
  );
}

function DeleteForm({ template, onCancel }: { template: JobTemplate; onCancel: () => void }) {
  const t = useTranslations("app.templates");
  const text = useApiText();
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const busy = useRef(false);

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    const res = await api(`/job-templates/${encodeURIComponent(template.id)}`, {
      method: "DELETE",
    });
    busy.current = false;
    if (res.ok) return router.push(SETTINGS_HREF.templates);
    setProblem(res.fields.form === "templates.isDefault" ? t("isDefault") : text.error(res.code));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0">{t("deleteBody", { name: template.name })}</p>
      <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
        {problem}
      </p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button variant="danger" onClick={() => void remove()}>
          {t("deleteConfirm")}
        </Button>
      </div>
    </div>
  );
}
