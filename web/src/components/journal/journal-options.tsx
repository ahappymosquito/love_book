"use client";

// 手账导出选项：范围分段（全部 / 某个月 / 某次见面）——“某个月”是点一下就选中的月份网格（显示每月小事数，空月份置灰），见面用列表；另有“带上照片”开关和在线翻看 / HTML / PDF / 长图格式卡片；桌面侧栏和手机底部弹层共用。

import { BookOpen, FileText, Image as ImageIcon, FileCode2 } from "lucide-react";
import type { ReactNode } from "react";
import { MonthPickerGrid } from "@/components/month-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";
import { shanghaiMonthKey } from "@/lib/dates";
import { monthDateRange, monthKeyForRange, shiftMonthKey } from "@/lib/journal-book";
import type { JournalFormat, JournalQuery, JournalScope } from "@/lib/journal-types";
import type { MeetingSessionOut } from "@/lib/types";

const SCOPE_OPTIONS: Array<{ value: JournalScope; label: string }> = [
  { value: "all", label: "全部" },
  { value: "range", label: "某个月" },
  { value: "meeting", label: "某次见面" },
];

export const FORMAT_OPTIONS: Array<{ value: JournalFormat; label: string; hint: string; icon: ReactNode }> = [
  { value: "online", label: "在线翻看", hint: "在这里慢慢翻", icon: <BookOpen className="h-5 w-5" /> },
  { value: "html", label: "HTML 文件", hint: "手机电脑都能打开", icon: <FileCode2 className="h-5 w-5" /> },
  { value: "pdf", label: "PDF", hint: "A5 小册子，适合打印", icon: <FileText className="h-5 w-5" /> },
  { value: "png", label: "长图", hint: "一张图，存相册发给 TA", icon: <ImageIcon className="h-5 w-5" /> },
];

function shortDate(value: string): string {
  const [, m, d] = value.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

export function meetingOptionLabel(meeting: Pick<MeetingSessionOut, "title" | "started_on" | "ended_on">): string {
  const dates =
    meeting.started_on === meeting.ended_on
      ? `${meeting.started_on.slice(0, 4)}年${shortDate(meeting.started_on)}`
      : `${meeting.started_on.slice(0, 4)}年${shortDate(meeting.started_on)}–${shortDate(meeting.ended_on)}`;
  return `${meeting.title} · ${dates}`;
}

const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();

export function JournalOptions({
  query,
  onQueryChange,
  includeImages,
  onIncludeImagesChange,
  format,
  onFormatChange,
  meetings,
  meetingsLoading,
  monthCounts,
  disabled,
  idPrefix,
}: {
  monthCounts: ReadonlyMap<string, number> | null;
  query: JournalQuery;
  onQueryChange: (query: JournalQuery) => void;
  includeImages: boolean;
  onIncludeImagesChange: (value: boolean) => void;
  format: JournalFormat;
  onFormatChange: (value: JournalFormat) => void;
  meetings: MeetingSessionOut[];
  meetingsLoading: boolean;
  disabled?: boolean;
  idPrefix: string;
}) {
  const currentMonth = shanghaiMonthKey();
  const selectedMonth = monthKeyForRange(query.start, query.end);
  const earliest = monthCounts && monthCounts.size > 0 ? [...monthCounts.keys()].sort()[0] : shiftMonthKey(currentMonth, -11);
  const minMonth = selectedMonth && selectedMonth < earliest ? selectedMonth : earliest;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-2 font-sc text-sm font-semibold text-ink">装进哪些回忆</h2>
        <SegmentedControl
          value={query.scope}
          options={SCOPE_OPTIONS.map((option) => ({ ...option, disabled }))}
          onChange={(scope) => {
            const next: JournalQuery = { ...query, scope };
            if (scope === "meeting" && !next.meetingId && meetings[0]) next.meetingId = meetings[0].id;
            if (scope === "range" && (!next.start || !next.end)) Object.assign(next, monthDateRange(currentMonth));
            onQueryChange(next);
          }}
          ariaLabel="选择手账范围"
          layoutId={`${idPrefix}-journal-scope`}
          className="w-full [&>button]:flex-1"
        />

        {query.scope === "range" ? (
          <div className="mt-3 rounded-2xl border border-line/70 bg-surface-raised/70 p-3">
            {query.start && query.end && !selectedMonth ? (
              <p className="mb-2 font-sc text-xs text-ink-muted">
                现在是 {query.start.replaceAll("-", ".")} – {query.end.replaceAll("-", ".")}，点一个月份换成整月
              </p>
            ) : null}
            <MonthPickerGrid
              value={selectedMonth}
              counts={monthCounts ?? EMPTY_COUNTS}
              minMonth={minMonth}
              maxMonth={currentMonth}
              requireEntries={Boolean(monthCounts && monthCounts.size > 0)}
              disabled={disabled}
              onSelect={(key) => onQueryChange({ ...query, ...monthDateRange(key) })}
            />
          </div>
        ) : null}

        {query.scope === "meeting" ? (
          <div className="mt-3">
            <label className="sr-only" htmlFor={`${idPrefix}-meeting`}>
              选择一次见面
            </label>
            {meetings.length ? (
              <select
                id={`${idPrefix}-meeting`}
                className="input-field min-h-11 px-3 py-2 text-[15px]"
                value={query.meetingId ?? ""}
                disabled={disabled}
                onChange={(event) => onQueryChange({ ...query, meetingId: Number(event.target.value) || null })}
              >
                {query.meetingId && !meetings.some((m) => m.id === query.meetingId) ? (
                  <option value={query.meetingId}>这次见面</option>
                ) : null}
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {meetingOptionLabel(meeting)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-2xl bg-cream-deep/60 px-4 py-3 font-sc text-sm text-ink-soft">
                {meetingsLoading ? "正在找见面的日子…" : "还没有见面记录，下次见面记得记一笔"}
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sc text-sm font-semibold text-ink">带上照片</h2>
          <p className="font-sc text-xs text-ink-muted">{includeImages ? "照片会像拍立得一样贴在每一页" : "只留下文字，翻得更快"}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includeImages}
          aria-label="带上照片"
          disabled={disabled}
          onClick={() => onIncludeImagesChange(!includeImages)}
          className={cn(
            "relative inline-flex h-8 w-14 flex-none items-center rounded-full p-1 transition-colors duration-200 focus-ring disabled:opacity-60",
            includeImages ? "bg-sage" : "bg-ink/15",
          )}
        >
          <span
            className={cn(
              "h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ease-out motion-reduce:transition-none",
              includeImages ? "translate-x-6" : "translate-x-0",
            )}
          />
        </button>
      </section>

      <section>
        <h2 className="mb-2 font-sc text-sm font-semibold text-ink">做成什么样</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="手账格式">
          {FORMAT_OPTIONS.map((option) => {
            const selected = option.value === format;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onFormatChange(option.value)}
                className={cn(
                  "flex min-h-[4.5rem] min-w-0 flex-col items-start gap-1 rounded-2xl border px-3 py-2.5 text-left transition focus-ring active:scale-[0.99] motion-reduce:active:scale-100",
                  selected
                    ? "border-rose/55 bg-rose/10 text-rose-deep shadow-[0_2px_8px_rgb(var(--rose)/0.12)]"
                    : "border-line bg-surface-raised text-ink-soft hover:border-rose/35",
                )}
              >
                <span className="flex items-center gap-1.5 font-sc text-sm font-semibold">
                  {option.icon}
                  {option.label}
                </span>
                <span className="font-sc text-[11px] leading-snug text-ink-muted">{option.hint}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
