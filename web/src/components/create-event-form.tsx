"use client";

// Reusable event creation form shared by the direct /create page and the global bottom-sheet create window, including the manual record kind that powers the offline-meeting timeline view.

import { useState } from "react";
import { CalendarHeart, Eye, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import type { EventDetail, EventKind, VisibilityMode } from "@/lib/types";
import { cn } from "@/lib/cn";

export function CreateEventForm({
  onCreated,
  className,
}: {
  onCreated: (event: EventDetail) => void;
  className?: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState<string>(toLocalInputValue(new Date()));
  const [eventKind, setEventKind] = useState<EventKind>("memory");
  const [visibility, setVisibility] = useState<VisibilityMode>("public");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const event = await api.createEvent({
        title: title.trim(),
        description: description.trim() || null,
        occurred_at: occurredAt ? fromLocalInputValue(occurredAt) : null,
        event_kind: eventKind,
        visibility_mode: visibility,
      });
      toast.success("已记下这一笔");
      onCreated(event);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={cn("space-y-6", className)}>
      <div>
        <p className="mb-1 font-sc text-xs font-semibold text-rose-deep">写进今天的小贴纸</p>
        <h1 className="font-display text-2xl font-bold leading-tight text-ink">记下这一笔</h1>
        <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">
          标题先写清楚，细节可以慢慢补，像在手账上贴一页。
        </p>
      </div>

      <div className="space-y-2">
        <Label>标题</Label>
        <input
          className="input-field font-display text-lg font-semibold"
          placeholder="例如：周三的雨夜，我们躲进便利店"
          value={title}
          maxLength={200}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>描述（可不写）</Label>
        <textarea
          className="input-field min-h-[112px] resize-none leading-relaxed"
          placeholder="写下当时的画面、味道、温度，或者只是一个名字。"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </div>

      <div className="space-y-2">
        <Label>记录类型</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RecordKindCard
            active={eventKind === "memory"}
            onClick={() => setEventKind("memory")}
            icon={<Sparkles className="h-4 w-4" />}
            title="小事"
            desc="日常、想法、照片和语音都放在这里。"
          />
          <RecordKindCard
            active={eventKind === "offline_meeting"}
            onClick={() => setEventKind("offline_meeting")}
            icon={<CalendarHeart className="h-4 w-4" />}
            title="线下见面"
            desc="会进入见面时间河流，在首页被温柔高亮。"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label icon={<CalendarHeart className="h-3.5 w-3.5" />}>发生时间</Label>
        <input
          type="datetime-local"
          className="input-field font-sc"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
        <p className="font-sc text-[11px] text-ink-muted">留空就用此刻；选过去也行。</p>
      </div>

      <div className="space-y-2">
        <Label>可见方式</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VisibilityCard
            active={visibility === "public"}
            onClick={() => setVisibility("public")}
            icon={<Eye className="h-4 w-4" />}
            title="公开"
            desc="写下就立刻让对方看到。"
          />
          <VisibilityCard
            active={visibility === "mutual_submit"}
            onClick={() => setVisibility("mutual_submit")}
            icon={<Lock className="h-4 w-4" />}
            title="双方提交后可见"
            desc="像扔进小盒子，等彼此都写下才一起拆开。"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={!title.trim() || submitting}
          className="btn-primary inline-flex min-h-[48px] items-center gap-2 rounded-2xl px-6 py-3.5 font-sc text-[15px] font-medium focus-ring"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          收藏起来
        </button>
      </div>
    </form>
  );
}

function Label({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-1.5 font-sc text-xs font-medium text-ink-muted">
      {icon}
      {children}
    </label>
  );
}

function RecordKindCard({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-2xl p-4 text-left transition focus-ring hairline",
        active ? "bg-rose/10 ring-2 ring-rose/35" : "bg-surface-raised/85 hover:bg-peach/14",
      )}
    >
      <div className="flex items-center gap-2 font-sc text-sm font-medium text-ink">
        <span className={cn("grid h-7 w-7 place-items-center rounded-full", active ? "bg-rose text-white" : "bg-peach/24 text-rose-deep")}>
          {icon}
        </span>
        {title}
      </div>
      <p className="mt-2 font-sc text-xs leading-relaxed text-ink-soft">{desc}</p>
    </button>
  );
}

function VisibilityCard({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-2xl p-4 text-left transition focus-ring hairline",
        active ? "bg-peach/24 ring-2 ring-rose/35" : "bg-surface-raised/85 hover:bg-peach/14",
      )}
    >
      <div className="flex items-center gap-2 font-sc text-sm font-medium text-ink">
        <span className={cn("grid h-7 w-7 place-items-center rounded-full", active ? "bg-rose text-white" : "bg-peach/24 text-rose-deep")}>
          {icon}
        </span>
        {title}
      </div>
      <p className="mt-2 font-sc text-xs leading-relaxed text-ink-soft">{desc}</p>
    </button>
  );
}
