"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

/** A record's name by its id: the name, null when it is gone (not found), undefined when it couldn't be told. */
export type RecordLookup = (id: string) => Promise<string | null | undefined>;

/** The map key for a chip's record. */
export const recordKey = (key: string, id: string) => `${key}:${id}`;

/** A client's name, from GET /clients/:id (the studio's own only). */
export const clientName: RecordLookup = async (id) => {
  const res = await api<{ client: { name: string } }>(`/clients/${encodeURIComponent(id)}`);
  if (res.ok) return res.data.client.name;
  return res.code === "not_found" ? null : undefined;
};

/** A job's name, from GET /jobs/:id (the studio's own only). */
export const jobName: RecordLookup = async (id) => {
  const res = await api<{ job: { name: string } }>(`/jobs/${encodeURIComponent(id)}`);
  if (res.ok) return res.data.job.name;
  return res.code === "not_found" ? null : undefined;
};

/**
 * The names of the records chips point at (D147): looked up by id each time the page opens, never stored with the
 * chip, so a renamed client shows its new name and nothing personal is saved (D113). Each id is asked for once.
 */
export function useRecordNames(
  refs: readonly { key: string; value: string | null }[],
  lookups: Readonly<Record<string, RecordLookup>>,
): ReadonlyMap<string, string | null> {
  const [names, setNames] = useState<ReadonlyMap<string, string | null>>(new Map());
  const asked = useRef(new Set<string>());
  const lookupsRef = useRef(lookups);
  lookupsRef.current = lookups;
  const wanted = refs
    .filter((r): r is { key: string; value: string } => r.value !== null && r.key in lookups)
    .map((r) => recordKey(r.key, r.value));
  const signature = [...new Set(wanted)].sort().join(",");

  useEffect(() => {
    let live = true;
    const pending = new Set<string>();
    for (const entry of signature ? signature.split(",") : []) {
      if (asked.current.has(entry)) continue;
      const at = entry.indexOf(":");
      const lookup = lookupsRef.current[entry.slice(0, at)];
      if (!lookup) continue;
      asked.current.add(entry);
      pending.add(entry);
      void lookup(entry.slice(at + 1)).then((name) => {
        pending.delete(entry);
        if (!live) return;
        // Unknown (a network problem): asked again when the chips change or the page opens again.
        if (name === undefined) {
          asked.current.delete(entry);
          return;
        }
        setNames((current) => new Map(current).set(entry, name));
      });
    }
    return () => {
      live = false;
      // Answers this run won't use are asked for again by the next one.
      for (const entry of pending) asked.current.delete(entry);
    };
  }, [signature]);

  return names;
}
