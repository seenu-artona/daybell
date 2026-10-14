"use client";

import type { ClientsResponse, Contact, ContactResponse } from "@daybell/api";
import { Banner, Button, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Combobox } from "../combobox";
import { CheckboxField } from "../dialog";
import { useStudio } from "../me-context";

interface ContactDraft {
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
  isMain: boolean;
}
type TextKey = Exclude<keyof ContactDraft, "isMain">;

function draftFor(contact: Contact | null): ContactDraft {
  return {
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    role: contact?.role ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    isMain: contact?.isMain ?? false,
  };
}

/** The request body: blank fields are sent as null. */
function body(draft: ContactDraft) {
  const orNull = (v: string) => v.trim() || null;
  return {
    firstName: orNull(draft.firstName),
    lastName: orNull(draft.lastName),
    role: orNull(draft.role),
    email: orNull(draft.email),
    phone: orNull(draft.phone),
    isMain: draft.isMain,
  };
}

const PAIR = "grid gap-5 sm:grid-cols-2";

/**
 * Add or edit a client's contact (People › Contacts, D150; ADR 0028), laid out by the D133 form rules: the client (a
 * new contact only: a contact never moves to another client), first | last name, role, email | phone, and "Main
 * contact for this client", whose name, phone and email become the client's contact person. Read-only for people who
 * aren't owners or admins.
 */
export function ContactForm({
  contact,
  readOnly = false,
  onCancel,
  onSaved,
}: {
  contact: Contact | null;
  readOnly?: boolean;
  onCancel: () => void;
  onSaved: (contact: Contact) => void;
}) {
  const t = useTranslations("app.contactsList.form");
  const ta = useTranslations("app");
  const text = useApiText();
  const { changed } = useStudio();
  const [draft, setDraft] = useState(() => draftFor(contact));
  const [client, setClient] = useState<{ id: string; name: string } | null>(
    contact ? { id: contact.clientId, name: contact.clientName } : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const optional = (label: string) => ta("optionalLabel", { label });

  const input = (key: TextKey) => ({
    name: key,
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
    error: text.field(errors[key]),
    readOnly,
  });

  const searchClients = useCallback(async (query: string) => {
    const res = await api<ClientsResponse>(
      `/clients?limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    );
    return res.ok
      ? res.data.clients.map((c) => ({ id: c.id, name: c.name, detail: c.city }))
      : null;
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    if (!contact && !client) {
      setErrors({ clientId: "validation.client" });
      return;
    }
    setBusy(true);
    setErrors({});
    setProblem(null);
    const res = await api<ContactResponse>(contact ? `/contacts/${contact.id}` : "/contacts", {
      method: contact ? "PATCH" : "POST",
      body: contact ? body(draft) : { clientId: client?.id, ...body(draft) },
    });
    setBusy(false);
    if (res.ok) {
      changed();
      return onSaved(res.data.contact);
    }
    setErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {contact ? (
        <Field label={t("client")} name="client" value={contact.clientName} readOnly />
      ) : (
        <Combobox
          label={t("client")}
          placeholder={t("clientPlaceholder")}
          listLabel={t("clientOptions")}
          value={client}
          onChange={(c) => setClient(c ? { id: c.id, name: c.name } : null)}
          search={searchClients}
          error={text.field(errors.clientId)}
        />
      )}
      <div className={PAIR}>
        <Field label={optional(t("firstName"))} autoComplete="off" {...input("firstName")} />
        <Field label={optional(t("lastName"))} autoComplete="off" {...input("lastName")} />
      </div>
      <Field
        label={optional(t("role"))}
        placeholder={t("rolePlaceholder")}
        maxLength={60}
        autoComplete="off"
        {...input("role")}
      />
      <div className={PAIR}>
        <Field label={optional(t("email"))} type="email" autoComplete="off" {...input("email")} />
        <Field
          label={optional(t("phone"))}
          type="tel"
          maxLength={30}
          autoComplete="off"
          {...input("phone")}
        />
      </div>
      <CheckboxField
        label={t("main")}
        checked={draft.isMain}
        onChange={(isMain) => setDraft({ ...draft, isMain })}
        help={t("mainHelp")}
        error={text.field(errors.isMain)}
        disabled={readOnly}
      />
      {readOnly ? <p className="m-0 text-caption text-muted">{t("readOnlyNote")}</p> : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {readOnly ? t("close") : t("cancel")}
        </Button>
        {readOnly ? null : (
          <Button type="submit" disabled={busy}>
            {busy ? t("saving") : contact ? t("save") : t("add")}
          </Button>
        )}
      </div>
    </form>
  );
}
