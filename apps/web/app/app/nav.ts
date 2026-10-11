import {
  Camera,
  ChartColumn,
  CircleDollarSign,
  House,
  Megaphone,
  Package,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";

/** The studio app's sections, in menu order (D126). `built: false` shows as "Soon" (D128). */
export const SECTIONS = [
  { key: "home", href: "/app", icon: House, built: true, tab: true },
  { key: "jobs", href: "/app/jobs", icon: Camera, built: false, tab: true },
  { key: "orders", href: "/app/orders", icon: ShoppingBag, built: false, tab: true },
  { key: "products", href: "/app/products", icon: Package, built: false, tab: false },
  { key: "contacts", href: "/app/contacts", icon: Users, built: false, tab: false },
  { key: "marketing", href: "/app/marketing", icon: Megaphone, built: false, tab: false },
  { key: "money", href: "/app/money", icon: CircleDollarSign, built: false, tab: false },
  { key: "reports", href: "/app/reports", icon: ChartColumn, built: false, tab: false },
  { key: "settings", href: "/app/settings", icon: Settings, built: true, tab: false },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
export const SOON_SECTIONS = SECTIONS.filter((s) => !s.built).map((s) => s.key.toString());

/** Which menu item to highlight for a path; null for pages outside the menu (e.g. the shop preview). */
export function sectionForPath(pathname: string): SectionKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app") return "home";
  const match = SECTIONS.find(
    (s) => s.href !== "/app" && (path === s.href || path.startsWith(`${s.href}/`)),
  );
  return match?.key ?? null;
}
