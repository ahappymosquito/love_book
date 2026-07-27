"use client";

// Global create Sheet that opens a three-type chooser after the bottom navigation lens gathers into the center action.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { CreateFlow } from "@/components/create-flow";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAppStore } from "@/lib/store";

export function CreateEventWindow() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const phase = useAppStore((s) => s.createWindowPhase);
  const finishOpening = useAppStore((s) => s.finishCreateWindowOpening);
  const close = useAppStore((s) => s.closeCreateWindow);

  useEffect(() => {
    if (phase !== "gathering") return;
    if (reducedMotion) {
      finishOpening();
      return;
    }
    const timer = window.setTimeout(finishOpening, 220);
    return () => window.clearTimeout(timer);
  }, [finishOpening, phase, reducedMotion]);

  const open = phase === "open";

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetBody open={open}>
        <SheetContent
          closeLabel="关闭创建窗口"
          motionPreset="full-rise"
          reducedMotion={reducedMotion}
          className="create-event-window overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.35rem)] pt-6 sm:px-7 sm:pt-7"
        >
          <SheetTitle className="sr-only">记一笔</SheetTitle>
          <SheetDescription className="sr-only">选择并创建一条新的共同记录。</SheetDescription>
          {open && (
            <CreateFlow
              onCreated={(event) => {
                close();
                router.push(`/timeline/${event.id}`);
              }}
            />
          )}
        </SheetContent>
      </SheetBody>
    </Sheet>
  );
}
