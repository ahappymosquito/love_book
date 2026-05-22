"use client";

// shadcn/ui-style badge primitive for compact cycle phase, filter, and confidence labels.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-rose/12 text-rose-deep",
      muted: "bg-cream-deep/70 text-ink-soft",
      outline: "border border-line/70 bg-surface-raised/60 text-ink-soft",
      success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
