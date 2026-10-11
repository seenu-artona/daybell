import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("auth");
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-12">
      <div className="mb-8 flex items-center gap-2.5 text-xl font-extrabold">
        <span
          className="grid size-8 place-items-center rounded-[9px] bg-lime text-ink"
          aria-hidden="true"
        >
          D
        </span>
        {t("brand")}
      </div>
      <div className="w-full max-w-110 rounded-lg border border-line bg-surface p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </main>
  );
}
