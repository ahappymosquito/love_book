"use client";

import { motion } from "framer-motion";

const variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.22 } },
};

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.main
      key="page"
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-dvh w-full"
    >
      {children}
    </motion.main>
  );
}
