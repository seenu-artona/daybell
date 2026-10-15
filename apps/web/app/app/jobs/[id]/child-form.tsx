"use client";

import type { Child, Class, ClassesResponse, ClassResponse, Job } from "@daybell/api";
import { Banner, Button, Field } from "@daybell/ui";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Combobox } from "../../combobox";
import { CheckboxField, Dialog } from "../../dialog";
import { RemoveChildDialog } from "./remove-child-dialog";

type GroupRef = { id: string; name: string };

/**
 * Add or rename a class, team or group (one field). Used on top of the child form ("+ Add new class") and from the
 * classes panel under Subjects' list ("Rename", D147).
 */
export function GroupForm({
  jobId,
  group,
  word,
  initialName = "",
  onCancel,
  onSaved,
}: {
  jobId: string;
  group: GroupRef | null;
  word: string;
  initialName?: string;
  onCancel: () => void;
  onSaved: (group: Class) => void;
}) {
  const t = useTranslations("app.roster.groupForm");
  const text = useApiText();
  const [name, setName] = useState(group?.name ?? initialName);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    // A form on top of the child form's dialog: never submit anything underneath.
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setErrors({});
    setProblem(null);
    // Classes are /classes in the API (C6; ADR 0030); the UI word follows the job type.
    const res = await api<ClassResponse>(
      group ? `/classes/${group.id}` : `/jobs/${jobId}/classes`,
      {
        method: group ? "PATCH" : "POST",
        body: { name },
      },
    );
    setBusy(false);
    if (res.ok) return onSaved(res.data.class);
    setErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <Field
        label={t("name")}
        placeholder={t("namePlaceholder", { group: word })}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={text.field(errors.name)}
        maxLength={60}
        autoComplete="off"
        required
      />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? t("saving") : group ? t("save") : t("create", { group: word })}
        </Button>
      </div>
    </form>
  );
}

const MORE_FIELDS = ["studentId", "grade", "parentEmail", "doNotPhotograph", "doNotPublish"];

/**
 * Add or edit a child by hand (D133 form rules): first | last name; class (optional, a combobox whose last option adds
 * a new one); and under "More options" student ID | grade, parent email, and the opt-outs. Editing shows the access
 * code, and while the job is a draft, "Remove child".
 */
