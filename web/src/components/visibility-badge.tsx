"use client";

// 时间线可见方式与提交状态小标签：公开记录只显示一次"立即可见"，双方提交后可见的记录再显示等待 / 已解锁状态，文字保持可读对比度。

import { Eye, Lock, Sparkles, Hourglass } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SubmissionState, VisibilityMode } from "@/lib/types";

export function VisibilityBadge({ mode }: { mode: VisibilityMode }) {
  const isPublic = mode === "public";
  return (
    <span
      className={cn(
        "pill inline-flex items-center gap-1.5",
        isPublic
          ? "bg-sage/18 text-ink-soft"
          : "bg-peach/28 text-rose-deep",
      )}
    >
      {isPublic ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      {isPublic ? "立即可见" : "双方提交后可见"}
    </span>
  );
}

export function SubmissionBadge({
  state,
  mode,
}: {
  state: SubmissionState;
  mode: VisibilityMode;
}) {
  if (mode === "public") return null;
  if (state.unlocked) {
    return (
      <span className="pill inline-flex items-center gap-1.5 bg-sage/18 text-ink-soft">
        <Sparkles className="h-3 w-3" />
        已解锁
      </span>
    );
  }
  const total =
    Number(state.current_user_submitted) + Number(state.counterpart_submitted);
  return (
    <span className="pill inline-flex items-center gap-1.5 bg-peach/18 text-ink-soft">
      <Hourglass className="h-3 w-3" />
      {total === 0 ? "等待双方" : "等待对方提交"}
    </span>
  );
}
