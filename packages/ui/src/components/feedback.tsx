import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export const bannerVariants = cva(
  "flex items-start gap-3 rounded-md border border-transparent px-4 py-3",
  {
    variants: {
      tone: {
        info: "bg-info-soft text-info",
        warning: "border-l-4 border-l-warning bg-warning-soft text-warning-text",
        danger: "bg-danger-soft text-danger",
        success: "bg-primary-soft text-primary-hover",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

const ICONS = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: CircleCheck,
} as const;

export interface BannerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof bannerVariants> {
  title: ReactNode;
}

/** Errors are plain: what happened, then what to do. Danger banners announce themselves. */
export function Banner({ tone = "info", title, children, className, ...props }: BannerProps) {
  const Icon = ICONS[tone ?? "info"];
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(bannerVariants({ tone }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-[18px] shrink-0" aria-hidden="true" />
      <div>
        <p className="m-0 font-bold">{title}</p>
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

export function Toast({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md bg-ink px-4 py-3 font-medium text-white shadow-md",
        className,
      )}
      {...props}
    >
      <span className="size-2 rounded-full bg-lime" aria-hidden="true" />
      {children}
    </div>
  );
}
