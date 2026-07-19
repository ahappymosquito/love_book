// Shared positive and honest mood labels plus progress helpers for love-receipt surfaces.

import type { LoveReceiptMood, LoveReceiptStatus, LoveReceiptType } from "./types";

export const LOVE_RECEIPT_TYPE_OPTIONS: Array<{ value: LoveReceiptType; label: string; emoji: string }> = [
  { value: "gift", label: "礼物", emoji: "🎁" },
  { value: "takeout", label: "外卖", emoji: "🥡" },
  { value: "flower", label: "鲜花", emoji: "💐" },
  { value: "drink", label: "奶茶咖啡", emoji: "🥤" },
  { value: "experience", label: "体验", emoji: "🎟️" },
  { value: "custom", label: "自定义心意", emoji: "💌" },
];

export const LOVE_RECEIPT_MOOD_OPTIONS: Array<{ value: LoveReceiptMood; label: string; emoji: string }> = [
  { value: "happy", label: "开心", emoji: "😊" },
  { value: "surprised", label: "惊喜", emoji: "✨" },
  { value: "touched", label: "感动", emoji: "🥹" },
  { value: "reassured", label: "安心", emoji: "🌿" },
  { value: "cherished", label: "被宠爱", emoji: "💕" },
  { value: "hug", label: "想抱抱", emoji: "🫂" },
  { value: "disappointed", label: "有点失望", emoji: "😕" },
  { value: "wronged", label: "有点委屈", emoji: "🥺" },
  { value: "pressured", label: "有压力", emoji: "😮‍💨" },
  { value: "not_my_style", label: "不太合心意", emoji: "🙈" },
  { value: "upset", label: "有点生气", emoji: "😣" },
  { value: "complicated", label: "心情复杂", emoji: "🫤" },
];

export const LOVE_RECEIPT_STATUS_LABELS: Record<LoveReceiptStatus, string> = {
  created: "已经记下",
  delivering: "正在送去",
  delivered: "已经送达",
  waiting_receipt: "待你回执",
  completed: "已经接住",
};

export const QUICK_RECEIPT_MESSAGES = [
  "收到啦，今天也被你好好照顾了",
  "你的心意安全抵达",
  "谢谢你一直记得我的小事",
  "今天又被你宠到啦",
  "已签收，附赠一个大大的拥抱",
];

export function loveReceiptTypeMeta(type: LoveReceiptType) {
  return LOVE_RECEIPT_TYPE_OPTIONS.find((option) => option.value === type) ?? LOVE_RECEIPT_TYPE_OPTIONS[5];
}

export function loveReceiptMoodMeta(mood: LoveReceiptMood | null) {
  return LOVE_RECEIPT_MOOD_OPTIONS.find((option) => option.value === mood) ?? null;
}

export function loveReceiptProgress(status: LoveReceiptStatus): number {
  return { created: 0, delivering: 1, delivered: 2, waiting_receipt: 2, completed: 3 }[status];
}
