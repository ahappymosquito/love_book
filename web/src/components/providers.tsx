"use client";

// Client providers hydrate auth state and mount shared reduced-motion, create-window, navigation, and toast surfaces.

import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/bottom-nav";
import { CreateEventWindow } from "@/components/create-event-window";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import { useAppStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const hydrate = useAppStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <MotionConfig reducedMotion="user" transition={MOTION_TRANSITIONS.state}>
      {children}
      <CreateEventWindow />
      <BottomNav />
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          style: {
            fontFamily: "var(--font-inter), var(--font-noto-sc), sans-serif",
            borderRadius: "1rem",
          },
        }}
      />
    </MotionConfig>
  );
}
