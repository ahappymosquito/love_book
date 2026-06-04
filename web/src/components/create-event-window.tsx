"use client";

// Global accessible create window that opens after the bottom navigation liquid lens gathers into the center action.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { CreateEventForm } from "@/components/create-event-form";
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
          className="create-event-window overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-7 sm:px-7"
        >
          <SheetTitle className="sr-only">记一笔</SheetTitle>
          <SheetDescription className="sr-only">创建一条新的共同回忆。</SheetDescription>
          <CreateEventForm
            onCreated={(event) => {
              close();
              router.push(`/timeline/${event.id}`);
            }}
          />
        </SheetContent>
      </SheetBody>
    </Sheet>
  );
}
