// Shared TypeScript contracts for API payloads, avatar-aware user state, events, comment reactions, todo boards, admin AI config, cycles, and reminders.

export type VisibilityMode = "public" | "mutual_submit";
export type TodoCategory = "food" | "play";
export type TodoParseStatus = "pending" | "resolved" | "failed";
export type AIProtocol = "openai" | "anthropic";

export interface UserOut {
  id: number;
  display_name: string;
  avatar: string;
  avatar_has_image: boolean;
  avatar_updated_at: string | null;
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

export type CommentReactionType = "like" | "dislike";

export interface CommentReactionSummary {
  reaction_type: CommentReactionType;
  count: number;
  reacted_by_me: boolean;
}

export interface CommentOut {
  type: "comment";
  id: number;
  event_id: number;
  author_id: number;
  text: string;
  created_at: string;
  reactions: CommentReactionSummary[];
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
  message_source: "anniversary" | "love_festival" | "holiday" | "local";
}

export interface QuoteOut {
  id: number;
  pair_id: number;
  author_id: number;
  text: string;
  created_at: string;
}

export type CyclePhase =
  | "menstrual"
  | "predicted_period"
  | "follicular"
  | "fertile"
  | "ovulation"
  | "luteal"
  | "unknown";

export type CycleFlow = "none" | "spotting" | "light" | "medium" | "heavy";
export type CycleMood = "happy" | "calm" | "anxious" | "sad" | "tired";
export type CervicalMucus = "none" | "dry" | "moist" | "creamy" | "eggwhite";

export interface DailyLog {
  date: string;
  phase: CyclePhase;
  is_period: boolean;
  is_predicted: boolean;
  flow: CycleFlow | null;
  symptoms: string[];
  mood: CycleMood | null;
  bbt: number | null;
  cervical_mucus: CervicalMucus | null;
  note: string | null;
  updated_by_id: number | null;
  updated_at: string | null;
  source: "recorded" | "predicted";
}

export interface DailyLogInput {
  phase: CyclePhase;
  is_period: boolean;
  is_predicted?: boolean;
  flow?: CycleFlow | null;
  symptoms?: string[];
  mood?: CycleMood | null;
  bbt?: number | null;
  cervical_mucus?: CervicalMucus | null;
  note?: string | null;
}

export interface CycleStats {
  current_cycle_day: number;
  current_phase: CyclePhase;
  average_cycle_length: number;
  average_period_length: number;
  last_period_start: string;
  next_period_start: string;
  next_period_end: string;
  ovulation_date: string;
  fertile_start: string;
  fertile_end: string;
  confidence: "high" | "medium" | "low";
  prediction_start: string;
  prediction_end: string;
  cycle_variation_days: number;
}

export interface CycleDashboardOut {
  logs: DailyLog[];
  stats: CycleStats;
  is_empty: boolean;
}

export interface TodoRestaurantOut {
  id: number;
  item_id: number;
  amap_poi_id: string | null;
  name: string;
  address: string | null;
  location: string | null;
  city: string | null;
  poi_type: string | null;
  tel: string | null;
  business_area: string | null;
  signature_dishes: string | null;
  per_capita: number | null;
  parse_status: TodoParseStatus;
  parse_error: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface TodoScheduleOut {
  id: number;
  item_id: number;
  scheduled_on: string;
  created_by_id: number;
  created_at: string;
}

export interface TodoItemOut {
  id: number;
  pair_id: number;
  creator_id: number;
  category: TodoCategory;
  title: string;
  note: string | null;
  is_archived: boolean;
  restaurant: TodoRestaurantOut | null;
  schedules: TodoScheduleOut[];
  comments_count: number;
  images_count: number;
  checked_in: boolean;
  created_at: string;
  updated_at: string;
}

export interface TodoDashboardOut {
  month: string;
  items: TodoItemOut[];
  schedules: TodoScheduleOut[];
}

export interface TodoRestaurantCandidate {
  amap_poi_id: string | null;
  name: string;
  address: string | null;
  location: string | null;
  city: string | null;
  poi_type: string | null;
  tel: string | null;
  business_area: string | null;
  raw: Record<string, unknown> | null;
}

export interface TodoCommentOut {
  id: number;
  item_id: number;
  author_id: number;
  text: string;
  created_at: string;
}

export interface TodoImageOut {
  id: number;
  item_id: number;
  author_id: number;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface TodoItemDetail extends TodoItemOut {
  comments: TodoCommentOut[];
  images: TodoImageOut[];
}

export interface TodoLotteryOut {
  item: TodoItemOut | null;
  candidate: TodoRestaurantCandidate | null;
}

export interface AdminAIConfigOut {
  protocol: AIProtocol;
  selected_model: string;
  env_model: string;
  openai_base_url: string;
  anthropic_base_url: string;
  api_key: string;
  api_key_preview: string;
  has_api_key: boolean;
  amap_api_key: string;
  amap_key_preview: string;
  has_amap_key: boolean;
  updated_at: string | null;
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
