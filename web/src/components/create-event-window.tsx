"use client";

// Global create Sheet that opens the memory / meeting / 送一份礼物 chooser after the bottom navigation lens gathers into the center action.
// 选择一步是按内容高度的紧凑窗口（手机底部弹出，sm 以上居中），选好类型后再放宽成表单窗口。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { CreateFlow } from "@/components/create-flow";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
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
  const [step, setStep] = useState<"choose" | "form">("choose");

  useEffect(() => {
    if (open) setStep("choose");
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetBody open={open}>
        <SheetContent
          closeLabel="关闭创建窗口"
          motionPreset="full-rise"
          reducedMotion={reducedMotion}
          className={cn(
            "create-event-window overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.1rem)] pt-5 sm:px-6 sm:pt-6",
            step === "choose" && "is-choosing",
          )}
        >
          <SheetTitle className="sr-only">记一笔</SheetTitle>
          <SheetDescription className="sr-only">选择并创建一条新的共同记录。</SheetDescription>
          {open && (
            <CreateFlow
              onStepChange={setStep}
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
