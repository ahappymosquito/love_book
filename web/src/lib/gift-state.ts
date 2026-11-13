// Pure gift helpers: wrapping-paper vocabulary, viewer-relative gift phase derivation (legacy gift_received reads as an opened gift the creator received), open-time countdown copy, and a seeded, capped confetti layout for the unwrap moment.

import type { EventSummary, GiftWrapStyle } from "@/lib/types";

export const GIFT_WRAP_STYLES: Array<{ value: GiftWrapStyle; label: string; hint: string }> = [
  { value: "rose", label: "玫瑰波点", hint: "温柔的小波点" },
  { value: "peach", label: "蜜桃格纹", hint: "暖暖的格子布" },
  { value: "sage", label: "鼠尾草叶", hint: "安安静静的小叶子" },
  { value: "cream", label: "奶油条纹", hint: "像一封手写信" },
  { value: "starry", label: "星夜", hint: "藏着小星星" },
];

export const DEFAULT_GIFT_WRAP_STYLE: GiftWrapStyle = "rose";

export function giftWrapStyleOf(value: string | null | undefined): GiftWrapStyle {
  return GIFT_WRAP_STYLES.some((style) => style.value === value) ? (value as GiftWrapStyle) : DEFAULT_GIFT_WRAP_STYLE;
}

export function isGiftEvent(event: Pick<EventSummary, "event_kind">): boolean {
  return event.event_kind === "gift" || event.event_kind === "gift_received";
}

export type GiftPhase = "sealed" | "ready" | "waiting" | "opened";

export interface GiftView {
  legacy: boolean;
  role: "sender" | "receiver";
  senderId: number | null;
  receiverId: number | null;
  phase: GiftPhase;
  wrapStyle: GiftWrapStyle;
  masked: boolean;
  canOpen: boolean;
  canRespond: boolean;
  hasResponse: boolean;
  feedback: string | null;
}

type GiftFields = Pick<
  EventSummary,
  | "event_kind"
  | "creator_id"
  | "description"
  | "gift_state"
  | "gift_receiver_id"
  | "gift_wrap_style"
  | "gift_open_at"
  | "gift_feedback"
  | "gift_responded_at"
  | "gift_masked"
  | "gift_can_open"
  | "gift_feelings"
  | "gift_rating"
>;

export function deriveGiftView(event: GiftFields, viewerId: number, now: number = Date.now()): GiftView {
  if (event.event_kind === "gift_received") {
    const hasResponse = event.gift_feelings.length > 0 || event.gift_rating !== null || Boolean(event.description);
    return {
      legacy: true,
      role: event.creator_id === viewerId ? "receiver" : "sender",
      senderId: null,
      receiverId: event.creator_id,
      phase: "opened",
      wrapStyle: giftWrapStyleOf(event.gift_wrap_style ?? "peach"),
      masked: false,
      canOpen: false,
      canRespond: false,
      hasResponse,
      feedback: event.description,
    };
  }

  const receiverId = event.gift_receiver_id;
  const role = event.creator_id === viewerId && receiverId !== viewerId ? "sender" : "receiver";
  const wrapped = event.gift_state !== "opened";
  const openAtPassed = !event.gift_open_at || new Date(event.gift_open_at).getTime() <= now;
  const canOpen = wrapped && role === "receiver" && (event.gift_can_open || openAtPassed);
  const phase: GiftPhase = !wrapped ? "opened" : role === "sender" ? "waiting" : canOpen ? "ready" : "sealed";
  const hasResponse = Boolean(event.gift_responded_at);

  return {
    legacy: false,
    role,
    senderId: event.creator_id,
    receiverId,
    phase,
    wrapStyle: giftWrapStyleOf(event.gift_wrap_style),
    masked: event.gift_masked,
    canOpen,
    canRespond: !wrapped && role === "receiver",
    hasResponse,
    feedback: event.gift_feedback,
  };
}

export interface GiftCountdown {
  remainingMs: number;
  label: string;
  short: string;
}

export function giftCountdown(openAt: string | null | undefined, now: number = Date.now()): GiftCountdown | null {
  if (!openAt) return null;
  const target = new Date(openAt).getTime();
  if (Number.isNaN(target)) return null;
  const remainingMs = target - now;
  if (remainingMs <= 0) return null;

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    const label = hours > 0 ? `还要 ${days} 天 ${hours} 小时` : `还要 ${days} 天`;
    return { remainingMs, label, short: `${days} 天后` };
  }
  if (hours > 0) {
    const label = minutes > 0 ? `还要 ${hours} 小时 ${minutes} 分` : `还要 ${hours} 小时`;
    return { remainingMs, label, short: `${hours} 小时后` };
  }
  if (totalMinutes > 1) return { remainingMs, label: `还要 ${totalMinutes} 分钟`, short: `${totalMinutes} 分钟后` };
  return { remainingMs, label: "马上就能拆了", short: "马上" };
}

export function giftCountdownTickMs(remainingMs: number): number {
  if (remainingMs > 2 * 3_600_000) return 60_000;
  if (remainingMs > 120_000) return 20_000;
  return 1_000;
}

export interface ConfettiParticle {
  id: number;
  x: number;
  y: number;
  rotate: number;
  delay: number;
  size: number;
  shape: "petal" | "dot" | "heart";
  tone: "rose" | "peach" | "sage" | "cream";
}

export const CONFETTI_MAX = 40;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function confettiParticles(count: number, seed: number, reducedMotion = false): ConfettiParticle[] {
  if (reducedMotion) return [];
  const total = Math.max(0, Math.min(CONFETTI_MAX, Math.floor(count)));
  const random = mulberry32(seed);
  const shapes: ConfettiParticle["shape"][] = ["petal", "dot", "heart"];
  const tones: ConfettiParticle["tone"][] = ["rose", "peach", "sage", "cream"];
  return Array.from({ length: total }, (_, id) => {
    const angle = (id / Math.max(total, 1)) * Math.PI * 2 + random() * 0.4;
    const distance = 90 + random() * 130;
    return {
      id,
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance * 0.8 - 60 - random() * 60),
      rotate: Math.round(random() * 360 - 180),
      delay: Math.round(random() * 120) / 1000,
      size: 6 + Math.round(random() * 6),
      shape: shapes[Math.floor(random() * shapes.length)],
      tone: tones[Math.floor(random() * tones.length)],
    };
  });
}
