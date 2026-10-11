import Link from "next/link";
import { useTranslations } from "next-intl";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;
  return <CheckEmail reset={reset === "1"} />;
}

function CheckEmail({ reset }: { reset: boolean }) {
  const t = useTranslations("auth.checkEmail");
  return (
    <div className="flex flex-col gap-3 text-center">
      <div
        className="mx-auto grid size-14 place-items-center rounded-full bg-lime text-2xl"
        aria-hidden="true"
      >
        ✉️
      </div>
      <h1 className="m-0 text-h2">{t("title")}</h1>
      <p className="m-0 text-muted">{reset ? t("resetBody") : t("body")}</p>
      <Link href="/sign-in" className="font-semibold text-primary">
        {t("back")}
      </Link>
    </div>
  );
}
