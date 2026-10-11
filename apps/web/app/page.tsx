import { DATA_REGIONS } from "@daybell/config";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("home");
  return (
    <main className="mx-auto max-w-160 px-4 py-12">
      <h1 className="m-0 text-h1">{t("title")}</h1>
      <p className="text-muted">
        {t("status")} {DATA_REGIONS.join(" · ").toUpperCase()}
      </p>
      <Link href="/dev/components" className="font-semibold text-primary">
        {t("componentsLink")}
      </Link>
    </main>
  );
}
