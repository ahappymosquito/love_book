"use client";

// Shared avatar renderer: loads the private uploaded image through useAuthedBlobUrl and falls back to the emoji, then the name initial, when the image is missing, fails to load, or fails to decode.

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { UserOut } from "@/lib/types";
import { useAuthedBlobUrl } from "@/lib/use-authed-blob-url";

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
  const { url: imageUrl } = useAuthedBlobUrl(
    resolvedId && resolvedHasImage ? { kind: "avatar", userId: resolvedId, version: resolvedUpdatedAt } : null,
  );
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const showImage = Boolean(imageUrl) && imageUrl !== brokenUrl;

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
      {showImage && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          decoding="async"
          onError={() => setBrokenUrl(imageUrl)}
        />
      ) : (
        <span className="font-display leading-none">{display}</span>
      )}
    </div>
  );
}
