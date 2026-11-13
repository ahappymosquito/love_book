// 手账唯一渲染器：把 JournalOut 渲染成自包含 HTML（内联 CSS、内联 SVG、可选极小滚动显现脚本、data: 图片），在线翻看、HTML 文件、长图和 PDF 共用同一套块与样式。
// 封面 / 月份页 / 见面票根 / 拍立得照片卡 / 礼物盒与拆开卡 / 未解锁占位 / 结尾页；所有用户文字一律 HTML 转义，文档带 CSP 只允许内联样式脚本与 data: 图片。
// web 版式手机单列、桌面双页对开；long 版式固定 750px 宽静态长图；print 版式按 A5 页面分块。动效只用 transform / opacity，并完整支持减弱动效。

import { GIFT_FEELING_OPTIONS } from "./gift-feelings";
import { deterministicRotation, LONG_IMAGE_WIDTH, PRINT_PAGE_HEIGHT, PRINT_PAGE_PADDING, PRINT_PAGE_WIDTH } from "./journal-pages";
import type {
  JournalAssets,
  JournalEntry,
  JournalLayout,
  JournalMeeting,
  JournalOut,
  JournalUser,
  JournalWrapStyle,
} from "./journal-types";

export interface JournalRenderOptions {
  layout: JournalLayout;
  /** 只有 web 版式才会播放动效；导出图片 / PDF 必须为 false。 */
  animate: boolean;
  includeImages: boolean;
}

export type JournalBlockKind = "cover" | "month" | "meeting" | "entry" | "empty" | "closing";

export interface JournalBlock {
  kind: JournalBlockKind;
  html: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]);
}

/** 正文：转义后保留换行。 */
export function escapeMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
}

/** 只接受本地生成的 data:image 地址，其它一律丢弃。 */
export function safeImageSrc(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
  return value;
}

const TZ = "Asia/Shanghai";
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function zonedParts(iso: string): { y: number; m: number; d: number; w: number; hh: string; mm: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    w: weekdayIndex < 0 ? 0 : weekdayIndex,
    hh: get("hour"),
    mm: get("minute"),
  };
}

export function formatEntryDate(iso: string): string {
  const p = zonedParts(iso);
  if (!p) return "";
  return `${p.m}月${p.d}日 · 周${WEEKDAYS[p.w]}`;
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match && value.length === 10) return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
  const p = zonedParts(value);
  return p ? `${p.y}年${p.m}月${p.d}日` : "";
}

function shortDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : escapeHtml(value);
}

