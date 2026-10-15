"use client";

import type { PhotoGroup } from "@daybell/api";
import {
  Banner,
  Button,
  ClickableRow,
  iconButtonVariants,
  ListCard,
  Table,
  TableCell,
  TableHead,
} from "@daybell/ui";
import { Columns3, Ellipsis, Pencil, Plus, Trash2, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MENU_ROW, Popover } from "../../../../popover";
import { JobTabActions, useJob } from "../../job-context";
import { JobSection } from "../../job-section";
import { groupHref, tabHref } from "../../tabs";
import { PhotosSwitch } from "../photos-switch";
import { useRuns } from "../runs-store";
import { isActive, UploadSheet, useLeaveWarning } from "../upload-sheet";
import { usePhotoGroups } from "../use-photo-groups";
import { ColumnDialog, DeleteGroupDialog, GroupNameDialog, MembersDialog } from "./group-dialogs";

type Open =
  | { kind: "new" }
  | { kind: "column" }
  | { kind: "rename"; group: PhotoGroup }
  | { kind: "members"; group: PhotoGroup }
  | { kind: "delete"; group: PhotoGroup }
  | null;

/**
 * Photos' Groups (D156; ADR 0030): Not in a group (n) first when some group photos are in no group (C2; call 1), then
 * each group by name: Group (opens its page), Members (links to Subjects filtered by the group), Group photos, Ordered
 * (owners and admins, C16), and ⋯ Rename, Add or remove people, Delete. Make groups from a column and + New group at the
 * card's right end. Owners, admins and photographers change groups (C11); staff and closed jobs look only.
 */
