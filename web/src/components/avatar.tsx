"use client";

import { cn } from "@/lib/cn";

interface AvatarProps {
  emoji?: string | null;
  name?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = {
  xs: "h-6 w-6 text-[14px]",
  sm: "h-8 w-8 text-[18px]",
  md: "h-10 w-10 text-[22px]",
  lg: "h-14 w-14 text-[30px]",
  xl: "h-20 w-20 text-[44px]",
};

export function Avatar({ emoji, name, size = "md", className }: AvatarProps) {
  const initial = (name || "·").trim().slice(0, 1).toUpperCase();
  const display = emoji && emoji.trim().length > 0 ? emoji : initial;
  return (
    <div
      className={cn(
        "rounded-full grid place-items-center select-none flex-none",
        "bg-gradient-to-br from-peach/40 via-rose-soft/60 to-rose/30",
        "ring-1 ring-rose/15",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_4px_14px_-6px_rgba(183,110,121,0.45)]",
        sizeMap[size],
        className,
      )}
      aria-label={name ?? undefined}
    >
      <span className="font-display leading-none">{display}</span>
    </div>
  );
}
