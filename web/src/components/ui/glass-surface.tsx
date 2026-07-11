"use client";

// Shared Liquid Glass control-layer primitive with restrained variants, shape control, and interaction feedback across navigation, toolbars, and transient surfaces.

import * as React from "react";
import { cn } from "@/lib/cn";

export type GlassSurfaceVariant = "regular" | "clear" | "prominent";
export type GlassSurfaceShape = "panel" | "capsule" | "circle";

export interface GlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: GlassSurfaceVariant;
  shape?: GlassSurfaceShape;
  interactive?: boolean;
}

export const GlassSurface = React.forwardRef<HTMLDivElement, GlassSurfaceProps>(
  ({ className, variant = "regular", shape = "panel", interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      data-glass={variant}
      data-interactive={interactive ? "true" : undefined}
      className={cn(
        "glass-surface",
        variant === "clear" && "glass-clear",
        variant === "prominent" && "glass-prominent",
        shape === "capsule" && "glass-capsule",
        shape === "circle" && "glass-circle",
        interactive && "glass-interactive",
        className,
      )}
      {...props}
    />
  ),
);

GlassSurface.displayName = "GlassSurface";
