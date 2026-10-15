import { JOB_SHOP_CONFLICTS } from "@daybell/api";

/** The conflict keys a Job › Shop request can be refused with (JOB_SHOP_CONFLICTS), without the "jobShop." prefix. */
export type JobShopConflictKey = keyof typeof JOB_SHOP_CONFLICTS;

export function jobShopConflictKey(form: string | undefined): JobShopConflictKey | null {
  const keys = Object.keys(JOB_SHOP_CONFLICTS) as JobShopConflictKey[];
  return keys.find((key) => JOB_SHOP_CONFLICTS[key] === form) ?? null;
}
