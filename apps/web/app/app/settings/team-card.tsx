"use client";

import type { PendingInvite, TeamMember } from "@daybell/api";
import { STAFF_ROLES } from "@daybell/api";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardTitle,
  Field,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useLocalDateTime } from "@/app/_components/local-time";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { useStudio } from "../me-context";

/** Team members, open invites and the invite form (owners). Moved here from Home in step 8. */
export function TeamCard() {
  const { me, changed: onChange } = useStudio();
  const myEmail = me.email;
  const role = me.studio.role;
  const t = useTranslations("app");
  const local = useLocalDateTime();
  const text = useApiText();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteRole, setInviteRole] = useState<(typeof STAFF_ROLES)[number]>("photographer");
  const canManage = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const load = useCallback(async () => {
    const [teamRes, invitesRes] = await Promise.all([
      api<{ team: TeamMember[] }>("/studio/team"),
      canManage ? api<{ invites: PendingInvite[] }>("/studio/invites") : Promise.resolve(null),
    ]);
    if (teamRes.ok) setTeam(teamRes.data.team);
    if (invitesRes?.ok) setInvites(invitesRes.data.invites);
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    setError(null);
    setCopied(false);
    const res = await api<{ link: string }>("/studio/invites", {
      body: { email, role: inviteRole },
    });
    if (res.ok) {
      setCreated({ email: email.trim().toLowerCase(), link: res.data.link });
      setFields({});
      form.reset();
      void load();
      onChange();
    } else {
      setFields(res.fields);
      if (Object.keys(res.fields).length === 0) setError(text.error(res.code));
    }
  }

  async function withdraw(id: string) {
    const res = await api(`/studio/invites/${id}`, { method: "DELETE" });
    if (res.ok) {
      void load();
      onChange();
    } else setError(text.error(res.code));
  }

  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>{t("team.title")}</CardTitle>
      <Table>
        <thead>
          <TableRow>
            <TableHead>{t("team.email")}</TableHead>
            <TableHead>{t("team.role")}</TableHead>
          </TableRow>
        </thead>
        <tbody>
          {team.map((m) => (
            <TableRow key={m.userId}>
              <TableCell>
                {m.email}
                {m.email === myEmail ? (
                  <span className="ml-2 text-muted">({t("team.you")})</span>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge tone={m.role === "owner" ? "money" : "selling"}>
                  {t(`roles.${m.role}`)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
          {invites.map((i) => (
            <TableRow key={i.id}>
              <TableCell>
                {i.email}
                <span className="block text-caption text-muted">
                  {t("team.expires", {
                    date: local(i.expiresAt, { dateStyle: "medium" }),
                  })}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="draft">
                    {t("team.pending")} · {t(`roles.${i.role}`)}
                  </Badge>
                  {isOwner ? (
                    <Button variant="ghost" size="sm" onClick={() => withdraw(i.id)}>
                      {t("team.withdraw")}
                    </Button>
                  ) : null}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>

      {error ? <Banner tone="danger" title={error} /> : null}

      {isOwner ? (
        <form
          onSubmit={invite}
          noValidate
          className="flex flex-col gap-3 border-t border-line pt-4"
        >
          <h3 className="m-0 text-h3">{t("team.inviteTitle")}</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <Field
              label={t("team.inviteEmail")}
              name="email"
              type="email"
              error={text.field(fields.email)}
              required
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-role" className="text-label">
                {t("team.inviteRole")}
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as (typeof STAFF_ROLES)[number])}
                className="min-h-11 rounded-md border border-line-strong bg-surface px-3"
              >
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" className="self-start">
            {t("team.inviteSubmit")}
          </Button>
          {created ? (
            <Banner tone="success" title={t("team.inviteCreated", { email: created.email })}>
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <code className="max-w-full overflow-x-auto rounded-sm bg-surface px-2 py-1 text-xs text-ink">
                  {created.link}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(created.link);
                    setCopied(true);
                  }}
                >
                  {copied ? t("team.copied") : t("team.copy")}
                </Button>
              </span>
            </Banner>
          ) : null}
        </form>
      ) : (
        <p className="m-0 text-caption text-muted">{t("team.onlyOwners")}</p>
      )}
    </Card>
  );
}