function dayCount(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TAPES = ["rose", "peach", "sage", "cream"] as const;

const ICONS = {
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="currentColor"/></svg>`,
  flower: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="12" cy="6.5" r="3.3"/><circle cx="17.2" cy="10.3" r="3.3"/><circle cx="15.2" cy="16.4" r="3.3"/><circle cx="8.8" cy="16.4" r="3.3"/><circle cx="6.8" cy="10.3" r="3.3"/></g><circle cx="12" cy="12" r="2.6" fill="#fbf5ec"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.4 5.3 5.8.6-4.3 3.9 1.2 5.7L12 16.1 6.9 19l1.2-5.7L3.8 9.4l5.8-.6z" fill="currentColor"/></svg>`,
  leaf: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5.5-13 14-14-1 8.5-6 14-14 14z" fill="currentColor"/><path d="M5 19l8-8" stroke="#fbf5ec" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="3" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="15.3" r="1.6" fill="#fbf5ec"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12.4" r="3.3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`,
};

const STICKERS = ["heart", "flower", "star", "leaf"] as const;

function sticker(key: string): string {
  const h = hash(key);
  if (h % 3 !== 0) return "";
  const name = STICKERS[(h >>> 3) % STICKERS.length];
  const tone = ["rose", "peach", "sage"][(h >>> 6) % 3];
  return `<span class="lbj-sticker lbj-tone-${tone}">${ICONS[name]}</span>`;
}

function tape(key: string, extraClass = ""): string {
  const h = hash(key);
  const tone = TAPES[h % TAPES.length];
  const tilt = ((h >>> 4) % 9) - 4;
  return `<span class="lbj-tape lbj-tape-${tone}${extraClass ? ` ${extraClass}` : ""}" style="--t:${tilt}deg" aria-hidden="true"></span>`;
}

function revealAttr(options: JournalRenderOptions): string {
  return options.animate ? " data-reveal" : "";
}

function userName(users: Map<number, JournalUser>, id: number): string {
  return users.get(id)?.display_name ?? "我们";
}

function avatar(user: JournalUser, assets: JournalAssets): string {
  const src = safeImageSrc(assets.avatars.get(user.id));
  if (src) return `<span class="lbj-avatar"><img src="${src}" alt=""></span>`;
  const glyph = user.avatar?.trim() || Array.from(user.display_name.trim())[0] || "♥";
  return `<span class="lbj-avatar lbj-avatar-text">${escapeHtml(glyph)}</span>`;
}

function rangeText(journal: JournalOut): string {
  if (journal.start && journal.end) {
    return journal.start === journal.end ? formatDay(journal.start) : `${formatDay(journal.start)} — ${formatDay(journal.end)}`;
  }
  const first = journal.months[0];
  const last = journal.months[journal.months.length - 1];
  if (!first || !last) return "";
  return first.month === last.month ? first.label : `${first.label} — ${last.label}`;
}

function renderCover(journal: JournalOut, assets: JournalAssets, options: JournalRenderOptions): string {
  const users = journal.pair.users;
  const names = users.map((u) => escapeHtml(u.display_name)).join(" <span class=\"lbj-amp\">&amp;</span> ");
  const stats = journal.stats;
  const statItems: string[] = [`<li><b>${stats.entry_count}</b><span>篇小事</span></li>`];
  if (stats.image_count) statItems.push(`<li><b>${stats.image_count}</b><span>张照片</span></li>`);
  if (stats.meeting_count) statItems.push(`<li><b>${stats.meeting_count}</b><span>次见面</span></li>`);
  if (stats.gift_count) statItems.push(`<li><b>${stats.gift_count}</b><span>份礼物</span></li>`);
  const days = journal.pair.together_days;
  const range = rangeText(journal);
  return `<section class="lbj-sheet lbj-cover" data-block="cover"${options.animate ? " data-cover" : ""}>
  <div class="lbj-cover-inner">
    <div class="lbj-cover-deco" aria-hidden="true"><span class="lbj-tone-rose">${ICONS.flower}</span><span class="lbj-tone-sage">${ICONS.leaf}</span><span class="lbj-tone-peach">${ICONS.star}</span></div>
    <p class="lbj-kicker">我们的手账</p>
    <h1 class="lbj-cover-title">${escapeHtml(journal.title)}</h1>
    ${range ? `<p class="lbj-cover-range">${escapeHtml(range)}</p>` : ""}
    <div class="lbj-pair">${users.map((u) => avatar(u, assets)).join(`<span class="lbj-pair-heart lbj-tone-rose">${ICONS.heart}</span>`)}</div>
    <p class="lbj-pair-names">${names}</p>
    ${days ? `<p class="lbj-days">在一起的第 <b>${days}</b> 天</p>` : ""}
    <ul class="lbj-stats">${statItems.join("")}</ul>
    <p class="lbj-generated">${escapeHtml(formatDay(journal.generated_at))} 整理</p>
  </div>
  ${options.animate ? `<div class="lbj-cover-flap" aria-hidden="true"><span>${ICONS.heart}</span></div>` : ""}
</section>`;
}

function renderMonthHeader(label: string, count: number, options: JournalRenderOptions): string {
  return `<header class="lbj-month-head" data-block="month"${revealAttr(options)}>
  <span class="lbj-month-label">${escapeHtml(label)}</span>
  <span class="lbj-month-rule" aria-hidden="true"></span>
  <span class="lbj-month-count">${count} 篇</span>
</header>`;
}

function renderMeetingTicket(
  id: number,
  fallbackTitle: string | null,
  meetings: Map<number, JournalMeeting>,
  options: JournalRenderOptions,
): string {
  const meeting = meetings.get(id);
  const title = meeting?.title || fallbackTitle || "我们见面啦";
  let dates = "";
  if (meeting) {
    const n = dayCount(meeting.started_on, meeting.ended_on);
    dates =
      meeting.started_on === meeting.ended_on
        ? `${shortDay(meeting.started_on)} · 1 天`
        : `${shortDay(meeting.started_on)} — ${shortDay(meeting.ended_on)} · ${n} 天`;
  }
  return `<div class="lbj-ticket" data-block="meeting"${revealAttr(options)}>
  <div class="lbj-ticket-stub"><span>见面</span></div>
  <div class="lbj-ticket-main">
    <p class="lbj-ticket-kicker">ADMIT TWO · 两个人的车票</p>
    <h3 class="lbj-ticket-title">${escapeHtml(title)}</h3>
    ${dates ? `<p class="lbj-ticket-dates">${dates}</p>` : ""}
  </div>
  <span class="lbj-ticket-stamp lbj-tone-rose" aria-hidden="true">${ICONS.heart}</span>
</div>`;
}

function aspectStyle(width: number | null, height: number | null): string {
  if (!width || !height) return "aspect-ratio:1/1";
  const ratio = Math.min(4 / 3, Math.max(3 / 4, width / height));
  return `aspect-ratio:${ratio.toFixed(3)}`;
}

function renderPhotos(entry: JournalEntry, assets: JournalAssets, options: JournalRenderOptions): string {
  if (!entry.images.length) return "";
  if (!options.includeImages) {
    return `<p class="lbj-photo-note">${ICONS.camera}<span>这里有 ${entry.images.length} 张照片</span></p>`;
  }
  const count = Math.min(entry.images.length, 4);
  const items = entry.images
    .map((image, index) => {
      const src = safeImageSrc(assets.images.get(image.id));
      const rot = deterministicRotation(`img${image.id}`, 1.5);
      const inner = src
        ? `<img src="${src}" alt="" loading="lazy" decoding="async">`
        : `<span class="lbj-photo-missing">${ICONS.camera}<span>照片暂时没取到</span></span>`;
      return `<figure class="lbj-polaroid" style="--r:${rot}deg;--i:${index}"><span class="lbj-photo" style="${aspectStyle(image.width, image.height)}">${inner}</span></figure>`;
    })
    .join("");
  return `<div class="lbj-photos lbj-photos-${count}">${items}</div>`;
}

function renderComments(entry: JournalEntry, users: Map<number, JournalUser>): string {
  if (!entry.comments.length) return "";
  return `<ul class="lbj-comments">${entry.comments
    .map(
      (c) =>
        `<li><span class="lbj-comment-author">${escapeHtml(userName(users, c.author_id))}</span><span class="lbj-comment-text">${escapeMultiline(c.content)}</span></li>`,
    )
    .join("")}</ul>`;
}

function feelingLabel(value: string): string {
  const meta = GIFT_FEELING_OPTIONS.find((option) => option.value === value);
  return meta ? `${meta.emoji} ${meta.label}` : value;
}

function stars(rating: number | null): string {
  if (!rating) return "";
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return `<p class="lbj-stars" aria-label="${n} 颗星">${"★".repeat(n)}<span>${"★".repeat(5 - n)}</span></p>`;
}

const WRAP_STYLES: JournalWrapStyle[] = ["rose", "peach", "sage", "cream", "starry"];

function wrappedBoxSvg(style: JournalWrapStyle): string {
  return `<svg class="lbj-giftbox lbj-wrap-${style}" viewBox="0 0 120 110" aria-hidden="true">
  <rect class="lbj-box-body" x="14" y="44" width="92" height="60" rx="8"/>
  <rect class="lbj-box-lid" x="8" y="30" width="104" height="20" rx="6"/>
  <g class="lbj-box-dots"><circle cx="30" cy="66" r="3"/><circle cx="52" cy="86" r="3"/><circle cx="84" cy="70" r="3"/><circle cx="92" cy="92" r="3"/><circle cx="34" cy="94" r="3"/></g>
  <rect class="lbj-ribbon" x="53" y="30" width="14" height="74"/>
  <path class="lbj-ribbon" d="M60 30c-10-16-30-18-28-6 2 9 18 8 28 6zM60 30c10-16 30-18 28-6-2 9-18 8-28 6z"/>
</svg>`;
}

function renderGiftBody(entry: JournalEntry, users: Map<number, JournalUser>, assets: JournalAssets, options: JournalRenderOptions): string {
  const gift = entry.gift;
  if (gift && gift.state === "wrapped") {
    const style = gift.wrap_style && WRAP_STYLES.includes(gift.wrap_style) ? gift.wrap_style : "rose";
    return `<div class="lbj-wrapped">
    ${wrappedBoxSvg(style)}
    <p class="lbj-gift-route">${escapeHtml(userName(users, gift.sender_id))} 送给 ${escapeHtml(userName(users, gift.receiver_id))}</p>
    ${gift.teaser ? `<p class="lbj-teaser">“${escapeMultiline(gift.teaser)}”</p>` : ""}
    <p class="lbj-wrapped-hint">还包着呢，等拆开的那一刻</p>
  </div>`;
  }
  const feelings = gift?.feelings ?? [];
  const route = gift
    ? `<p class="lbj-gift-route">${escapeHtml(userName(users, gift.sender_id))} 送给 ${escapeHtml(userName(users, gift.receiver_id))}${gift.opened_at ? ` · ${escapeHtml(formatDay(gift.opened_at))}拆开` : ""}</p>`
    : "";
  const stamp = feelings.length
    ? `<div class="lbj-feelings-stamp" style="--r:${deterministicRotation(`stamp${entry.id}`, 1.5) - 6}deg"><span class="lbj-stamp-kicker">${gift ? escapeHtml(userName(users, gift.receiver_id)) : "收到"}的心情</span>${feelings
        .slice(0, 3)
        .map((f) => `<span class="lbj-stamp-item">${escapeHtml(feelingLabel(f))}</span>`)
        .join("")}</div>`
    : "";
  const feedback = gift?.feedback ? `<p class="lbj-feedback">${escapeMultiline(gift.feedback)}</p>` : "";
  return `${route}${entry.description ? `<p class="lbj-desc">${escapeMultiline(entry.description)}</p>` : ""}${feedback}${stars(gift?.rating ?? null)}${stamp}${renderPhotos(entry, assets, options)}`;
}

const KIND_LABEL: Record<JournalEntry["kind"], string> = {
  memory: "日常",
  offline_meeting: "见面",
  gift: "礼物",
  gift_received: "收到的礼物",
};

function renderEntry(
  entry: JournalEntry,
  users: Map<number, JournalUser>,
  assets: JournalAssets,
  options: JournalRenderOptions,
  side: "l" | "r",
): string {
  const rot = deterministicRotation(`entry${entry.id}`);
  const attrs = `data-block="entry" data-side="${side}" style="--r:${rot}deg"${revealAttr(options)}`;
  const date = `<time class="lbj-date">${escapeHtml(formatEntryDate(entry.occurred_at))}</time>`;
  if (entry.locked) {
    return `<article class="lbj-card lbj-card-locked" ${attrs}>
  ${tape(`t${entry.id}`)}
  <header class="lbj-card-head">${date}</header>
  <div class="lbj-locked"><span class="lbj-tone-rose">${ICONS.lock}</span><p class="lbj-locked-title">还没解锁</p><p class="lbj-locked-hint">等两个人都写完，这一页就能翻开啦</p></div>
</article>`;
  }
  const isGift = entry.kind === "gift" || entry.kind === "gift_received";
  const wrapped = entry.gift?.state === "wrapped";
  const kindClass = isGift ? (wrapped ? "lbj-card-wrapped" : "lbj-card-gift") : entry.kind === "offline_meeting" ? "lbj-card-meeting" : "lbj-card-memory";
  const meetingTag = entry.meeting_session_id && entry.meeting_title ? `<span class="lbj-tag lbj-tag-meeting">${escapeHtml(entry.meeting_title)}</span>` : "";
  const body = isGift
    ? renderGiftBody(entry, users, assets, options)
    : `${entry.description ? `<p class="lbj-desc">${escapeMultiline(entry.description)}</p>` : ""}${renderPhotos(entry, assets, options)}`;
  return `<article class="lbj-card ${kindClass}" ${attrs}>
  ${tape(`t${entry.id}`)}
  ${sticker(`s${entry.id}`)}
  <header class="lbj-card-head">${date}<span class="lbj-tag">${KIND_LABEL[entry.kind] ?? "日常"}</span>${meetingTag}</header>
  <h3 class="lbj-card-title">${escapeHtml(wrapped && !entry.title ? "一份还没拆的礼物" : entry.title)}</h3>
  ${body}
  ${renderComments(entry, users)}
  <p class="lbj-byline">${escapeHtml(userName(users, entry.creator_id))} 记下</p>
</article>`;
}

function renderEmpty(options: JournalRenderOptions): string {
  return `<section class="lbj-sheet lbj-empty" data-block="empty"${revealAttr(options)}>
  <span class="lbj-tone-peach">${ICONS.flower}</span>
  <p class="lbj-empty-title">这一段还空着</p>
  <p class="lbj-empty-hint">换个日期或某次见面，再翻翻看</p>
</section>`;
}

function renderClosing(journal: JournalOut, options: JournalRenderOptions): string {
  const names = journal.pair.users.map((u) => escapeHtml(u.display_name)).join(" &amp; ");
  return `<section class="lbj-sheet lbj-closing" data-block="closing"${revealAttr(options)}>
  <span class="lbj-closing-heart lbj-tone-rose">${ICONS.heart}</span>
  <p class="lbj-closing-title">未完待续</p>
  <p class="lbj-closing-text">下一页，留给我们一起写</p>
  <p class="lbj-closing-sign">${names}</p>
</section>`;
}

interface MonthPlan {
  label: string;
  count: number;
  items: JournalBlock[];
}

function planMonths(journal: JournalOut, assets: JournalAssets, options: JournalRenderOptions): MonthPlan[] {
  const users = new Map(journal.pair.users.map((u) => [u.id, u]));
  const meetings = new Map(journal.meetings.map((m) => [m.id, m]));
  return journal.months
    .filter((month) => month.entries.length)
    .map((month) => {
      const items: JournalBlock[] = [];
      let currentMeeting: number | null = null;
      let column = 0;
      for (const entry of month.entries) {
        if (entry.meeting_session_id !== currentMeeting) {
          currentMeeting = entry.meeting_session_id;
          if (currentMeeting) {
            items.push({ kind: "meeting", html: renderMeetingTicket(currentMeeting, entry.meeting_title, meetings, options) });
            column = 0;
          }
        }
        items.push({ kind: "entry", html: renderEntry(entry, users, assets, options, column % 2 === 0 ? "l" : "r") });
        column += 1;
      }
      return { label: month.label, count: month.entries.length, items };
    });
}

/** 平铺块序列：长图与 PDF 用它分段分页。 */
export function renderJournalBlocks(journal: JournalOut, assets: JournalAssets, options: JournalRenderOptions): JournalBlock[] {
  const blocks: JournalBlock[] = [{ kind: "cover", html: renderCover(journal, assets, options) }];
  const months = planMonths(journal, assets, options);
  if (!months.length) blocks.push({ kind: "empty", html: renderEmpty(options) });
  for (const month of months) {
    blocks.push({ kind: "month", html: renderMonthHeader(month.label, month.count, options) });
    blocks.push(...month.items);
  }
  blocks.push({ kind: "closing", html: renderClosing(journal, options) });
  return blocks;
}

function layoutClass(options: JournalRenderOptions): string {
  return `lbj lbj--${options.layout}${options.animate ? " lbj--animate" : " lbj--static"}`;
}

/** web 版式主体：封面、每月一张对开纸页、结尾页。 */
export function renderJournalBody(journal: JournalOut, assets: JournalAssets, options: JournalRenderOptions): string {
  const months = planMonths(journal, assets, options);
  const monthSheets = months
    .map(
      (month) => `<section class="lbj-sheet lbj-month">
  ${renderMonthHeader(month.label, month.count, options)}
  <div class="lbj-spread">${month.items.map((item) => item.html).join("\n")}</div>
</section>`,
    )
    .join("\n");
  return `<div class="${layoutClass(options)}"><main class="lbj-book">
${renderCover(journal, assets, options)}
${months.length ? monthSheets : renderEmpty(options)}
${renderClosing(journal, options)}
</main></div>`;
}

/** 长图 / PDF 用的平铺容器，blocksHtml 由调用方按段或按页挑选。 */
export function renderFlowFragment(blocksHtml: string[], options: JournalRenderOptions, extraClass = ""): string {
  return `<div class="${layoutClass(options)}${extraClass ? ` ${extraClass}` : ""}"><div class="lbj-flow">${blocksHtml.join("\n")}</div></div>`;
}

/** PDF 单页：A5 纸面，超高内容整体缩小放进页内。 */
export function renderPrintPage(blocksHtml: string[], pageNumber: number, scale = 1): string {
  const s = Math.max(0.3, Math.min(1, scale));
  const transform = s < 1 ? ` style="transform:scale(${s.toFixed(4)})"` : "";
  return `<div class="lbj lbj--print lbj--static"><div class="lbj-page"><div class="lbj-flow"${transform}>${blocksHtml.join("\n")}</div><p class="lbj-page-no">${pageNumber}</p></div></div>`;
}

const REVEAL_SCRIPT = `(function(){var els=[].slice.call(document.querySelectorAll('[data-reveal],[data-cover]'));var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;function show(e){e.classList.add('is-in')}if(rm||!('IntersectionObserver' in window)){els.forEach(show);return}var io=new IntersectionObserver(function(list){list.forEach(function(it){if(it.isIntersecting){show(it.target);io.unobserve(it.target)}})},{rootMargin:'0px 0px -6% 0px',threshold:0.06});els.forEach(function(e){io.observe(e)})})();`;

export function renderJournalDocument(journal: JournalOut, assets: JournalAssets, options: JournalRenderOptions): string {
  const body = renderJournalBody(journal, assets, options);
  const script = options.animate
    ? { head: `<script>document.documentElement.classList.add('lbj-js')</script>`, tail: `<script>${REVEAL_SCRIPT}</script>` }
    : { head: "", tail: "" };
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="color-scheme" content="light">
<title>${escapeHtml(journal.title)}</title>
<style>${journalCss()}</style>
${script.head}
</head>
<body class="lbj-doc">
${body}
${script.tail}
</body>
</html>`;
}

/** 所有样式都挂在 .lbj 下，既能独立成文件，也能插进站内离屏容器做截图。 */
export function journalCss(): string {
  return `
.lbj-doc{margin:0;background:#efe5d8;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.lbj{--paper:#fcf7ef;--paper-2:#f6ecdf;--desk:#efe5d8;--ink:#46302f;--ink-soft:#674c4b;--ink-muted:#7d6260;--line:#e6d6c6;--rose:#c45d77;--rose-deep:#9f3f58;--rose-soft:#f5dde2;--peach:#e3a07d;--peach-deep:#b4643f;--peach-soft:#f8e2d3;--sage:#6f9f87;--sage-deep:#3f7560;--sage-soft:#dcebe1;--ease:cubic-bezier(.22,1,.36,1);
color:var(--ink);font-family:"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei","Source Han Sans SC",system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.72;color-scheme:light;background:var(--desk);background-image:radial-gradient(rgba(150,110,90,.07) 1px,transparent 1px);background-size:18px 18px;-webkit-font-smoothing:antialiased;overflow-wrap:anywhere;word-break:break-word}
.lbj *,.lbj *::before,.lbj *::after{box-sizing:border-box}
.lbj p,.lbj h1,.lbj h3,.lbj ul,.lbj figure{margin:0;padding:0}
.lbj ul{list-style:none}
.lbj img{display:block;max-width:100%}
.lbj svg{display:block;width:100%;height:100%}
.lbj-tone-rose{color:var(--rose)}.lbj-tone-peach{color:var(--peach)}.lbj-tone-sage{color:var(--sage)}
.lbj-book{max-width:1120px;margin:0 auto;padding:max(14px,env(safe-area-inset-top)) 12px calc(48px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:22px}
.lbj-sheet{position:relative;background:var(--paper);border-radius:6px 14px 14px 6px;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 10px 26px rgba(90,56,48,.10),0 2px 4px rgba(90,56,48,.06);padding:1.4em 1.05em 1.6em}
.lbj-sheet::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(90deg,rgba(120,80,60,.07),transparent 18px)}
.lbj-cover{min-height:min(88svh,760px);display:grid;place-items:center;text-align:center;overflow:hidden;background:linear-gradient(160deg,#fdf6ee 0%,#f9e9e2 55%,#f3ede0 100%)}
.lbj-cover-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:.7em;max-width:34em;padding:1em .4em}
.lbj-cover-deco{display:flex;gap:.6em;height:1.6em}.lbj-cover-deco span{width:1.6em;height:1.6em}
.lbj-kicker{font-size:.82em;letter-spacing:.32em;color:var(--rose-deep);font-weight:600}
.lbj-cover-title{font-family:"Songti SC","Noto Serif SC","Source Han Serif SC","STSong",serif;font-size:2.05em;line-height:1.25;font-weight:700;color:var(--ink);letter-spacing:.02em}
.lbj-cover-range{color:var(--ink-soft);font-size:.95em}
.lbj-pair{display:flex;align-items:center;gap:.7em;margin-top:.6em}
.lbj-pair-heart{width:1.4em;height:1.4em}
.lbj-avatar{width:4.2em;height:4.2em;border-radius:50%;overflow:hidden;background:#fff;border:.22em solid #fff;box-shadow:0 4px 12px rgba(90,56,48,.16);display:grid;place-items:center}
.lbj-avatar img{width:100%;height:100%;object-fit:cover}
.lbj-avatar-text{font-size:1.9em;width:2.2em;height:2.2em;border-width:.12em;background:var(--rose-soft);color:var(--rose-deep);font-weight:700}
.lbj-pair-names{font-size:1.15em;font-weight:600}
.lbj-amp{color:var(--rose);font-family:Georgia,serif;font-style:italic;padding:0 .15em}
.lbj-days{color:var(--ink-soft)}.lbj-days b{color:var(--rose-deep);font-size:1.5em;padding:0 .1em}
.lbj-stats{display:flex;flex-wrap:wrap;justify-content:center;gap:.5em;margin-top:.4em}
.lbj-stats li{background:#fff;border:1px solid var(--line);border-radius:999px;padding:.3em .9em;display:flex;align-items:baseline;gap:.3em;font-size:.9em}
.lbj-stats b{color:var(--rose-deep);font-size:1.15em}
.lbj-generated{margin-top:.8em;font-size:.8em;color:var(--ink-muted)}
.lbj-cover-flap{position:absolute;inset:0;z-index:2;display:grid;place-items:center;background:linear-gradient(150deg,#c9768a,#b85f75 60%,#a95369);border-radius:inherit;transform-origin:left center;pointer-events:none;opacity:0;visibility:hidden}
.lbj-cover-flap span{width:3em;height:3em;color:#fbe6ea}
.lbj-month{padding-top:1.1em}
.lbj-month-head{display:flex;align-items:center;gap:.7em;margin:0 0 1em}
.lbj-month-label{font-family:"Songti SC","Noto Serif SC","STSong",serif;font-size:1.45em;font-weight:700;color:var(--ink);white-space:nowrap}
.lbj-month-rule{flex:1;height:2px;background:repeating-linear-gradient(90deg,var(--peach) 0 8px,transparent 8px 14px);transform-origin:left center;opacity:.8}
.lbj-month-count{font-size:.85em;color:var(--ink-muted);white-space:nowrap}
.lbj-spread{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25em;position:relative}
.lbj-card{position:relative;background:#fffdf9;border:1px solid var(--line);border-radius:12px;padding:1.25em 1.05em 1em;box-shadow:0 6px 16px rgba(90,56,48,.08);transform:rotate(var(--r,0deg))}
.lbj-card-meeting{background:#fbfdf9;border-color:#d7e5da}
.lbj-card-gift{background:#fffaf5;border-color:#efd5c4}
.lbj-card-wrapped{background:#fff9f6}
.lbj-tape{position:absolute;top:-.62em;left:50%;width:5.6em;height:1.3em;margin-left:-2.8em;transform:rotate(var(--t,0deg));border-radius:2px;opacity:.88;box-shadow:0 1px 2px rgba(90,56,48,.08)}
.lbj-tape-rose{background:repeating-linear-gradient(45deg,#f0c3cd 0 6px,#f6d6dc 6px 12px)}
.lbj-tape-peach{background:repeating-linear-gradient(-45deg,#f3cdb5 0 6px,#f8dfcf 6px 12px)}
.lbj-tape-sage{background:repeating-linear-gradient(90deg,#c9e0d1 0 5px,#dcebe1 5px 10px)}
.lbj-tape-cream{background:repeating-linear-gradient(45deg,#efe2c9 0 4px,#f6ecda 4px 8px)}
.lbj-sticker{position:absolute;right:.7em;top:.7em;width:1.5em;height:1.5em;transform:rotate(12deg);opacity:.85}
.lbj-card-head{display:flex;flex-wrap:wrap;align-items:center;gap:.35em .5em;padding-right:1.8em;margin-bottom:.35em}
.lbj-date{font-size:.86em;color:var(--ink-muted);font-variant-numeric:tabular-nums}
.lbj-tag{font-size:.74em;line-height:1.2;padding:.28em .6em;border-radius:999px;background:var(--rose-soft);color:var(--rose-deep);font-weight:600}
.lbj-card-meeting .lbj-tag{background:var(--sage-soft);color:var(--sage-deep)}
.lbj-card-gift .lbj-tag,.lbj-card-wrapped .lbj-tag{background:var(--peach-soft);color:var(--peach-deep)}
.lbj-tag-meeting{background:var(--sage-soft)!important;color:var(--sage-deep)!important;font-weight:500}
.lbj-card-title{font-size:1.18em;line-height:1.4;font-weight:700;color:var(--ink);margin-bottom:.35em}
.lbj-desc{color:var(--ink-soft);margin-top:.2em}
.lbj-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75em .6em;margin-top:.9em}
.lbj-photos-1{grid-template-columns:minmax(0,1fr);max-width:26em;margin-left:auto;margin-right:auto}
.lbj-polaroid{background:#fff;padding:.42em .42em 1.5em;border-radius:3px;box-shadow:0 3px 10px rgba(90,56,48,.13);transform:rotate(var(--r,0deg))}
.lbj-photo{display:block;width:100%;overflow:hidden;background:var(--paper-2);border-radius:1px}
.lbj-photo img{width:100%;height:100%;object-fit:cover}
.lbj-photo-missing{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3em;color:var(--ink-muted);font-size:.8em}
.lbj-photo-missing svg{width:1.8em;height:1.8em}
.lbj-photo-note{display:inline-flex;align-items:center;gap:.4em;margin-top:.7em;font-size:.84em;color:var(--ink-muted);background:var(--paper-2);border-radius:999px;padding:.25em .8em}
.lbj-photo-note svg{width:1.1em;height:1.1em}
.lbj-comments{margin-top:.9em;padding-top:.7em;border-top:1px dashed var(--line);display:flex;flex-direction:column;gap:.45em}
.lbj-comments li{font-size:.92em;line-height:1.6;color:var(--ink-soft);background:var(--paper-2);border-radius:10px;padding:.45em .7em}
.lbj-comment-author{font-weight:600;color:var(--rose-deep);margin-right:.45em}
.lbj-byline{margin-top:.75em;font-size:.78em;color:var(--ink-muted);text-align:right}
.lbj-locked{display:flex;flex-direction:column;align-items:center;text-align:center;gap:.25em;padding:1.1em .5em .6em;border:1.5px dashed #e7c6cd;border-radius:10px;background:repeating-linear-gradient(135deg,#fdf3f4 0 10px,#fbecef 10px 20px)}
.lbj-locked>span{width:2.2em;height:2.2em}
.lbj-locked-title{font-weight:700;color:var(--rose-deep)}
.lbj-locked-hint{font-size:.86em;color:var(--ink-soft)}
.lbj-ticket{position:relative;display:flex;align-items:stretch;background:#fff;border:1px solid #d7e5da;border-radius:12px;overflow:hidden;box-shadow:0 5px 14px rgba(63,117,96,.10)}
.lbj-ticket-stub{flex:none;width:3.4em;display:grid;place-items:center;background:var(--sage-soft);border-right:2px dashed #b7d2c1}
.lbj-ticket-stub span{writing-mode:vertical-rl;letter-spacing:.4em;color:var(--sage-deep);font-weight:700}
.lbj-ticket-main{flex:1;min-width:0;padding:.85em 3.4em .85em 1em}
.lbj-ticket-kicker{font-size:.7em;letter-spacing:.18em;color:var(--sage-deep);opacity:.85}
.lbj-ticket-title{font-size:1.15em;font-weight:700;color:var(--ink);line-height:1.35}
.lbj-ticket-dates{font-size:.86em;color:var(--ink-soft);font-variant-numeric:tabular-nums}
.lbj-ticket-stamp{position:absolute;right:.8em;top:50%;width:2.4em;height:2.4em;margin-top:-1.2em;padding:.35em;border:2px solid currentColor;border-radius:50%;transform:rotate(-12deg);opacity:.75}
.lbj-wrapped{display:flex;flex-direction:column;align-items:center;text-align:center;gap:.3em;padding:.4em 0 .2em}
.lbj-giftbox{width:7.5em!important;height:auto!important;aspect-ratio:120/110}
.lbj-box-body,.lbj-box-lid{fill:var(--rose-soft);stroke:rgba(90,56,48,.18);stroke-width:1.2}
.lbj-box-dots{fill:#fff;opacity:.75}
.lbj-ribbon{fill:var(--rose)}
.lbj-wrap-peach .lbj-box-body,.lbj-wrap-peach .lbj-box-lid{fill:var(--peach-soft)}.lbj-wrap-peach .lbj-ribbon{fill:var(--peach)}
.lbj-wrap-sage .lbj-box-body,.lbj-wrap-sage .lbj-box-lid{fill:var(--sage-soft)}.lbj-wrap-sage .lbj-ribbon{fill:var(--sage)}
.lbj-wrap-cream .lbj-box-body,.lbj-wrap-cream .lbj-box-lid{fill:#f4e9d4}.lbj-wrap-cream .lbj-ribbon{fill:#c9a87a}
.lbj-wrap-starry .lbj-box-body,.lbj-wrap-starry .lbj-box-lid{fill:#5d5470}.lbj-wrap-starry .lbj-box-dots{fill:#f7e6b0}.lbj-wrap-starry .lbj-ribbon{fill:#e8c98c}
.lbj-gift-route{font-size:.86em;color:var(--peach-deep);font-weight:600}
.lbj-teaser{color:var(--ink-soft);font-style:italic}
.lbj-wrapped-hint{font-size:.84em;color:var(--ink-muted)}
.lbj-feedback{margin-top:.5em;padding:.6em .8em;border-left:3px solid var(--peach);background:var(--peach-soft);border-radius:0 10px 10px 0;color:var(--ink)}
.lbj-stars{margin-top:.4em;color:#d69a3c;letter-spacing:.12em}.lbj-stars span{color:#e8dccd}
.lbj-feelings-stamp{display:inline-flex;flex-direction:column;align-items:center;gap:.1em;margin-top:.8em;padding:.55em 1em;border:2px solid var(--rose);border-radius:14px;color:var(--rose-deep);transform:rotate(var(--r,-6deg));background:rgba(255,255,255,.6);box-shadow:inset 0 0 0 3px #fff,inset 0 0 0 4px rgba(196,93,119,.35)}
.lbj-stamp-kicker{font-size:.7em;letter-spacing:.2em;opacity:.85}
.lbj-stamp-item{font-weight:700;font-size:.95em}
.lbj-empty,.lbj-closing{text-align:center;display:flex;flex-direction:column;align-items:center;gap:.35em;padding:2.4em 1em}
.lbj-empty>span{width:2.4em;height:2.4em}
.lbj-empty-title,.lbj-closing-title{font-family:"Songti SC","Noto Serif SC","STSong",serif;font-size:1.4em;font-weight:700}
.lbj-empty-hint,.lbj-closing-text{color:var(--ink-soft)}
.lbj-closing{min-height:16em;justify-content:center;background:linear-gradient(180deg,#fcf7ef,#f6e8e3)}
.lbj-closing-heart{width:2.2em;height:2.2em}
.lbj-closing-sign{margin-top:.6em;font-size:.9em;color:var(--ink-muted)}
@media (min-width:640px){
 .lbj--web{font-size:17px}
 .lbj--web .lbj-book{padding:28px 24px 64px;gap:30px}
 .lbj--web .lbj-sheet{padding:2em 2em 2.2em}
 .lbj--web .lbj-photos-3,.lbj--web .lbj-photos-4{grid-template-columns:repeat(3,minmax(0,1fr))}
 .lbj--web .lbj-cover-title{font-size:2.5em}
}
@media (min-width:900px){
 .lbj--web .lbj-sheet{padding:2.2em 2.6em 2.6em;border-radius:8px 16px 16px 8px}
 .lbj--web .lbj-month{border-radius:10px;background:linear-gradient(90deg,var(--paper) 0,var(--paper) calc(50% - 26px),#f1e6d8 50%,var(--paper) calc(50% + 26px),var(--paper) 100%)}
 .lbj--web .lbj-month::after{background:none}
 .lbj--web .lbj-spread{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:4.2em;row-gap:1.7em;align-items:start;perspective:1600px}
 .lbj--web .lbj-spread::before{content:"";position:absolute;top:-.6em;bottom:-.6em;left:50%;width:1px;background:rgba(120,80,60,.14)}
 .lbj--web .lbj-spread>.lbj-ticket{grid-column:1/-1;max-width:40em;justify-self:center;width:100%}
 .lbj--web .lbj-photos-3,.lbj--web .lbj-photos-4{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.lbj--long{font-size:27px;width:${LONG_IMAGE_WIDTH}px;background:var(--desk)}
.lbj--long .lbj-flow{width:${LONG_IMAGE_WIDTH}px;padding:36px 30px 44px;display:flex;flex-direction:column;gap:30px}
.lbj--long .lbj-cover{min-height:0;padding:2.2em 1em}
.lbj--long .lbj-sheet{padding:1.4em 1em 1.6em}
.lbj--long .lbj-month-head{margin:.6em 0 0}
.lbj--long .lbj-photos-3,.lbj--long .lbj-photos-4{grid-template-columns:repeat(2,minmax(0,1fr))}
.lbj--print{font-size:13.5px;width:${PRINT_PAGE_WIDTH}px;background:var(--paper);background-image:none}
.lbj--print .lbj-flow{width:${PRINT_PAGE_WIDTH}px;padding:0 ${PRINT_PAGE_PADDING}px;display:flex;flex-direction:column;gap:18px}
.lbj--print .lbj-sheet{box-shadow:none;background:transparent;padding:.4em 0}
.lbj--print .lbj-sheet::after{display:none}
.lbj--print .lbj-cover,.lbj--print .lbj-closing{min-height:${PRINT_PAGE_HEIGHT - PRINT_PAGE_PADDING * 2}px;background:transparent}
.lbj--print .lbj-card{box-shadow:0 2px 6px rgba(90,56,48,.08)}
.lbj-page{width:${PRINT_PAGE_WIDTH}px;height:${PRINT_PAGE_HEIGHT}px;overflow:hidden;background:var(--paper);position:relative}
.lbj-page>.lbj-flow{padding-top:${PRINT_PAGE_PADDING}px;transform-origin:top center}
.lbj-page-no{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:10px;color:var(--ink-muted);letter-spacing:.1em}
.lbj-js .lbj--animate [data-reveal]{opacity:0;transform:translate3d(0,22px,0) rotate(calc(var(--r,0deg) + 1.2deg)) scale(.985);transition:opacity .52s var(--ease),transform .62s var(--ease)}
.lbj-js .lbj--animate [data-reveal].is-in{opacity:1;transform:translate3d(0,0,0) rotate(var(--r,0deg)) scale(1)}
.lbj-js .lbj--animate [data-reveal] .lbj-tape{opacity:0;transform:rotate(var(--t,0deg)) scale(.55,1);transition:opacity .28s var(--ease) .3s,transform .34s var(--ease) .3s}
.lbj-js .lbj--animate [data-reveal].is-in .lbj-tape{opacity:.88;transform:rotate(var(--t,0deg)) scale(1)}
.lbj-js .lbj--animate [data-reveal] .lbj-photo img{opacity:0;transition:opacity 1.1s ease calc(.35s + var(--i,0) * .12s)}
.lbj-js .lbj--animate [data-reveal].is-in .lbj-photo img{opacity:1}
.lbj-js .lbj--animate [data-reveal] .lbj-polaroid{transform:translate3d(0,8px,0) rotate(var(--r,0deg));transition:transform .6s var(--ease) calc(.2s + var(--i,0) * .08s)}
.lbj-js .lbj--animate [data-reveal].is-in .lbj-polaroid{transform:translate3d(0,0,0) rotate(var(--r,0deg))}
.lbj-js .lbj--animate .lbj-month-head[data-reveal] .lbj-month-rule{transform:scaleX(0);transition:transform .8s var(--ease) .15s}
.lbj-js .lbj--animate .lbj-month-head[data-reveal].is-in .lbj-month-rule{transform:scaleX(1)}
.lbj-js .lbj--animate .lbj-month-head[data-reveal]{transform:translate3d(0,12px,0)}
.lbj-js .lbj--animate .lbj-month-head[data-reveal].is-in{transform:none}
.lbj-js .lbj--animate .lbj-feelings-stamp{opacity:0;transform:rotate(var(--r,-6deg)) scale(1.35);transition:opacity .25s ease .55s,transform .4s var(--ease) .55s}
.lbj-js .lbj--animate [data-reveal].is-in .lbj-feelings-stamp{opacity:1;transform:rotate(var(--r,-6deg)) scale(1)}
.lbj-js .lbj--animate [data-cover] .lbj-cover-flap{visibility:visible;opacity:1}
.lbj-js .lbj--animate [data-cover].is-in .lbj-cover-flap{animation:lbj-cover-open 1.15s var(--ease) .25s forwards}
.lbj-js .lbj--animate [data-cover] .lbj-cover-inner{opacity:0;transform:scale(.97)}
.lbj-js .lbj--animate [data-cover].is-in .lbj-cover-inner{opacity:1;transform:none;transition:opacity .6s ease .55s,transform .8s var(--ease) .55s}
@keyframes lbj-cover-open{0%{transform:perspective(1400px) rotateY(0);opacity:1}70%{opacity:1}100%{transform:perspective(1400px) rotateY(-108deg);opacity:0;visibility:hidden}}
@media (min-width:900px){
 .lbj-js .lbj--animate .lbj-spread>[data-side="l"][data-reveal]{transform-origin:right center;transform:perspective(1400px) rotateY(16deg) translate3d(0,10px,0) rotate(var(--r,0deg))}
 .lbj-js .lbj--animate .lbj-spread>[data-side="r"][data-reveal]{transform-origin:left center;transform:perspective(1400px) rotateY(-16deg) translate3d(0,10px,0) rotate(var(--r,0deg))}
 .lbj-js .lbj--animate .lbj-spread>[data-reveal].is-in{transform:perspective(1400px) rotateY(0) translate3d(0,0,0) rotate(var(--r,0deg))}
}
@media (prefers-reduced-motion:reduce){
 .lbj-js .lbj--animate [data-reveal],.lbj-js .lbj--animate [data-reveal] *,.lbj-js .lbj--animate [data-cover] *{transition:none!important;animation:none!important}
 .lbj-js .lbj--animate [data-reveal]{opacity:1!important;transform:rotate(var(--r,0deg))!important}
 .lbj-js .lbj--animate [data-reveal] .lbj-tape{opacity:.88!important;transform:rotate(var(--t,0deg))!important}
 .lbj-js .lbj--animate [data-reveal] .lbj-photo img,.lbj-js .lbj--animate .lbj-feelings-stamp{opacity:1!important}
 .lbj-js .lbj--animate [data-reveal] .lbj-polaroid{transform:rotate(var(--r,0deg))!important}
 .lbj-js .lbj--animate .lbj-month-rule{transform:none!important}
 .lbj-js .lbj--animate [data-cover] .lbj-cover-flap{display:none}
 .lbj-js .lbj--animate [data-cover] .lbj-cover-inner{opacity:1;transform:none}
}
`;
}
