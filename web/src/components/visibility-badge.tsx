"use client";

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
          ? "bg-sage/15 text-sage"
          : "bg-rose/12 text-rose-deep dark:text-rose",
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
  if (mode === "public") {
    return (
      <span className="pill inline-flex items-center gap-1.5 bg-peach/25 text-rose-deep dark:bg-rose-soft/30 dark:text-rose">
        <Sparkles className="h-3 w-3" />
        随时可见
      </span>
    );
  }
  if (state.unlocked) {
    return (
      <span className="pill inline-flex items-center gap-1.5 bg-sage/15 text-sage">
        <Sparkles className="h-3 w-3" />
        已解锁
      </span>
    );
  }
  const total =
    Number(state.current_user_submitted) + Number(state.counterpart_submitted);
  return (
    <span className="pill inline-flex items-center gap-1.5 bg-ink/5 text-ink-soft">
      <Hourglass className="h-3 w-3" />
      {total === 0 ? "等待双方" : "等待对方提交"}
    </span>
  );
}
