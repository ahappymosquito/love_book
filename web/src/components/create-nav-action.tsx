"use client";

// Compact rose create action that receives the shared lens with unified press timing before opening the global create window.

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { MOTION_TRANSITIONS } from "@/lib/motion";

export function CreateNavAction({
  active,
  gathering,
  reducedMotion,
  onOpen,
}: {
  active: boolean;
  gathering: boolean;
  reducedMotion: boolean | null;
  onOpen: () => void;
}) {
  const showLens = active || gathering;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative isolate mx-auto grid h-[52px] w-[76px] place-items-center rounded-full focus-ring",
        active ? "scale-[1.03]" : "hover:scale-[1.03]",
      )}
      aria-label="记一笔"
      aria-current={active ? "page" : undefined}
    >
      <AnimatePresence initial={false}>
        {showLens && (
          <motion.span
            layoutId="bottom-nav-liquid-lens"
            className="liquid-nav-lens liquid-nav-lens-create"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
      <motion.span
        className="relative z-10 grid h-[42px] w-[64px] place-items-center rounded-full bg-rose text-white shadow-soft"
        whileHover={reducedMotion ? undefined : { scale: 1.03 }}
        whileTap={reducedMotion ? undefined : { scale: 0.94 }}
        transition={MOTION_TRANSITIONS.fast}
        aria-hidden="true"
      >
        <Plus className="h-7 w-7 stroke-[3.25]" />
      </motion.span>
    </button>
  );
}
