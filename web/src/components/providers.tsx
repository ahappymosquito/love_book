"use client";

// Client providers hydrate persisted auth state, render global toasts, and mount authenticated bottom navigation.

import { useEffect } from "react";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/bottom-nav";
import { useAppStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const hydrate = useAppStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <>
      {children}
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
    </>
  );
}