export function ChildForm({
  job,
  word,
  child,
  onCancel,
  onSaved,
  onRemoved,
}: {
  job: Pick<Job, "id" | "status">;
  word: string;
  child: Child | null;
  onCancel: () => void;
  onSaved: (child: Child) => void;
  onRemoved: () => void;
}) {
  const t = useTranslations("app.roster.form");
  const tr = useTranslations("app.roster");
  const ta = useTranslations("app");
  const text = useApiText();
  const optional = (label: string) => ta("optionalLabel", { label });
  const [firstName, setFirstName] = useState(child?.firstName ?? "");
  const [lastName, setLastName] = useState(child?.lastName ?? "");
  const [group, setGroup] = useState<GroupRef | null>(child?.class ?? null);
  const [studentId, setStudentId] = useState(child?.studentId ?? "");
  const [grade, setGrade] = useState(child?.grade ?? "");
  const [parentEmail, setParentEmail] = useState(child?.parentEmail ?? "");
  const [doNotPhotograph, setDoNotPhotograph] = useState(child?.doNotPhotograph ?? false);
  const [doNotPublish, setDoNotPublish] = useState(child?.doNotPublish ?? false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [groups, setGroups] = useState<Class[] | null>(null);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The job's groups are loaded once and filtered here as people type.
  useEffect(() => {
    api<ClassesResponse>(`/jobs/${job.id}/classes`).then((res) => {
      if (res.ok) setGroups(res.data.classes);
    });
  }, [job.id]);

  const search = useCallback(
    async (query: string) => {
      if (!groups) return null;
      const q = query.toLowerCase();
      return groups.filter((g) => g.name.toLowerCase().includes(q));
    },
    [groups],
  );

  function showErrors(fields: Record<string, string>) {
    setErrors(fields);
    // Errors inside "More options" must be seen.
    if (MORE_FIELDS.some((f) => fields[f])) setMoreOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    const orNull = (v: string) => v.trim() || null;
    const res = await api<{ child: Child }>(
      child ? `/children/${child.id}` : `/jobs/${job.id}/children`,
      {
        method: child ? "PATCH" : "POST",
        body: {
          firstName,
          lastName,
          classId: group?.id ?? null,
          studentId: orNull(studentId),
          grade: orNull(grade),
          parentEmail: orNull(parentEmail),
          doNotPhotograph,
          doNotPublish,
        },
      },
    );
    setBusy(false);
    if (res.ok) return onSaved(res.data.child);
    showErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  const draft = job.status === "draft";

  return (
    <>
      <form onSubmit={save} noValidate className="flex flex-col gap-5">
        {problem ? <Banner tone="danger" title={problem} /> : null}
        {child ? (
          <dl className="m-0 flex items-baseline gap-3">
            <dt className="text-label text-muted">{t("accessCode")}</dt>
            {child.accessCode ? (
              <dd className="m-0 font-mono text-base font-semibold tracking-wider">
                {child.accessCode}
              </dd>
            ) : (
              <dd className="m-0 text-muted">{tr("codeUnavailable")}</dd>
            )}
          </dl>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t("firstName")}
            placeholder={t("firstNamePlaceholder")}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            error={text.field(errors.firstName)}
            maxLength={60}
            autoComplete="off"
            required
          />
          <Field
            label={t("lastName")}
            placeholder={t("lastNamePlaceholder")}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            error={text.field(errors.lastName)}
            maxLength={60}
            autoComplete="off"
            required
          />
        </div>
        <Combobox
          label={optional(t("group", { group: word }))}
          placeholder={t("groupPlaceholder", { group: word })}
          listLabel={t("groupOptions", { group: word })}
          value={group}
          onChange={(g) => setGroup(g ? { id: g.id, name: g.name } : null)}
          search={search}
          addNewLabel={t("addGroup", { group: word })}
          onAddNew={(typed) => setNewGroupName(typed)}
          error={text.field(errors.classId)}
        />
        <details
          open={moreOpen}
          onToggle={(e) => setMoreOpen(e.currentTarget.open)}
          className="group"
        >
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
            {t("moreOptions")}
          </summary>
          <div className="flex flex-col gap-5 pt-3">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={optional(t("studentId"))}
                placeholder={t("studentIdPlaceholder")}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                error={text.field(errors.studentId)}
                maxLength={40}
                autoComplete="off"
              />
              <Field
                label={optional(t("grade"))}
                placeholder={t("gradePlaceholder")}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                error={text.field(errors.grade)}
                maxLength={20}
                autoComplete="off"
              />
            </div>
            <Field
              label={optional(t("parentEmail"))}
              placeholder={t("parentEmailPlaceholder")}
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              error={text.field(errors.parentEmail)}
              autoComplete="off"
            />
            <div className="flex flex-col gap-1">
              <CheckboxField
                label={t("doNotPhotograph")}
                checked={doNotPhotograph}
                onChange={setDoNotPhotograph}
                error={text.field(errors.doNotPhotograph)}
              />
              <CheckboxField
                label={t("doNotPublish")}
                checked={doNotPublish}
                onChange={setDoNotPublish}
                error={text.field(errors.doNotPublish)}
              />
            </div>
          </div>
        </details>
        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-end">
          {child && draft ? (
            <Button
              variant="danger"
              className="sm:mr-auto"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
            >
              {t("remove")}
            </Button>
          ) : null}
          {child && !draft ? (
            <p className="m-0 text-caption text-muted sm:mr-auto">{tr("lockedNote")}</p>
          ) : null}
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("saving") : child ? t("save") : t("create")}
          </Button>
        </div>
      </form>

      {/* Opens on top of the child form; Escape closes only this one, and the new group is selected. */}
      <Dialog
        open={newGroupName !== null}
        onClose={() => setNewGroupName(null)}
        title={tr("groupForm.addTitle", { group: word })}
      >
        <GroupForm
          jobId={job.id}
          group={null}
          word={word}
          initialName={newGroupName ?? ""}
          onCancel={() => setNewGroupName(null)}
          onSaved={(g) => {
            setGroups((list) => [...(list ?? []), g]);
            setGroup({ id: g.id, name: g.name });
            setNewGroupName(null);
          }}
        />
      </Dialog>

      {child ? (
        <RemoveChildDialog
          child={child}
          open={confirmRemove}
          onClose={() => setConfirmRemove(false)}
          onRemoved={() => {
            setConfirmRemove(false);
            onRemoved();
          }}
        />
      ) : null}
    </>
  );
}
