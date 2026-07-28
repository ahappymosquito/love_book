// Shared received-gift feeling vocabulary and calm positive/complex visual metadata.

import type { GiftFeeling } from "@/lib/types";

export const GIFT_FEELING_OPTIONS: Array<{
  value: GiftFeeling;
  label: string;
  emoji: string;
  tone: "warm" | "complex";
}> = [
  { value: "happy", label: "开心", emoji: "😊", tone: "warm" },
  { value: "surprised", label: "惊喜", emoji: "✨", tone: "warm" },
  { value: "touched", label: "感动", emoji: "🥹", tone: "warm" },
  { value: "reassured", label: "安心", emoji: "🌿", tone: "warm" },
  { value: "cherished", label: "被宠爱", emoji: "💕", tone: "warm" },
  { value: "hug", label: "想抱抱", emoji: "🫂", tone: "warm" },
  { value: "disappointed", label: "有点失望", emoji: "😕", tone: "complex" },
  { value: "wronged", label: "有点委屈", emoji: "🥺", tone: "complex" },
  { value: "pressured", label: "有压力", emoji: "😮‍💨", tone: "complex" },
  { value: "not_my_style", label: "不太合心意", emoji: "🙈", tone: "complex" },
  { value: "upset", label: "有点生气", emoji: "😣", tone: "complex" },
  { value: "complicated", label: "心情复杂", emoji: "🫤", tone: "complex" },
];

export function giftFeelingMeta(value: GiftFeeling) {
  return GIFT_FEELING_OPTIONS.find((option) => option.value === value)!;
}
