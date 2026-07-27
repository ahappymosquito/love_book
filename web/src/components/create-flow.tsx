"use client";

// Three-way creation chooser shared by the global create Sheet and direct /create page.

import { useState } from "react";
import { ArrowLeft, CalendarHeart, Gift, Sparkles } from "lucide-react";
import { CreateEventForm } from "@/components/create-event-form";
import { ReceivedGiftForm } from "@/components/received-gift-form";
import type { EventDetail } from "@/lib/types";

type CreateKind = "memory" | "offline_meeting" | "gift_received";

export function CreateFlow({ onCreated }: { onCreated: (event: EventDetail) => void }) {
  const [kind, setKind] = useState<CreateKind | null>(null);

  if (kind === "gift_received") {
    return <FlowStep onBack={() => setKind(null)}><ReceivedGiftForm onCreated={onCreated} /></FlowStep>;
  }
  if (kind) {
    return <FlowStep onBack={() => setKind(null)}><CreateEventForm eventKind={kind} onCreated={onCreated} /></FlowStep>;
  }

  const options = [
    {
      value: "memory" as const,
      icon: Sparkles,
      title: "记一件小事",
      description: "日常、想法和值得留住的瞬间。",
      tone: "bg-rose/10 text-rose-deep",
    },
    {
      value: "offline_meeting" as const,
      icon: CalendarHeart,
      title: "记一次见面",
      description: "把一起度过的日期收进见面时间河流。",
      tone: "bg-sage/14 text-ink-soft",
    },
    {
      value: "gift_received" as const,
      icon: Gift,
      title: "记一份收礼",
      description: "记录收到的礼物、感受、评分和照片。",
      tone: "bg-peach/22 text-ink",
    },
  ];

  return (
    <section aria-labelledby="create-kind-title">
      <p className="font-sc text-xs font-semibold text-rose-deep">今天想留下什么</p>
      <h1 id="create-kind-title" className="mt-1 font-display text-2xl font-bold text-ink">记下这一笔</h1>
      <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">先选一种记录，下一步只填写真正需要的内容。</p>
      <div className="mt-6 divide-y divide-line/55 overflow-hidden rounded-2xl bg-surface-raised/88 hairline">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              className="flex min-h-[88px] w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-peach/10 focus-ring sm:px-5"
            >
              <span className={`grid h-11 w-11 flex-none place-items-center rounded-xl ${option.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-base font-semibold text-ink">{option.title}</span>
                <span className="mt-1 block font-sc text-xs leading-relaxed text-ink-muted">{option.description}</span>
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
