"use client";

import type { RosterChild } from "@daybell/api";
import type { GroupLabel } from "@daybell/core";
import {
  Badge,
  ClickableRow,
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
import type { KeyboardEvent, ReactNode } from "react";

/** The DOM id of a child's name link, so focus can return to it (or move to it with ↑↓). */
export const rowLinkId = (childId: string) => `child-link-${childId}`;

/** The person a ↑ or ↓ moves to from `childId` in the list as shown, or null at either end. */
export function neighbour(
  rows: readonly { id: string }[],
  childId: string,
  key: "ArrowUp" | "ArrowDown",
): string | null {
  const at = rows.findIndex((r) => r.id === childId);
  if (at < 0) return null;
  return rows[key === "ArrowDown" ? at + 1 : at - 1]?.id ?? null;
}

/** A person's small tags beside their name (D153): Do not photograph and a possible duplicate, in words (D91). */
function Tags({ child }: { child: RosterChild }) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  return (
    <>
      {child.doNotPhotograph ? (
        <Badge tone="danger" className="h-5 shrink-0 rounded-sm px-2 before:hidden">
          {tr("badges.doNotPhotograph")}
        </Badge>
      ) : null}
      {child.duplicate ? (
        <Badge tone="warning" className="h-5 shrink-0 rounded-sm px-2 before:hidden">
          {t("duplicateBadge")}
        </Badge>
      ) : null}
    </>
  );
}

/** Ordered or Not ordered, as a pill with its word (D148, D153); nothing for people who don't see orders. */
export function OrderedPill({ hasPaidOrder }: { hasPaidOrder: boolean | null | undefined }) {
  const t = useTranslations("app.people.ordered");
  if (hasPaidOrder === true)
    return (
      <Badge tone="primary" className="before:hidden">
        {t("yes")}
      </Badge>
    );
  if (hasPaidOrder === false)
    return (
      <Badge tone="draft" className="before:hidden">
        {t("notOrdered")}
      </Badge>
    );
  return null;
}

/**
 * Subjects' list (D153, amending D147): one flat table in a white list card whose toolbar holds the chips and the
 * search; 56px one-line rows with the Name and its small tags, the Class, the Photos count and, for people who see
 * orders, an Ordered pill; the card's footer counts the roster. A click on a row (or its name link, the keyboard
 * target) opens the person: the list folds to its Name column in the same card, with the same chips and search, and
 * the person fills the rest (`folded`). The open row is grey with a 3px ink bar on its left and aria-current; ↑ and ↓
 * on a name move to the person above or below.
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
  person,
}: {
  rows: readonly RosterChild[];
  /** The chips, at the left of the card's toolbar. */
  toolbar: ReactNode;
  /** The search, at its right end. */
  toolbarEnd: ReactNode;
  /** Shown instead of the list when nothing matches. */
  empty: string | null;
  /** The Ordered column: only for people who see orders (never photographers). */
  showOrdered: boolean;
  selectedId: string | null;
  childHref: (childId: string) => string;
  /** A row was clicked (or ↑↓ moved): open the person (the page updates the address). */
  onOpen: (childId: string) => void;
  /** The name link was used: it updates the address itself; the page only notes who opened the person. */
  onLinkOpen: (childId: string) => void;
  word: GroupLabel;
  busy: boolean;
  /** The card's footer: the roster's counts. */
  footer: string;
  /** The open person's record; the list folds to its Name column beside it. */
  person: ReactNode;
}) {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const noGroup = tr("noGroup", { group: word });
  const folded = person !== null && selectedId !== null;

  function move(e: KeyboardEvent, childId: string) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const next = neighbour(rows, childId, e.key);
    if (!next) return;
    e.preventDefault();
    onOpen(next);
    setTimeout(() => document.getElementById(rowLinkId(next))?.focus(), 0);
  }

  const nameLink = (child: RosterChild) => {
    const selected = child.id === selectedId;
    return (
      <Link
        id={rowLinkId(child.id)}
        href={childHref(child.id)}
        replace
        scroll={false}
        aria-current={selected ? "true" : undefined}
        aria-keyshortcuts="ArrowUp ArrowDown"
        onClick={() => onLinkOpen(child.id)}
        onKeyDown={(e) => move(e, child.id)}
        className="inline-flex min-h-11 min-w-0 items-center truncate font-bold text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {child.firstName} {child.lastName}
      </Link>
    );
  };

  if (folded)
    return (
      <ListCard toolbar={toolbar} toolbarEnd={toolbarEnd}>
        <div className="flex">
          <nav aria-label={t("listLabel")} aria-busy={busy} className="w-85 shrink-0">
            <div className="flex h-11 items-center border-b border-line px-5.5 text-sm font-semibold text-muted">
              {tr("columns.name")}
            </div>
            {empty ? (
              <p className="m-0 px-5.5 py-6 text-muted">{empty}</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {rows.map((child) => {
                  const selected = child.id === selectedId;
                  return (
                    <li
                      key={child.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        onOpen(child.id);
                      }}
                      className={`group flex min-h-14 cursor-pointer items-center gap-2 border-b border-line px-5.5 ${
                        selected
                          ? "bg-canvas shadow-[inset_3px_0_0_var(--color-ink)]"
                          : "hover:bg-subtle"
                      }`}
                    >
                      {nameLink(child)}
                      <Tags child={child} />
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="m-0 px-5.5 py-3.5 text-caption text-muted">{footer}</p>
          </nav>
          <div className="min-w-0 flex-1 border-l border-line">{person}</div>
        </div>
      </ListCard>
    );

  return (
    <ListCard toolbar={toolbar} toolbarEnd={toolbarEnd} footer={footer}>
      {empty ? (
        <p className="m-0 px-6 py-10 text-center text-muted">{empty}</p>
      ) : (
        <Table variant="list" aria-busy={busy}>
          <thead>
            <TableRow>
              <TableHead className="h-11 py-0">{tr("columns.name")}</TableHead>
              <TableHead className="h-11 w-40 py-0">
                {tr("columns.group", { group: word })}
              </TableHead>
              <TableHead numeric className="h-11 w-24 py-0">
                {t("columns.photos")}
              </TableHead>
              {showOrdered ? (
                <TableHead className="h-11 w-40 py-0">{t("columns.ordered")}</TableHead>
              ) : null}
              <RowChevronHead />
            </TableRow>
          </thead>
          <tbody>
            {rows.map((child) => (
              <ClickableRow key={child.id} onActivate={() => onOpen(child.id)} className="h-14">
                <TableCell className="py-0">
                  <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                    {nameLink(child)}
                    <Tags child={child} />
                  </span>
                </TableCell>
                <TableCell className="py-0 whitespace-nowrap">
                  {child.group?.name ?? noGroup}
                </TableCell>
                <TableCell numeric className="py-0">
                  {child.photoCount}
                </TableCell>
                {showOrdered ? (
                  <TableCell className="py-0 whitespace-nowrap">
                    <OrderedPill hasPaidOrder={child.hasPaidOrder} />
                  </TableCell>
                ) : null}
                <RowChevron className="py-0" />
              </ClickableRow>
            ))}
          </tbody>
        </Table>
      )}
    </ListCard>
  );
}