export default function GroupsPage() {
  const t = useTranslations("app.photos.groups");
  const tp = useTranslations("app.photos");
  const router = useRouter();
  const { job, canEditRoster, canManage, refreshSummary } = useJob();
  const closed = job.status === "closed";
  const canEdit = canEditRoster && !closed;
  const { groups, notInGroup, failed, reload } = usePhotoGroups(job.id);
  const [open, setOpen] = useState<Open>(null);
  const [status, setStatus] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [runs, setRuns] = useRuns(job.id);
  const uploading = runs.some(isActive);
  useLeaveWarning(uploading);
  const list = groups ?? [];
  const subjects = (groupId: string) =>
    `${tabHref(job.id, "people")}?group=${encodeURIComponent(groupId)}`;

  async function done(message: string) {
    setOpen(null);
    setStatus(message);
    await reload();
    refreshSummary();
  }

  return (
    <JobSection
      title={groups ? t("heading", { count: list.length }) : null}
      below={
        <>
          <JobTabActions>
            {canEdit ? (
              <Button
                variant="white"
                shape="pill"
                aria-expanded={sheetOpen}
                onClick={() => setSheetOpen((o) => !o)}
              >
                <Upload aria-hidden="true" />
                {tp("upload")}
              </Button>
            ) : null}
          </JobTabActions>
          {closed ? <Banner tone="info" title={t("closed")} /> : null}
          {(sheetOpen || uploading) && canEdit ? (
            <UploadSheet
              jobId={job.id}
              runs={runs}
              setRuns={setRuns}
              groups={groups}
              onClose={() => setSheetOpen(false)}
              onUploaded={() => {
                void reload();
                refreshSummary();
              }}
            />
          ) : null}
          {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
          <p role="status" className="m-0 text-sm font-semibold text-ink empty:-mb-4">
            {status}
          </p>
          {failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
        </>
      }
    >
      <ListCard
        label={t("label")}
        toolbar={<PhotosSwitch jobId={job.id} current="groups" />}
        toolbarEnd={
          canEdit ? (
            <>
              <Button variant="secondary" shape="pill" onClick={() => setOpen({ kind: "column" })}>
                <Columns3 aria-hidden="true" />
                {t("fromColumn")}
              </Button>
              <Button shape="pill" onClick={() => setOpen({ kind: "new" })}>
                <Plus aria-hidden="true" />
                {t("newGroup")}
              </Button>
            </>
          ) : null
        }
        footer={groups && list.length > 0 ? t("heading", { count: list.length }) : null}
      >
        {!groups && !failed ? (
          <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>
        ) : null}
        {groups && list.length === 0 && notInGroup === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <p className="m-0 max-w-120 text-muted">{t("empty")}</p>
            {canEditRoster ? null : (
              <p className="m-0 text-caption text-muted">{t("emptyReadOnly")}</p>
            )}
          </div>
        ) : null}
        {groups && (list.length > 0 || notInGroup > 0) ? (
          <Table variant="list">
            <thead>
              <tr>
                <TableHead>{t("columns.group")}</TableHead>
                <TableHead numeric>{t("columns.members")}</TableHead>
                <TableHead numeric>{t("columns.photos")}</TableHead>
                {canManage ? <TableHead numeric>{t("columns.ordered")}</TableHead> : null}
                {canEdit ? (
                  <TableHead>
                    <span className="sr-only">{t("columns.actions")}</span>
                  </TableHead>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {notInGroup > 0 ? (
                <ClickableRow onActivate={() => router.push(groupHref(job.id, "none"))}>
                  <TableCell>
                    <Link
                      href={groupHref(job.id, "none")}
                      className="inline-flex min-h-11 items-center font-semibold text-ink no-underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {t("notInGroup")}
                    </Link>
                    <p className="m-0 text-caption text-muted">{t("notInGroupNote")}</p>
                  </TableCell>
                  <TableCell numeric>–</TableCell>
                  <TableCell numeric>{t("photoCount", { count: notInGroup })}</TableCell>
                  {canManage ? <TableCell numeric>–</TableCell> : null}
                  {canEdit ? <TableCell /> : null}
                </ClickableRow>
              ) : null}
              {list.map((group) => (
                <ClickableRow
                  key={group.id}
                  onActivate={() => router.push(groupHref(job.id, group.id))}
                >
                  <TableCell>
                    <Link
                      href={groupHref(job.id, group.id)}
                      className="inline-flex min-h-11 items-center font-semibold text-ink no-underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {group.name}
                    </Link>
                  </TableCell>
                  <TableCell numeric>
                    <Link
                      href={subjects(group.id)}
                      aria-label={t("membersLink", { count: group.members, name: group.name })}
                      className="inline-flex min-h-11 items-center text-ink underline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {t("members", { count: group.members })}
                    </Link>
                  </TableCell>
                  <TableCell numeric>{t("photoCount", { count: group.photos })}</TableCell>
                  {canManage ? (
                    <TableCell numeric>
                      {group.ordered === null ? "–" : t("orderedCount", { count: group.ordered })}
                    </TableCell>
                  ) : null}
                  {canEdit ? (
                    <TableCell className="w-14">
                      <Popover
                        label={t("more", { name: group.name })}
                        trigger={<Ellipsis aria-hidden="true" />}
                        triggerClassName={iconButtonVariants({ tone: "canvas" })}
                        panelClassName="w-64"
                      >
                        {(close) => (
                          <>
                            <button
                              type="button"
                              className={MENU_ROW}
                              onClick={() => {
                                close();
                                setOpen({ kind: "rename", group });
                              }}
                            >
                              <Pencil aria-hidden="true" />
                              {t("rename")}
                            </button>
                            <button
                              type="button"
                              className={MENU_ROW}
                              onClick={() => {
                                close();
                                setOpen({ kind: "members", group });
                              }}
                            >
                              <Users aria-hidden="true" />
                              {t("addRemove")}
                            </button>
                            <button
                              type="button"
                              className={`${MENU_ROW} text-danger [&_svg]:text-danger`}
                              onClick={() => {
                                close();
                                setOpen({ kind: "delete", group });
                              }}
                            >
                              <Trash2 aria-hidden="true" />
                              {t("delete")}
                            </button>
                          </>
                        )}
                      </Popover>
                    </TableCell>
                  ) : null}
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        ) : null}
      </ListCard>

      <GroupNameDialog
        jobId={job.id}
        group={open?.kind === "rename" ? open.group : null}
        groups={list}
        open={open?.kind === "new" || open?.kind === "rename"}
        onClose={() => setOpen(null)}
        onSaved={(g) =>
          void done(
            open?.kind === "rename"
              ? t("announce.renamed", { name: g.name })
              : t("announce.created", { name: g.name }),
          )
        }
      />
      <MembersDialog
        jobId={job.id}
        group={open?.kind === "members" ? open.group : null}
        open={open?.kind === "members"}
        onClose={() => setOpen(null)}
        onSaved={(c) => void done(t("announce.members", c))}
      />
      <DeleteGroupDialog
        group={open?.kind === "delete" ? open.group : null}
        groups={list}
        open={open?.kind === "delete"}
        onClose={() => setOpen(null)}
        onDeleted={() =>
          void done(t("announce.deleted", { name: open?.kind === "delete" ? open.group.name : "" }))
        }
      />
      <ColumnDialog
        jobId={job.id}
        groups={list}
        open={open?.kind === "column"}
        onClose={() => setOpen(null)}
        onMade={(m) => void done(t("announce.made", { made: m.made, skipped: m.skipped }))}
      />
    </JobSection>
  );
}
