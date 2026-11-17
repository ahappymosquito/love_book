"use client";

// Three-way creation chooser shared by the global create Sheet and direct /create page: a memory, a meeting, or "送一份礼物" which opens the gift wrapping form.
// 选择一步按内容高度排版：手机是三行紧凑列表，sm 以上是三张并排小卡；onStepChange 让外层窗口在“选择”和“填写”两种尺寸间切换。

import { useState } from "react";
import { ArrowLeft, CalendarHeart, Gift, Sparkles } from "lucide-react";
import { CreateEventForm } from "@/components/create-event-form";
import { GiftWrapForm } from "@/components/gift-wrap-form";
import type { EventDetail } from "@/lib/types";

type CreateKind = "memory" | "offline_meeting" | "gift";

const OPTIONS = [
  {
    value: "memory" as const,
    icon: Sparkles,
    title: "记一件小事",
    description: "日常、想法和想留住的瞬间",
    tone: "bg-rose/10 text-rose-deep",
  },
  {
    value: "offline_meeting" as const,
    icon: CalendarHeart,
    title: "记一次见面",
    description: "把一起度过的日子收进来",
    tone: "bg-sage/16 text-ink-soft",
  },
  {
    value: "gift" as const,
    icon: Gift,
    title: "送一份礼物",
    description: "包好藏起来，等 TA 亲手拆开",
    tone: "bg-peach/24 text-peach-deep",
  },
];

export function CreateFlow({
  onCreated,
  onStepChange,
}: {
  onCreated: (event: EventDetail) => void;
  onStepChange?: (step: "choose" | "form") => void;
}) {
  const [kind, setKindState] = useState<CreateKind | null>(null);

  function setKind(next: CreateKind | null) {
    setKindState(next);
    onStepChange?.(next ? "form" : "choose");
  }

  if (kind === "gift") {
    return <FlowStep onBack={() => setKind(null)}><GiftWrapForm onCreated={onCreated} /></FlowStep>;
  }
  if (kind) {
    return <FlowStep onBack={() => setKind(null)}><CreateEventForm eventKind={kind} onCreated={onCreated} /></FlowStep>;
  }

  return (
    <section aria-labelledby="create-kind-title">
      <div className="pr-12">
        <h1 id="create-kind-title" className="font-display text-xl font-bold text-ink sm:text-2xl">记下这一笔</h1>
        <p className="mt-1 font-sc text-xs text-ink-muted sm:text-sm">今天想留下什么？</p>
      </div>
      <div className="mt-4 grid gap-2 sm:mt-5 sm:grid-cols-3 sm:gap-3">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              className="group flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-line/60 bg-surface-raised/88 px-3 py-2.5 text-left transition hover:border-rose/35 hover:bg-peach/10 active:scale-[0.99] focus-ring sm:min-h-[128px] sm:flex-col sm:items-start sm:justify-between sm:gap-3 sm:p-4"
            >
              <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl transition group-hover:scale-105 ${option.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-[15px] font-semibold text-ink">{option.title}</span>
                <span className="mt-0.5 block font-sc text-xs leading-snug text-ink-muted">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FlowStep({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 font-sc text-sm text-ink-soft transition hover:bg-peach/14 focus-ring">
        <ArrowLeft className="h-4 w-4" />
        重新选择
      </button>
      {children}
    </div>
  );
}
