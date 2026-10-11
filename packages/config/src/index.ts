/** Data regions a studio can choose at sign-up (D113). Quebec is excluded at launch (D90). */
export const DATA_REGIONS = ["us", "ca"] as const;
export type DataRegion = (typeof DATA_REGIONS)[number];
