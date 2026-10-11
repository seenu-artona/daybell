import {
  Camera,
  ChartColumn,
  CircleDollarSign,
  House,
  Megaphone,
  Package,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";

/** The studio app's sections, in menu order (D126). `built: false` shows as "Soon" (D128). */
export const SECTIONS = [
  { key: "home", href: "/app", icon: House, built: true },
  { key: "jobs", href: "/app/jobs", icon: Camera, built: false },
  { key: "orders", href: "/app/orders", icon: ShoppingCart, built: false },
  { key: "products", href: "/app/products", icon: Package, built: false },
  { key: "contacts", href: "/app/contacts", icon: Users, built: false },
  { key: "marketing", href: "/app/marketing", icon: Megaphone, built: false },
  { key: "money", href: "/app/money", icon: CircleDollarSign, built: false },
  { key: "reports", href: "/app/reports", icon: ChartColumn, built: false },
  { key: "settings", href: "/app/settings", icon: Settings, built: true },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
export const SOON_SECTIONS = SECTIONS.filter((s) => !s.built).map((s) => s.key.toString());

export function sectionForPath(pathname: string): SectionKey {
  const match = [...SECTIONS]
    .reverse()
    .find((s) => s.href !== "/app" && pathname.startsWith(s.href));
  return match?.key ?? "home";
}
