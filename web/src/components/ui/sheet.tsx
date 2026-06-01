"use client";

// Radix Dialog based sheet for warm mobile and side panels with accessible close controls.

import * as Dialog from "@radix-ui/react-dialog";
import type React from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

export function SheetContent({
  children,
  className,
  side = "bottom",
}: {
  children: React.ReactNode;
  className?: string;
  side?: "bottom" | "right";
}) {
  return (
    <Dialog.Portal forceMount>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
      <Dialog.Content asChild>
        <motion.div
          initial={{ opacity: 0, y: side === "bottom" ? 32 : 0, x: side === "right" ? 32 : 0 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, y: side === "bottom" ? 24 : 0, x: side === "right" ? 24 : 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "fixed z-50 bg-surface-raised text-ink shadow-glow outline-none hairline",
            side === "bottom"
              ? "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)]"
              : "right-0 top-0 h-dvh w-full max-w-md rounded-none p-5",
            className,
          )}
        >
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" className="absolute right-4 top-4 rounded-full" aria-label="关闭详情">
              <X className="h-4 w-4" />
            </Button>
          </Dialog.Close>
          {children}
        </motion.div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetBody({ open, children }: { open: boolean; children: React.ReactNode }) {
  return <AnimatePresence>{open ? children : null}</AnimatePresence>;
}

export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;
