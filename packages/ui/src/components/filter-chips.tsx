import { Slot, Slottable } from "@radix-ui/react-slot";
import { Check, Plus, X } from "lucide-react";
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

export interface FilterChipsProps extends HTMLAttributes<HTMLElement> {
  /** The navigation landmark's name, e.g. "Show jobs". */
  label: string;
  /** After the chips, on the same row: the "+ Add filter" menu. */
  addFilter?: ReactNode;
}

/**
 * A list's filter chips (D147, amends D144 and D145): one row of pills at the left of a list card's toolbar, exactly
 * one selected at a time. Each chip is its own address (?status=, ?show=…) or a choice kept in the browser, so this is
 * a navigation of links with aria-current, not an ARIA tablist. Chips show no counts.
 */
export function FilterChips({ label, addFilter, className, children, ...props }: FilterChipsProps) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <nav aria-label={label} className="min-w-0" {...props}>
        <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0">{children}</ul>
      </nav>
      {addFilter}
    </div>
  );
}

export interface FilterChipProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  selected?: boolean;
  /** Render the child element (a Next.js Link, or a button for a choice kept in the browser) with the chip's styles. */
  asChild?: boolean;
  /**
   * A chip the person added gets a separate 44px × button after its name; its accessible name says which, e.g.
   * "Remove filter: Lincoln SD". Never on built-in chips such as All.
   */
  remove?: { label: string; onRemove: () => void };
}

const PILL =
  "flex h-11 items-center rounded-full border-[1.5px] bg-surface text-body-lg text-ink transition-colors duration-[var(--duration-fast)]";
const TARGET =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * One 44px chip (D91). Selected: an ink border, a check and bold text, and aria-current, so it never relies on colour
 * alone; the others have a hairline border and turn canvas grey on hover.
 */
export function FilterChip({
  selected = false,
  asChild = false,
  remove,
  className,
  children,
  ...props
}: FilterChipProps) {
  const Comp = asChild ? Slot : "a";
  return (
    <li
      className={cn(
        PILL,
        selected ? "border-ink font-bold" : "border-line-strong font-semibold hover:bg-canvas",
        className,
      )}
    >
      <Comp
        aria-current={selected ? "true" : undefined}
        className={cn(
          // h-11 with -my over the pill's 1.5px border: the target is the full 44px, not the 41px inside it (D91).
          "-my-[1.5px] flex h-11 items-center gap-1.5 rounded-full whitespace-nowrap no-underline",
          remove ? "pr-1 pl-4" : "px-4",
          TARGET,
        )}
        {...props}
      >
        {selected ? <Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={3} /> : null}
        <Slottable>{children}</Slottable>
      </Comp>
      {remove ? (
        <button
          type="button"
          aria-label={remove.label}
          onClick={remove.onRemove}
          className={cn(
            "-my-[1.5px] -mr-px grid size-11 shrink-0 place-items-center rounded-full text-muted hover:text-ink",
            TARGET,
          )}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  );
}

/** The dashed "+ Add filter" pill's classes, for menus that render their own trigger button (e.g. a popover). */
export const addFilterTriggerClass = cn(
  "inline-flex h-11 items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-line-strong bg-transparent px-4",
  "text-body-lg font-semibold whitespace-nowrap text-ink hover:bg-canvas [&_svg]:size-4 [&_svg]:shrink-0",
  TARGET,
);

/** The dashed pill's content: a plus and its words. */
export function AddFilterLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <Plus aria-hidden="true" strokeWidth={2.5} />
      {children}
    </>
  );
}

export type AddFilterTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** The dashed "+ Add filter" pill as a button of its own, after a list's chips. */
export const AddFilterTrigger = forwardRef<HTMLButtonElement, AddFilterTriggerProps>(
  function AddFilterTrigger({ className, children, type = "button", ...props }, ref) {
    return (
      <button ref={ref} type={type} className={cn(addFilterTriggerClass, className)} {...props}>
        <AddFilterLabel>{children}</AddFilterLabel>
      </button>
    );
  },
);
