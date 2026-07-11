"use client";

// Shared accessible Liquid Glass segmented control with a morphing selection lens for compact view and filter switching.

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { GlassSurface } from "@/components/ui/glass-surface";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  layoutId = "shared-segment-lens",
  className,
}: {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  layoutId?: string;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <GlassSurface
      variant="clear"
      shape="capsule"
      className={cn("segmented-control", className)}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn("segmented-control-item focus-ring", selected && "is-selected")}
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                className="segmented-control-lens"
                transition={reducedMotion ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                aria-hidden="true"
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </GlassSurface>
  );
}
