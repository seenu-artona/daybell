"use client";

import type { Job, PhotoCounts, QrCardStatus } from "@daybell/api";
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

export interface JobSummary {
  /** Children on the roster. */
  children: number;
  /** Of those, flagged as possible duplicates. */
  duplicates: number;
  /** Classes, teams or groups. */
  groups: number;
  /** QR cards (ADR 0015): who may be photographed and how many of them have a card; null if it couldn't be loaded. */
  qrCards: QrCardStatus | null;
  /** Photos (ADR 0016): the job's photo counts; null if they couldn't be loaded. */
  photos: PhotoCounts | null;
}

export interface JobContextValue {
  job: Job;
  setJob: (job: Job) => void;
  /** Null until loaded (or if it couldn't be loaded). */
  summary: JobSummary | null;
  /** Call after any roster change or print, so the People count and the Overview numbers stay right. */
  refreshSummary: () => void;
  /**
   * The checklist's Review tagging task is done (ADR 0018), for "Before you can sell": from the job as first loaded,
   * then from whatever loads the job's checklist or tagging summary since (the Overview, Review), so the dialog never
   * fetches the job again for one flag (code review nice 6).
   */
  taggingReviewed: boolean;
  setTaggingReviewed: (done: boolean) => void;
  /** Owners and admins: edit the job, start selling, see its activity. */
  canManage: boolean;
  /** Owners, admins and photographers: add, import, edit and remove children. */
  canEditRoster: boolean;
  /** The right end of the job's tab row, where a section puts its actions (D147); null until it is on the page. */
  tabActions: HTMLElement | null;
}

export const JobContext = createContext<JobContextValue | null>(null);

/** The job the page is showing, loaded once by the job layout and shared by every section (D137). */
export function useJob(): JobContextValue {
  const value = useContext(JobContext);
  if (!value) throw new Error("useJob must be used inside the job layout");
  return value;
}

/**
 * A section's actions at the right end of the job's tab row (D147, ADR 0026), e.g. Subjects' Print QR cards and Add
 * subjects, or Photos' Upload photos: rendered there (a portal) so they stay in the sticky row, after the tabs in the
 * reading and tab order, and before the section's content.
 */
export function JobTabActions({ children }: { children: ReactNode }) {
  const { tabActions } = useJob();
  return tabActions ? createPortal(children, tabActions) : null;
}
