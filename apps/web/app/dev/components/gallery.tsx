"use client";

import { formatMoney, money } from "@daybell/core";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardMeta,
  CardRow,
  CardTitle,
  Celebration,
  CodeInput,
  ConfettiBurst,
  Field,
  IconButton,
  IconChip,
  JobProgress,
  MoneyStat,
  OptionCard,
  PhotoTile,
  RidgeMark,
  ShopFrame,
  SideMenu,
  SideMenuItem,
  Stat,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Toast,
} from "@daybell/ui";
import {
  ArrowLeft,
  Camera,
  Check,
  CircleDollarSign,
  Ellipsis,
  House,
  ListFilter,
  Package,
  QrCode,
  School,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

const usd = (cents: number) => formatMoney(money(cents, "USD"));
const usdWhole = (cents: number) => formatMoney(money(cents, "USD"), "en-US", { whole: true });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-8">
      <h2 className="m-0 text-h2">{title}</h2>
      {children}
    </section>
  );
}

/** Placeholder portrait drawn with tokens, so the gallery needs no real child photos. */
function Portrait({ n, alt }: { n: number; alt: string }) {
  const tones = ["fill-primary-soft", "fill-info-soft", "fill-warning-soft", "fill-lime-soft"];
  return (
    <svg viewBox="0 0 80 100" role="img" aria-label={alt}>
      <rect width="80" height="100" className={tones[n % tones.length]} />
      <circle cx="40" cy="40" r="15" className="fill-line-strong" />
      <path d="M14 100c2-22 13-32 26-32s24 10 26 32z" className="fill-line-strong" />
    </svg>
  );
}

