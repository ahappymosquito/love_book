"use client";

// Event creation form with lively scrapbook inputs, date selection, visibility controls, and authenticated submission.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { CalendarHeart, Eye, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { TimelineHeader } from "@/components/timeline-header";
import { api } from "@/lib/api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import type { VisibilityMode } from "@/lib/types";
import { cn } from "@/lib/cn";

export default function CreatePage() {
  return (
    <AuthGate>
      <CreateInner />
    </AuthGate>
  );
}

function CreateInner() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState<string>(toLocalInputValue(new Date()));
  const [visibility, setVisibility] = useState<VisibilityMode>("public");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const evt = await api.createEvent({
        title: title.trim(),
        description: description.trim() || null,
        occurred_at: occurredAt ? fromLocalInputValue(occurredAt) : null,
        visibility_mode: visibility,
      });
      toast.success("已记下这一笔");
      router.replace(`/timeline/${evt.id}`);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader back={{ href: "/timeline" }} title="记一笔" />

      <div className="mx-auto max-w-2xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+3rem)] pt-6 sm:px-6">
        <motion.form
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card space-y-6 rounded-3xl p-5 sm:p-6"
        >
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
            <Label icon={<CalendarHeart className="h-3.5 w-3.5" />}>发生时间</Label>
            <div className="relative">
              <input
                type="datetime-local"
                className="input-field font-sc"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
            <p className="font-sc text-[11px] text-ink-muted">
              留空就用此刻；选过去也行。
            </p>
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

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={!title.trim() || submitting}
            className="btn-primary inline-flex min-h-[48px] items-center gap-2 rounded-2xl px-6 py-3.5 font-sc text-[15px] font-medium focus-ring"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              收藏起来
            </button>
          </div>
        </motion.form>
      </div>
    </div>
  );
}

function Label({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 font-sc text-xs font-medium text-ink-muted">
      {icon}
      {children}
    </label>
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
        active
          ? "bg-peach/24 ring-2 ring-rose/35"
          : "bg-surface-raised/85 hover:bg-peach/14",
      )}
    >
      <div className="flex items-center gap-2 font-sc text-sm font-medium text-ink">
        <span
          className={cn(
            "h-7 w-7 grid place-items-center rounded-full",
            active ? "bg-rose text-white" : "bg-peach/24 text-rose-deep",
          )}
        >
          {icon}
        </span>
        {title}
      </div>
      <p className="mt-2 font-sc text-xs leading-relaxed text-ink-soft">{desc}</p>
    </button>
  );
}
