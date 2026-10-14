"use client";

import type { RosterChild } from "@daybell/api";
import type { GroupLabel } from "@daybell/core";
import {
  Badge,
  ClickableRow,
  IconChip,
  ListCard,
  RowChevron,
  RowChevronHead,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { avatarTone, childInitials } from "./avatar";

/** The DOM id of a child's name link, so focus can return to it when the panel closes. */
export const rowLinkId = (childId: string) => `child-link-${childId}`;

/**
 * Subjects' list (D140, D144, D147): one flat table in a white list card whose toolbar holds the chips and the search,
 * 60px hairline rows, each with an initials avatar (decorative), a Class column, the child's photo count and, for
 * people who see orders, whether they have ordered ("Ordered" or "Not yet", words), and a faint chevron; the card's
 * footer counts the roster. Each row opens the child in the floating panel: the name is a real link (the keyboard
 * target, ?child=<id>), and a click anywhere else on the row does the same.
 */
export function PeopleList({
  rows,
  toolbar,
  toolbarEnd,
  empty,
  showOrdered,
  selectedId,
  childHref,
  onOpen,
  onLinkOpen,
  word,
  busy,
  footer,
}: {
  rows: readonly RosterChild[];
  /** The chips, at the left of the card's toolbar. */
  toolbar: ReactNode;
  /** The search, at its right end. */
  toolbarEnd: ReactNode;
  /** Shown instead of the table when nothing matches. */
  empty: string | null;
  /** The Ordered column: only for people who see orders (never photographers). */
  showOrdered: boolean;
  selectedId: string | null;
  childHref: (childId: string) => string;
  /** A row was clicked: open the child (the page updates the URL). */
  onOpen: (childId: string) => void;
  /** The name link was used: it updates the URL itself; the page only notes who opened the panel. */
  onLinkOpen: (childId: string) => void;
  word: GroupLabel;
  busy: boolean;
  /** The card's footer: the roster's counts. */
  footer: string;
}) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const noGroup = tr("noGroup", { group: word });

  return (
    <ListCard toolbar={toolbar} toolbarEnd={toolbarEnd} footer={footer}>
      {empty ? (
        <p className="m-0 px-6 py-10 text-center text-muted">{empty}</p>
      ) : (
        <Table variant="list" aria-busy={busy}>
          <thead>
            <TableRow>
              <TableHead className="h-13 py-0">{tr("columns.name")}</TableHead>
              <TableHead className="h-13 py-0">{tr("columns.group", { group: word })}</TableHead>
              <TableHead className="h-13 py-0">{tr("columns.studentId")}</TableHead>
              <TableHead className="h-13 py-0">{tr("columns.grade")}</TableHead>
              <TableHead className="h-13 py-0 text-right">{tr("columns.accessCode")}</TableHead>
              <TableHead numeric className="h-13 py-0">
                {t("columns.photos")}
              </TableHead>
              {showOrdered ? (
                <TableHead className="h-13 py-0">{t("columns.ordered")}</TableHead>
              ) : null}
              <RowChevronHead />
            </TableRow>
          </thead>
          <tbody>
            {rows.map((child) => {
              const selected = child.id === selectedId;
              return (
                <ClickableRow
                  key={child.id}
                  onActivate={() => onOpen(child.id)}
                  className={`h-15 ${selected ? "bg-primary-soft [tbody_&]:hover:bg-primary-soft" : ""}`}
                >
                  <TableCell className="py-0">
                    <span className="flex items-center gap-3">
                      <IconChip shape="round" tone={avatarTone(child.id)}>
                        {childInitials(child.firstName, child.lastName)}
                      </IconChip>
                      <Link
                        id={rowLinkId(child.id)}
                        href={childHref(child.id)}
                        replace
                        scroll={false}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => onLinkOpen(child.id)}
                        className="inline-flex min-h-11 min-w-11 items-center font-bold text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {child.firstName} {child.lastName}
                      </Link>
                      {child.doNotPhotograph ? (
                        <Badge tone="danger" className="h-6 rounded-sm px-2 before:hidden">
                          {tr("badges.doNotPhotograph")}
                        </Badge>
                      ) : null}
                      {child.duplicate ? (
                        <Badge tone="warning" className="h-6 rounded-sm px-2 before:hidden">
                          {t("duplicateBadge")}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="py-0">
                    <span className="inline-flex h-7 items-center rounded-sm bg-canvas px-2.5 text-label text-muted">
                      {child.group?.name ?? noGroup}
                    </span>
                  </TableCell>
                  <TableCell className="py-0 text-muted">{child.studentId ?? ""}</TableCell>
                  <TableCell className="py-0">{child.grade ?? ""}</TableCell>
                  {child.accessCode ? (
                    <TableCell className="py-0 text-right font-mono font-bold tracking-wider whitespace-nowrap">
                      {child.accessCode}
                    </TableCell>
                  ) : (
                    <TableCell className="py-0 text-right text-muted">
                      {tr("codeUnavailable")}
                    </TableCell>
                  )}
                  <TableCell numeric className="py-0">
                    {child.photoCount}
                  </TableCell>
                  {showOrdered ? (
                    <TableCell className="py-0 whitespace-nowrap">
                      {child.hasPaidOrder ? (
                        <Badge tone="selling" className="h-6 rounded-sm px-2 before:hidden">
                          {t("ordered.yes")}
                        </Badge>
                      ) : child.hasPaidOrder === false ? (
                        <span className="text-muted">{t("ordered.no")}</span>
                      ) : null}
                    </TableCell>
                  ) : null}
                  <RowChevron className="py-0" />
                </ClickableRow>
              );
            })}
          </tbody>
        </Table>
      )}
    </ListCard>
  );
}
