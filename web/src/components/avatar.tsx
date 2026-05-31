"use client";

// Shared avatar renderer that loads private uploaded avatar images and falls back to emoji or the name initial.

import { useEffect, useState } from "react";
import { fetchAvatarBlob } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { UserOut } from "@/lib/types";

interface AvatarProps {
  user?: Pick<UserOut, "id" | "display_name" | "avatar" | "avatar_has_image" | "avatar_updated_at"> | null;
  userId?: number | null;
  avatarHasImage?: boolean | null;
  avatarUpdatedAt?: string | null;
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

export function Avatar({
  user,
  userId,
  avatarHasImage,
  avatarUpdatedAt,
  emoji,
  name,
  size = "md",
  className,
}: AvatarProps) {
  const resolvedId = user?.id ?? userId ?? null;
  const resolvedName = user?.display_name ?? name ?? null;
  const resolvedEmoji = user?.avatar ?? emoji ?? null;
  const resolvedHasImage = user?.avatar_has_image ?? avatarHasImage ?? false;
  const resolvedUpdatedAt = user?.avatar_updated_at ?? avatarUpdatedAt ?? null;
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextUrl: string | null = null;
    setImageUrl(null);
    if (!resolvedId || !resolvedHasImage) return;
    fetchAvatarBlob(resolvedId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        nextUrl = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      });
    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [resolvedId, resolvedHasImage, resolvedUpdatedAt]);

  const initial = (resolvedName || "路").trim().slice(0, 1).toUpperCase();
  const display = resolvedEmoji && resolvedEmoji.trim().length > 0 ? resolvedEmoji : initial;
  return (
    <div
      className={cn(
        "rounded-full grid place-items-center select-none flex-none overflow-hidden",
        "bg-gradient-to-br from-peach/40 via-rose-soft/60 to-rose/30",
        "ring-1 ring-rose/15",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_4px_14px_-6px_rgba(183,110,121,0.45)]",
        sizeMap[size],
        className,
      )}
      aria-label={resolvedName ?? undefined}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          decoding="async"
        />
      ) : (
        <span className="font-display leading-none">{display}</span>
      )}
    </div>
  );
}
