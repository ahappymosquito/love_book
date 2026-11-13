"use client";

// Scrapbook decoration primitives for the main timeline: journal cards with a tiny deterministic tilt, washi-tape strips, inline-SVG heart/star/flower stickers, and a polaroid photo frame; all placement comes from deterministic helpers in gift-scrapbook.ts and none of them use backdrop-filter.

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { cardTilt, stickerFor, washiFor } from "@/lib/gift-scrapbook";
import type { Sticker, StickerKind, ScrapbookTone, WashiTape } from "@/lib/gift-scrapbook";

export function WashiTapeStrip({ tape, className }: { tape: WashiTape; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("scrapbook-washi", `scrapbook-washi-${tape.tone}`, `scrapbook-washi-${tape.side}`, className)}
      style={{ "--washi-angle": `${tape.angle}deg` } as CSSProperties}
    />
  );
}

export function StickerGlyph({ kind, tone, className }: { kind: StickerKind; tone: ScrapbookTone; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("scrapbook-sticker-glyph", `scrapbook-tone-${tone}`, className)}>
      {kind === "heart" && (
        <path d="M16 27.5C9 22.6 4 18.2 4 12.4 4 8.6 6.9 6 10.3 6c2.4 0 4.4 1.3 5.7 3.3C17.3 7.3 19.3 6 21.7 6 25.1 6 28 8.6 28 12.4c0 5.8-5 10.2-12 15.1Z" />
      )}
      {kind === "star" && (
        <path d="m16 3.8 3.5 7.6 8.3.9-6.2 5.6 1.8 8.2L16 21.9 8.6 26.1l1.8-8.2-6.2-5.6 8.3-.9Z" strokeLinejoin="round" />
      )}
      {kind === "flower" && (
        <>
          <circle cx="16" cy="8.5" r="5.2" />
          <circle cx="23.5" cy="14" r="5.2" />
          <circle cx="20.6" cy="22.8" r="5.2" />
          <circle cx="11.4" cy="22.8" r="5.2" />
          <circle cx="8.5" cy="14" r="5.2" />
          <circle cx="16" cy="16.3" r="3.6" className="scrapbook-sticker-center" />
        </>
      )}
    </svg>
  );
}

export function ScrapbookSticker({ sticker }: { sticker: Sticker }) {
  return (
    <span
      aria-hidden="true"
      className={cn("scrapbook-sticker", `scrapbook-sticker-${sticker.corner}`)}
      style={{ "--sticker-rotate": `${sticker.rotate}deg` } as CSSProperties}
    >
      <StickerGlyph kind={sticker.kind} tone={sticker.tone} />
    </span>
  );
}

export function ScrapbookCard({
  id,
  tone = "memory",
  children,
  className,
}: {
  id: number;
  tone?: "memory" | "meeting" | "gift";
  children: ReactNode;
  className?: string;
}) {
  const sticker = stickerFor(id);
  return (
    <article
      className={cn("scrapbook-card", `scrapbook-card-${tone}`, className)}
      style={{ "--card-tilt": `${cardTilt(id)}deg` } as CSSProperties}
    >
      <WashiTapeStrip tape={washiFor(id)} />
      {sticker && <ScrapbookSticker sticker={sticker} />}
      <div className="relative min-w-0">{children}</div>
    </article>
  );
}

export function PolaroidFrame({
  children,
  caption,
  tilt = 0,
  className,
}: {
  children: ReactNode;
  caption?: ReactNode;
  tilt?: number;
  className?: string;
}) {
  return (
    <figure className={cn("scrapbook-polaroid", className)} style={{ "--polaroid-tilt": `${tilt}deg` } as CSSProperties}>
      <div className="scrapbook-polaroid-photo">{children}</div>
      {caption ? <figcaption className="scrapbook-polaroid-caption">{caption}</figcaption> : null}
    </figure>
  );
}
