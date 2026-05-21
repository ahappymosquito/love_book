// Shared TypeScript contracts for API payloads, user state, events, pair tokens, and home reminders.

export type VisibilityMode = "public" | "mutual_submit";

export interface UserOut {
  id: number;
  display_name: string;
  avatar: string;
  email: string | null;
  created_at: string;
}

export interface MeOut {
  user: UserOut;
  counterpart: UserOut;
  pair_id: number;
  love_started_on: string;
}

export interface SubmissionState {
  current_user_submitted: boolean;
  counterpart_submitted: boolean;
  unlocked: boolean;
}

export interface EventSummary {
  id: number;
  pair_id: number;
  creator_id: number;
  title: string;
  description: string | null;
  occurred_at: string | null;
  visibility_mode: VisibilityMode;
  created_at: string;
  submission_state: SubmissionState;
}

export interface CommentOut {
  type: "comment";
  id: number;
  event_id: number;
  author_id: number;
  text: string;
  created_at: string;
}

export interface VoiceOut {
  type: "voice";
  id: number;
  event_id: number;
  author_id: number;
  duration_ms: number | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface ImageOut {
  type: "image";
  id: number;
  event_id: number;
  author_id: number;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface ContentsOut {
  submission_state: SubmissionState;
  comments: CommentOut[];
  voices: VoiceOut[];
  images: ImageOut[];
}

export interface EventDetail extends EventSummary {
  contents: ContentsOut;
}

export interface PairCreated {
  pair_id: number;
  user_a: UserOut;
  user_b: UserOut;
  love_started_on: string;
  user_a_token: string;
  user_b_token: string;
  user_a_token_expires_at: string | null;
  user_b_token_expires_at: string | null;
}

export interface PairOut extends PairCreated {
  created_at: string;
}

export type ContentItem =
  | (CommentOut & { _kind: "comment" })
  | (VoiceOut & { _kind: "voice" })
  | (ImageOut & { _kind: "image" });

export interface LoginLogOut {
  id: number;
  user_id: number;
  user: UserOut | null;
  ip: string | null;
  user_agent: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  locale: string | null;
  timezone_name: string | null;
  screen: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  created_at: string;
}

export interface LoginRecordCreate {
  user_agent?: string | null;
  locale?: string | null;
  timezone_name?: string | null;
  screen?: string | null;
}

export interface ReminderItem {
  type: "anniversary" | "love_festival" | "holiday" | "workday";
  label: string;
  message: string | null;
}

export interface AnniversaryOut {
  love_started_on: string;
  today: string;
  days_together: number;
  anniversary_items: ReminderItem[];
  love_festival_items: ReminderItem[];
  holiday_items: ReminderItem[];
  message: string;
  message_source: "anniversary" | "love_festival" | "holiday" | "hitokoto" | "local";
}

export const AVATAR_PRESETS = [
  "🐶",
  "🐱",
  "🐰",
  "🦊",
  "🐼",
  "🐯",
  "🐻",
  "🌸",
  "🌷",
  "🌙",
  "⭐",
  "💗",
] as const;
