"use client";

// Shared button primitive for accessible, lively scrapbook UI actions across dashboards, dialogs, and forms.

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-medium transition focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "btn-primary",
        secondary: "bg-peach/25 text-rose-deep hover:bg-peach/35",
        outline: "border border-line/80 bg-surface-raised/90 text-ink hover:border-rose/35 hover:bg-rose/8",
        ghost: "text-ink-soft hover:bg-rose/8 hover:text-rose-deep",
        danger: "bg-red-500/12 text-red-700 hover:bg-red-500/18 dark:text-red-100",
      },
      size: {
        default: "px-4 py-2.5",
        sm: "min-h-9 rounded-xl px-3 py-1.5 text-xs",
        lg: "min-h-12 rounded-2xl px-5 py-3",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
