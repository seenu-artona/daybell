"use client";

import type { DataRegion } from "@daybell/config";
import { useTranslations } from "next-intl";

/** Region choice (D113). Hidden when only one region is set up in this environment (D122). */
export function RegionField({
  regions,
  value,
  onChange,
  showFixedNote = true,
}: {
  regions: DataRegion[];
  value: DataRegion;
  onChange: (r: DataRegion) => void;
  showFixedNote?: boolean;
}) {
  const t = useTranslations("auth");
  // No database set up here: say nothing about where data lives; the form shows the server's error instead.
  if (regions.length === 0) return null;
  if (regions.length === 1) {
    return showFixedNote ? (
      <p className="m-0 text-caption text-muted">
        {t("regionFixed", { region: t(`regions.${value}`) })}
      </p>
    ) : null;
  }
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 text-label">{t("regionLabel")}</legend>
      <div className="flex gap-2">
        {regions.map((r) => (
          <label
            key={r}
            className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 has-checked:border-primary has-checked:bg-primary-soft"
          >
            <input
              type="radio"
              name="region"
              value={r}
              checked={value === r}
              onChange={() => onChange(r)}
            />
            {t(`regions.${r}`)}
          </label>
        ))}
      </div>
      <span className="text-caption text-muted">{t("regionHelp")}</span>
    </fieldset>
  );
}
