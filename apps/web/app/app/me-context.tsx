"use client";

import type { MeResponse } from "@daybell/api";
import { createContext, useContext } from "react";

export interface StudioContextValue {
  me: MeResponse & { studio: NonNullable<MeResponse["studio"]> };
  /** Bump to make cards re-fetch after a change (e.g. team or activity). */
  version: number;
  changed: () => void;
}

export const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside the studio app shell");
  return value;
}
