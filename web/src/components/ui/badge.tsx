"use client";

// Shared badge primitive for compact semantic labels, filters, states, and confidence markers.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-rose/14 text-rose-deep",
      muted: "bg-peach/22 text-ink-soft",
      outline: "border border-line/80 bg-surface-raised/85 text-ink-soft",
      success: "bg-sage/18 text-ink-soft dark:text-sage",
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
