import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import tokens from "../tokens.json";

// Our type styles (text-body, text-caption…) are font sizes, not colours. Without this, tailwind-merge
// treats them as colours and drops them when a colour class follows (e.g. "text-caption text-muted").
const typeStyles = tokens.type.groups.flatMap((g) => g.styles.map((s) => s.name));

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: typeStyles }] } },
});

/** Joins class names and lets later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
