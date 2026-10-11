import { notFound } from "next/navigation";
import { SOON_SECTIONS } from "../nav";
import { ComingSoon } from "./coming-soon";

// Sections still being built (D128), plus the parent-shop preview behind "View my shop".
const ALLOWED = new Set([...SOON_SECTIONS, "shop"]);

export function generateStaticParams() {
  return [...ALLOWED].map((section) => ({ section }));
}
export const dynamicParams = false;

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!ALLOWED.has(section)) notFound();
  return <ComingSoon section={section} />;
}
