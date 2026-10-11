"use client";

import type { MeResponse, PendingInvite, StudioRole, TeamMember } from "@daybell/api";
import { STAFF_ROLES } from "@daybell/api";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardTitle,
  Field,
  MoneyStat,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { ActivityCard } from "./activity-card";

export function StudioHome() {
  const t = useTranslations("app");
  const text = useApiText();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [activityKey, setActivityKey] = useState(0);

  useEffect(() => {
    api<MeResponse>("/me").then((res) => {
      if (res.ok) setMe(res.data);
      else if (res.status === 401) router.replace("/sign-in?next=/app");
      else setFailed(true);
    });
  }, [router]);

  async function signOut() {
    await api("/auth/sign-out", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  if (failed)
    return (
      <Shell onSignOut={signOut}>
        <Banner tone="danger" title={text.error("internal")} />
      </Shell>
    );
  if (!me)
    return (
      <Shell onSignOut={signOut}>
        <p className="text-muted">{t("loading")}</p>
      </Shell>
    );
  if (!me.studio) {
    return (
      <Shell onSignOut={signOut}>
        <Banner tone="info" title={t("noStudio")} />
      </Shell>
    );
  }

  return (
    <Shell onSignOut={signOut} studioName={me.studio.name}>
      <div>
        <h1 className="m-0 text-h1">{t("welcome", { studio: me.studio.name })}</h1>
        <p className="mt-1 text-muted">{t("welcomeBody")}</p>
      </div>
      <MoneyStat
        label={t("sales")}
        cents={0}
        currency={me.studio.region === "ca" ? "CAD" : "USD"}
        locale={me.studio.region === "ca" ? "en-CA" : "en-US"}
        delta={t("salesDelta")}
        animate={false}
        className="max-w-90"
      />
      <Team
        myEmail={me.email}
        role={me.studio.role}
        onChange={() => setActivityKey((k) => k + 1)}
      />
      {me.studio.role === "owner" || me.studio.role === "admin" ? (
        <ActivityCard refreshKey={activityKey} />
      ) : null}
    </Shell>
  );
}

function Shell({
  children,
  onSignOut,
  studioName,
}: {
  children: React.ReactNode;
  onSignOut: () => void;
  studioName?: string;
}) {
  const t = useTranslations("app");
  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <span
          className="grid size-8 place-items-center rounded-[9px] bg-lime font-extrabold"
          aria-hidden="true"
        >
          D
        </span>
        <span className="font-bold">{studioName ?? "Daybell"}</span>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onSignOut}>
          {t("signOut")}
        </Button>
      </header>
      <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">{children}</main>
    </div>
  );
}

function Team({
  myEmail,
  role,
  onChange,
}: {
  myEmail: string;
  role: StudioRole;
  onChange: () => void;
}) {
  const t = useTranslations("app");
  const format = useFormatter();
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
                    date: format.dateTime(new Date(i.expiresAt), { dateStyle: "medium" }),
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
