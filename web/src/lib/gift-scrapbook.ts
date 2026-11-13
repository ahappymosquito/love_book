// Pure, deterministic scrapbook decoration for the main timeline and gift cards: per-event card tilt (never beyond ±1.2deg so text stays readable), washi-tape strips, corner stickers, and per-month paper patterns derived from stable ids.

export type ScrapbookTone = "rose" | "peach" | "sage" | "cream";
export type StickerKind = "heart" | "star" | "flower";
export type PaperPattern = "dots" | "grid" | "lines";

export const MAX_CARD_TILT_DEG = 1.2;

export function scrapbookHash(value: number | string, salt = 0): number {
  const text = `${value}:${salt}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function cardTilt(id: number): number {
  const steps = Math.round(MAX_CARD_TILT_DEG * 10);
  const raw = (scrapbookHash(id, 1) % (steps * 2 + 1)) - steps;
  return raw / 10;
}

export interface WashiTape {
  tone: ScrapbookTone;
  side: "left" | "center" | "right";
  angle: number;
}

const TONES: ScrapbookTone[] = ["rose", "peach", "sage", "cream"];

export function washiFor(id: number): WashiTape {
  const hash = scrapbookHash(id, 2);
  const sides: WashiTape["side"][] = ["left", "center", "right"];
  return {
    tone: TONES[hash % TONES.length],
    side: sides[(hash >>> 3) % sides.length],
    angle: ((hash >>> 6) % 13) - 6,
  };
}

export interface Sticker {
  kind: StickerKind;
  corner: "top-right" | "bottom-right" | "bottom-left";
  rotate: number;
  tone: ScrapbookTone;
}

export function stickerFor(id: number): Sticker | null {
  const hash = scrapbookHash(id, 3);
  if (hash % 100 < 45) return null;
  const kinds: StickerKind[] = ["heart", "star", "flower"];
  const corners: Sticker["corner"][] = ["top-right", "bottom-right", "bottom-left"];
  return {
    kind: kinds[(hash >>> 4) % kinds.length],
    corner: corners[(hash >>> 7) % corners.length],
    rotate: ((hash >>> 10) % 31) - 15,
    tone: TONES[(hash >>> 13) % 3],
  };
}

export function paperPatternFor(monthKey: string): PaperPattern {
  const patterns: PaperPattern[] = ["dots", "grid", "lines"];
  return patterns[scrapbookHash(monthKey, 4) % patterns.length];
}

export function monthTabLabel(monthKey: string): { year: string; month: string } {
  const [year, month] = monthKey.split("-");
  return { year, month: `${Number(month)} 月` };
}
