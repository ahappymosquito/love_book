"use client";

// Live gift open-time clock: a hook that re-renders on a cadence that speeds up as the earliest open time approaches, and a small hourglass pill for wrapped gifts.

import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/cn";
import { giftCountdown, giftCountdownTickMs } from "@/lib/gift-state";

export function useGiftClock(openAt: string | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!openAt) return;
    const countdown = giftCountdown(openAt, now);
    if (!countdown) return;
    const timer = window.setTimeout(() => setNow(Date.now()), giftCountdownTickMs(countdown.remainingMs));
    return () => window.clearTimeout(timer);
  }, [now, openAt]);

  return now;
}

export function GiftCountdownPill({ openAt, now, className }: { openAt: string | null; now: number; className?: string }) {
  const countdown = giftCountdown(openAt, now);
  if (!countdown) return null;
  return (
    <span className={cn("gift-countdown-pill", className)} title={openAt ? new Date(openAt).toLocaleString("zh-CN") : undefined}>
      <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
      {countdown.label}
    </span>
  );
}
