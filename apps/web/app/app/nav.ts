import {
  Camera,
  ChartColumn,
  House,
  Package,
  Settings,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";

/**
 * The studio app's sections, in menu order (D150, replacing D126's list): Marketing folds into Shop (D149), Money into
 * Analytics, Activity becomes timelines on records. `built: false` shows as "Soon" (D128). The "products" key is the
 * menu's Price lists (D150); its route stays /app/products.
 */
export const SECTIONS = [
  { key: "home", href: "/app", icon: House, built: true },
  { key: "jobs", href: "/app/jobs", icon: Camera, built: true },
  { key: "orders", href: "/app/orders", icon: ShoppingBag, built: true },
  { key: "products", href: "/app/products", icon: Package, built: true },
  { key: "people", href: "/app/people", icon: Users, built: true },
  { key: "shop", href: "/app/shop", icon: Store, built: false },
  { key: "analytics", href: "/app/analytics", icon: ChartColumn, built: false },
  { key: "settings", href: "/app/settings", icon: Settings, built: true },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
export const SOON_SECTIONS = SECTIONS.filter((s) => !s.built).map((s) => s.key.toString());

/** Which menu item to highlight for a path; null for pages outside the menu (e.g. Help). */
export function sectionForPath(pathname: string): SectionKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app") return "home";
  const match = SECTIONS.find(
    (s) => s.href !== "/app" && (path === s.href || path.startsWith(`${s.href}/`)),
  );
  return match?.key ?? null;
}
