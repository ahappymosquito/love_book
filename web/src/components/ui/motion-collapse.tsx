"use client";

// Shared accessible disclosure presence that animates local grid rows and opacity while honoring reduced motion.

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { MOTION_TRANSITIONS } from "@/lib/motion";

export function MotionCollapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={reducedMotion ? { opacity: 0 } : { gridTemplateRows: "0fr", opacity: 0 }}
          animate={{ gridTemplateRows: "1fr", opacity: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { gridTemplateRows: "0fr", opacity: 0 }}
          transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
          className={cn("grid", className)}
        >
          <div className="min-h-0 overflow-hidden">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
