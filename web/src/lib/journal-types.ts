// 手账导出数据类型：对应后端 GET /journal 的 JournalOut 结构，以及前端导出用的范围、格式与图片资源映射。

export type JournalScope = "all" | "range" | "meeting";
export type JournalFormat = "online" | "html" | "pdf" | "png";
export type JournalEntryKind = "memory" | "offline_meeting" | "gift" | "gift_received";
export type JournalWrapStyle = "rose" | "peach" | "sage" | "cream" | "starry";

export interface JournalUser {
  id: number;
  display_name: string;
  avatar: string | null;
  avatar_has_image: boolean;
  avatar_updated_at: string | null;
}

export interface JournalMeeting {
  id: number;
  title: string;
  started_on: string;
  ended_on: string;
}

export interface JournalImage {
  id: number;
  width: number | null;
  height: number | null;
}

export interface JournalComment {
  id: number;
  author_id: number;
  content: string;
  created_at: string;
}

export interface JournalGift {
  state: "wrapped" | "opened";
  sender_id: number;
  receiver_id: number;
  wrap_style: JournalWrapStyle | null;
  teaser: string | null;
  opened_at: string | null;
  feelings: string[];
  rating: number | null;
  feedback: string | null;
}

export interface JournalEntry {
  id: number;
  kind: JournalEntryKind;
  title: string;
  description: string | null;
  occurred_at: string;
  creator_id: number;
  meeting_session_id: number | null;
  meeting_title: string | null;
  locked: boolean;
  images: JournalImage[];
  comments: JournalComment[];
  gift: JournalGift | null;
}

export interface JournalMonth {
  month: string;
  label: string;
  entries: JournalEntry[];
}

export interface JournalOut {
  scope: JournalScope;
  title: string;
  start: string | null;
  end: string | null;
  generated_at: string;
  pair: {
    users: JournalUser[];
    together_since: string | null;
    together_days: number | null;
  };
  meetings: JournalMeeting[];
  months: JournalMonth[];
  stats: {
    entry_count: number;
    image_count: number;
    gift_count: number;
    meeting_count: number;
  };
}

export interface JournalQuery {
  scope: JournalScope;
  start: string;
  end: string;
  meetingId: number | null;
}

/** 图片 id / 用户 id 到 data URL 的映射；缺失表示不带图或拉取失败。 */
export interface JournalAssets {
  images: Map<number, string>;
  failedImages: Set<number>;
  avatars: Map<number, string>;
}

export type JournalLayout = "web" | "long" | "print";
