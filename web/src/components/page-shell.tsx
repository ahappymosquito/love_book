"use client";

// Mobile-safe page shell with restrained state-transition motion and no decorative load choreography.

import { motion } from "framer-motion";

const variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
};

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.main
      key="page"
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="viewport-guard min-h-dvh w-full"
    >
      {children}
    </motion.main>
  );
}