export function Gallery() {
  const t = useTranslations("gallery");
  const [burst, setBurst] = useState(0);
  const [confetti, setConfetti] = useState(0);
  const [code, setCode] = useState("LINC2");
  const [pose, setPose] = useState(1);
  const [sold, setSold] = useState(true);
  const [pkg, setPkg] = useState("family");
  const prices: Record<string, number> = { basic: 2900, family: 5400, digital: 3500 };

  return (
    <main className="mx-auto flex max-w-[1040px] flex-col gap-10 px-4 py-12">
      <header>
        <h1 className="m-0 text-h1">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
      </header>

      <Section title={t("sections.basics")}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{t("buttons.publish")}</Button>
          <Button variant="secondary">{t("buttons.preview")}</Button>
          <Button variant="ghost">{t("buttons.addPhotos")}</Button>
          <Button variant="danger">{t("buttons.delete")}</Button>
          <Button size="sm">{t("buttons.small")}</Button>
          <Button disabled>{t("buttons.disabled")}</Button>
        </div>
        <div className="grid max-w-90 gap-4">
          <Field
            label={t("fields.jobName")}
            defaultValue={t("fields.jobNameValue")}
            help={t("fields.jobNameHelp")}
          />
          <Field label={t("fields.code")} defaultValue="LINC" error={t("fields.codeError")} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Badge tone="draft">{t("badges.draft")}</Badge>
          <Badge tone="selling">{t("badges.selling")}</Badge>
          <Badge tone="money">{t("badges.paidOut")}</Badge>
          <Badge tone="warning">{t("badges.closing")}</Badge>
          <Badge tone="danger">{t("badges.failed")}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={sold}
            onCheckedChange={setSold}
            label={t("switch.label")}
            onText={t("switch.on")}
            offText={t("switch.off")}
          />
        </div>
      </Section>

      <Section title={t("sections.layout")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardTitle>{t("jobs.lincoln")}</CardTitle>
            <CardMeta>{t("jobs.lincolnMeta")}</CardMeta>
            <Badge tone="selling" className="mt-4">
              {t("badges.selling")}
            </Badge>
          </Card>
          <Card>
            <CardTitle>{t("jobs.westview")}</CardTitle>
            <CardMeta>{t("jobs.westviewMeta")}</CardMeta>
            <Badge className="mt-4">{t("badges.draft")}</Badge>
          </Card>
        </div>
        <Table>
          <thead>
            <TableRow>
              <TableHead>{t("table.order")}</TableHead>
              <TableHead>{t("table.parent")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead numeric>{t("table.total")}</TableHead>
            </TableRow>
          </thead>
          <tbody>
            {[
              ["#10234", "Jamie Ortiz", "selling", "table.paid", 8400],
              ["#10233", "Priya Shah", "warning", "table.atLab", 12950],
              ["#10232", "Mark Ellis", "money", "table.shipped", 4200],
            ].map(([id, name, tone, status, cents]) => (
              <TableRow key={id as string}>
                <TableCell>{id}</TableCell>
                <TableCell>{name}</TableCell>
                <TableCell>
                  <Badge tone={tone as "selling" | "warning" | "money"}>
                    {t(status as "table.paid" | "table.atLab" | "table.shipped")}
                  </Badge>
                </TableCell>
                <TableCell numeric>{usd(cents as number)}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
        <SideMenu
          className="rounded-lg"
          label={t("menu.label")}
          brand={
            <>
              <RidgeMark tone="dark" className="size-7" />
              {t("brand")}
            </>
          }
        >
          <SideMenuItem href="#" icon={<House />}>
            {t("menu.home")}
          </SideMenuItem>
          <SideMenuItem href="#" icon={<Camera />} current>
            {t("menu.jobs")}
          </SideMenuItem>
          <SideMenuItem
            href="#"
            icon={<ShoppingCart />}
            count={12}
            countLabel={t("menu.ordersCount", { count: 12 })}
          >
            {t("menu.orders")}
          </SideMenuItem>
          <SideMenuItem href="#" icon={<Package />}>
            {t("menu.products")}
          </SideMenuItem>
          <SideMenuItem href="#" icon={<CircleDollarSign />}>
            {t("menu.money")}
          </SideMenuItem>
          <SideMenuItem href="#" icon={<School />}>
            {t("menu.schools")}
          </SideMenuItem>
          <SideMenuItem href="#" icon={<Settings />}>
            {t("menu.settings")}
          </SideMenuItem>
        </SideMenu>
      </Section>

      <Section title={t("sections.jobPage")}>
        <div className="flex flex-col gap-4 rounded-xl bg-canvas p-6">
          <div className="flex flex-wrap items-center gap-3">
            <IconButton label={t("jobPage.back")}>
              <ArrowLeft aria-hidden="true" />
            </IconButton>
            <IconButton label={t("jobPage.more")}>
              <Ellipsis aria-hidden="true" />
            </IconButton>
            <IconButton label={t("jobPage.filter")}>
              <ListFilter aria-hidden="true" />
            </IconButton>
            <Button variant="white" shape="pill">
              {t("jobPage.import")}
            </Button>
            <Button shape="pill">{t("jobPage.startSelling")}</Button>
          </div>
          <Card variant="sheet" asChild>
            <section aria-labelledby="gallery-todos">
              <CardRow>
                <h3 id="gallery-todos" className="m-0 flex-1 text-h3 font-bold">
                  {t("jobPage.todosTitle")}
                </h3>
                <p className="m-0 text-label text-muted">{t("jobPage.progress")}</p>
              </CardRow>
              {(
                [
                  ["jobCreated", "lime", Check, "done"],
                  ["rosterAdded", "lime", Users, "done"],
                  ["printQrCards", "neutral", QrCode, "soon"],
                ] as const
              ).map(([key, tone, Icon, state]) => (
                <CardRow key={key}>
                  <IconChip tone={tone}>
                    <Icon />
                  </IconChip>
                  <span className="flex-1 text-title-sm">{t(`jobPage.${key}`)}</span>
                  <span className="text-label font-bold text-muted">{t(`jobPage.${state}`)}</span>
                </CardRow>
              ))}
            </section>
          </Card>
        </div>
      </Section>

      <Section title={t("sections.money")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyStat
            label={t("money.season")}
            cents={4826000}
            currency="USD"
            delta={t("money.week", { amount: usdWhole(314000) })}
          />
          <div className="grid gap-4">
            <Stat label={t("money.payout")} value={usd(681240)} />
            <Stat label={t("money.ordersToday")} value="37" />
          </div>
        </div>
        <Card className="max-w-130">
          <JobProgress
            title={t("jobs.lincoln")}
            percent={68}
            label={t("money.progressLabel")}
            badge={<Badge tone="money">{t("money.toGoal", { percent: 68 })}</Badge>}
            metaStart={t("money.ofGoal", { sold: usdWhole(612000), goal: usdWhole(900000) })}
            metaEnd={t("money.families", { ordered: 281, total: 412 })}
          />
        </Card>
        <div className="flex justify-center">
          <Celebration
            burst={burst}
            icon="🎉"
            title={t("celebrate.title")}
            announcement={t("celebrate.title")}
            body={t("celebrate.body")}
            action={<Button onClick={() => setBurst((b) => b + 1)}>{t("celebrate.again")}</Button>}
          />
        </div>
        {/* The page-wide burst when a job goes live (ADR 0021); nothing with reduced motion. */}
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setConfetti((c) => c + 1)}>
            {t("celebrate.confetti")}
          </Button>
          {confetti > 0 ? <ConfettiBurst key={confetti} /> : null}
        </div>
      </Section>

      <Section title={t("sections.feedback")}>
        <div className="grid max-w-140 gap-3">
          <Banner tone="info" title={t("banners.tipTitle")}>
            {t("banners.tip")}
          </Banner>
          <Banner tone="warning" title={t("banners.closingTitle")}>
            {t("banners.closing")}
          </Banner>
          <Banner tone="danger" title={t("banners.declinedTitle")}>
            {t("banners.declined")}
          </Banner>
          <Banner tone="success" title={t("banners.shippedTitle")}>
            {t("banners.shipped")}
          </Banner>
          <div>
            <Toast>{t("banners.toast", { amount: usd(8400) })}</Toast>
          </div>
        </div>
      </Section>

      <Section title={t("sections.photos")}>
        <div
          role="radiogroup"
          aria-label={t("photos.group")}
          className="grid max-w-140 grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {[1, 2, 3, 4].map((n) => (
            <PhotoTile
              key={n}
              image={<Portrait n={n} alt={t("photos.alt", { n })} />}
              tag={t("photos.tag", { n })}
              mode="radio"
              selected={pose === n}
              onClick={() => setPose(n)}
            />
          ))}
        </div>
      </Section>

      <Section title={t("sections.shop")}>
        <div className="grid gap-6 lg:grid-cols-3">
          <ShopFrame
            studioName={t("shop.studio")}
            studioInitials={t("shop.initials")}
            studioColor="charcoal"
            cartLabel={t("shop.cart", { count: 0 })}
            footer={t("shop.footer")}
          >
            <h3 className="m-0 mb-1 text-h2">{t("shop.accessTitle")}</h3>
            <p className="mt-0 mb-4 text-muted">{t("shop.accessSub")}</p>
            <CodeInput
              value={code}
              onChange={setCode}
              label={t("shop.codeLabel")}
              charLabel={(n) => t("shop.codeChar", { n })}
            />
            <Field
              className="mt-4"
              type="email"
              label={t("shop.email")}
              placeholder={t("shop.emailPlaceholder")}
            />
            <Button
              block
              className="mt-4 bg-studio text-on-studio hover:bg-studio hover:brightness-95 focus-visible:outline-studio-ring"
            >
              {t("shop.seePhotos")}
            </Button>
          </ShopFrame>

          <ShopFrame
            studioName={t("shop.studio")}
            studioInitials={t("shop.initials")}
            studioColor="charcoal"
            cartCount={2}
            cartLabel={t("shop.cart", { count: 2 })}
            footer={t("shop.footer")}
          >
            <div
              role="radiogroup"
              aria-label={t("photos.group")}
              className="grid grid-cols-2 gap-2.5"
            >
              {[1, 2, 3, 4].map((n) => (
                <PhotoTile
                  key={n}
                  image={<Portrait n={n} alt={t("photos.alt", { n })} />}
                  tag={t("photos.tag", { n })}
                  watermark={t("shop.watermark")}
                  mode="radio"
                  selected={pose === n}
                  onClick={() => setPose(n)}
                />
              ))}
            </div>
          </ShopFrame>

          <ShopFrame
            studioName={t("shop.studio")}
            studioInitials={t("shop.initials")}
            studioColor="charcoal"
            cartCount={2}
            cartLabel={t("shop.cart", { count: 2 })}
            footer={t("shop.footer")}
          >
            <h3 className="m-0 mb-4 text-h2">{t("shop.choose")}</h3>
            <div className="flex flex-col gap-2.5">
              {(["basic", "family", "digital"] as const).map((id) => (
                <OptionCard
                  key={id}
                  name="package"
                  value={id}
                  checked={pkg === id}
                  onChange={() => setPkg(id)}
                  title={t(`shop.${id}`)}
                  description={t(`shop.${id}Desc`)}
                  price={usdWhole(prices[id] ?? 0)}
                  flag={id === "family" ? t("shop.popular") : undefined}
                />
              ))}
            </div>
            <Button
              block
              className="mt-4 bg-studio text-on-studio hover:bg-studio hover:brightness-95 focus-visible:outline-studio-ring"
            >
              {t("shop.addToCart", { amount: usdWhole(prices[pkg] ?? 0) })}
            </Button>
          </ShopFrame>
        </div>
      </Section>
    </main>
  );
}
