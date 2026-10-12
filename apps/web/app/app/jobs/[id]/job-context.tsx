"use client";

import type { Job, QrCardStatus } from "@daybell/api";
import { createContext, useContext } from "react";

export interface JobSummary {
  /** Children on the roster. */
  children: number;
  /** Of those, flagged as possible duplicates. */
  duplicates: number;
  /** Classes, teams or groups. */
  groups: number;
  /** QR cards (ADR 0015): who may be photographed and how many of them have a card; null if it couldn't be loaded. */
  qrCards: QrCardStatus | null;
}

export interface JobContextValue {
  job: Job;
  setJob: (job: Job) => void;
  /** Null until loaded (or if it couldn't be loaded). */
  summary: JobSummary | null;
  /** Call after any roster change or print, so the People count and the Overview numbers stay right. */
  refreshSummary: () => void;
  /** Owners and admins: edit the job, start selling, see its activity. */
  canManage: boolean;
  /** Owners, admins and photographers: add, import, edit and remove children. */
  canEditRoster: boolean;
}

export const JobContext = createContext<JobContextValue | null>(null);

/** The job the page is showing, loaded once by the job layout and shared by every section (D137). */
export function useJob(): JobContextValue {
  const value = useContext(JobContext);
  if (!value) throw new Error("useJob must be used inside the job layout");
  return value;
}
