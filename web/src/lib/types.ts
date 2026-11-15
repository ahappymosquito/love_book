// Shared TypeScript contracts for authentication, runner rankings, timelines (including wrapped gifts the sender seals and the receiver unwraps; legacy gift_received rows read as already-opened gifts), profiles, meetings, quotes, habits, the meeting todo plan (one-tap completion, write into the journal), cycles (prediction dates may be null before the first period record), the cycle mail reminder, and reminders.

export type VisibilityMode = "public" | "mutual_submit";
export type EventKind = "memory" | "offline_meeting" | "gift" | "gift_received";
export type GiftState = "wrapped" | "opened";
export type GiftWrapStyle = "rose" | "peach" | "sage" | "cream" | "starry";
export type GiftFeeling =
  | "happy"
  | "surprised"
  | "touched"
  | "reassured"
  | "cherished"
  | "hug"
  | "disappointed"
  | "wronged"
  | "pressured"
  | "not_my_style"
  | "upset"
  | "complicated";
export type TodoCategory = "food" | "play" | "stay" | "prep" | "wish";

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

export interface MeetingSessionLite {
  id: number;
  title: string;
  started_on: string;
  ended_on: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface MeetingSessionOut extends MeetingSessionLite {
  pair_id: number;
  created_by_id: number;
  created_at: string;
  updated_at: string;
  event_count: number;
}

export interface EventSummary {
  id: number;
  pair_id: number;
  creator_id: number;
  meeting_session_id: number | null;
  meeting_session: MeetingSessionLite | null;
  title: string;
  description: string | null;
  occurred_at: string | null;
  event_kind: EventKind;
  gift_rating: number | null;
  gift_feelings: GiftFeeling[];
  gift_state: GiftState | null;
  gift_receiver_id: number | null;
  gift_wrap_style: GiftWrapStyle | null;
  gift_teaser: string | null;
  gift_open_at: string | null;
  gift_opened_at: string | null;
  gift_feedback: string | null;
  gift_responded_at: string | null;
  gift_masked: boolean;
  gift_can_open: boolean;
  preview_image: { id: number; width: number | null; height: number | null } | null;
  image_count: number;
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

export interface ImageOut {
  type: "image";
  id: number;
  event_id: number;
  author_id: number;
  sort_order: number;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface ContentsOut {
  submission_state: SubmissionState;
  comments: CommentOut[];
  images: ImageOut[];
}

export interface EventDetail extends EventSummary {
  contents: ContentsOut;
}

export type LoveReceiptType = "gift" | "takeout" | "flower" | "drink" | "experience" | "custom";
export type LoveReceiptStatus = "created" | "delivering" | "delivered" | "waiting_receipt" | "completed";
export type LoveReceiptMood =
  | "happy"
  | "surprised"
  | "touched"
  | "reassured"
  | "cherished"
  | "hug"
  | "disappointed"
  | "wronged"
  | "pressured"
  | "not_my_style"
  | "upset"
  | "complicated";

export interface LoveReceiptImageOut {
  id: number;
  love_receipt_id: number;
  author_id: number;
  kind: "cover" | "receipt";
  sort_order: number;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface LoveReceiptOut {
  id: number;
  pair_id: number;
  sender_id: number;
  receiver_id: number;
  sender: UserOut;
  receiver: UserOut;
  viewer_role: "sender" | "receiver";
  receipt_type: LoveReceiptType;
  title: string;
  message: string;
  expected_arrival_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  status: LoveReceiptStatus;
  require_receipt: boolean;
  receipt_content: string | null;
  receipt_mood: LoveReceiptMood | null;
  receipt_rating: number | null;
  completed_at: string | null;
  timeline_event_id: number | null;
  cover: LoveReceiptImageOut | null;
  receipt_images: LoveReceiptImageOut[];
  created_at: string;
  updated_at: string;
}

export interface LoveReceiptListOut {
  items: LoveReceiptOut[];
  page: number;
  page_size: number;
  total: number;
  pending_count: number;
  completed_count: number;
  month_count: number;
  latest_status: LoveReceiptStatus | null;
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
  dissolved_at: string | null;
}

export interface PairDissolvedOut {
  code: "pair_dissolved";
  message: string;
  from_display_name: string;
}

export type ContentItem =
  | (CommentOut & { _kind: "comment" })
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

export interface PasswordSessionOut {
  access_token: string;
  token_type: string;
  expires_at: string;
}

export interface SecurityPasswordOut {
  login_name: string | null;
  configured: boolean;
  password_updated_at: string | null;
}

export interface SecurityPasswordUpdateOut extends PasswordSessionOut {
  security: SecurityPasswordOut;
}

export interface GameScoreOut {
  id: number;
  player_name: string;
  score: number;
  created_at: string;
}

export interface GameLeaderboardOut {
  items: GameScoreOut[];
  threshold: number;
}

export interface GameScoreSubmitOut extends GameLeaderboardOut {
  entered: boolean;
  rank: number | null;
}

export interface QuoteSampleOut {
  items: string[];
}

export interface DefaultQuoteOut {
  id: number;
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
  source: "recorded" | "predicted" | "empty";
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
  has_prediction?: boolean;
  current_cycle_day: number | null;
  current_phase: CyclePhase;
  average_cycle_length: number;
  average_period_length: number;
  last_period_start: string | null;
  next_period_start: string | null;
  next_period_end: string | null;
  ovulation_date: string | null;
  fertile_start: string | null;
  fertile_end: string | null;
  confidence: "high" | "medium" | "low";
  prediction_start: string | null;
  prediction_end: string | null;
  cycle_variation_days: number;
}

export interface CycleDashboardOut {
  logs: DailyLog[];
  stats: CycleStats;
  is_empty: boolean;
}

export interface HabitTaskOut {
  id: number;
  pair_id: number;
  owner_id: number;
  title: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HabitUserDayOut {
  user_id: number;
  display_name: string;
  tasks_total: number;
  completed_count: number;
  all_completed: boolean;
  completed_task_ids: number[];
}

export interface HabitDayOut {
  date: string;
  users: HabitUserDayOut[];
  pair_all_completed: boolean;
}

export interface HabitDashboardOut {
  start: string;
  end: string;
  tasks: HabitTaskOut[];
  days: HabitDayOut[];
}

export interface HabitToggleOut {
  date: string;
  task: HabitTaskOut;
  checked: boolean;
  dashboard: HabitDashboardOut;
}

export interface TodoMeetingOut {
  id: number;
  title: string;
  started_on: string;
  ended_on: string;
}

export interface TodoItemOut {
  id: number;
  pair_id: number;
  creator_id: number;
  category: TodoCategory;
  title: string;
  note: string | null;
  is_archived: boolean;
  meeting_session_id: number | null;
  completed_at: string | null;
  completed_by_id: number | null;
  journal_event_id: number | null;
  comments_count: number;
  images_count: number;
  created_at: string;
  updated_at: string;
}

export interface TodoPlanOut {
  today: string;
  focus_meeting_id: number | null;
  meetings: TodoMeetingOut[];
  items: TodoItemOut[];
}

export interface TodoJournalOut {
  event_id: number;
  created: boolean;
}

export interface TodoCommentOut {
  id: number;
  item_id: number;
  author_id: number;
  author_display_name: string;
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

export interface CycleReminderSettingOut {
  enabled: boolean;
  days_before: number;
  recipient_user_id: number | null;
  recipient_has_email: boolean;
  updated_by_id: number | null;
  updated_at: string | null;
  next_period_start: string | null;
  next_send_on: string | null;
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
