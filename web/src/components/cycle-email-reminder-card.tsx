"use client";

// Pair-shared cycle email reminder setting: on/off, recipient (partner by default, or myself), and how many days ahead; each change saves immediately.
// Shows a hint when the recipient has no email and the approximate day the next reminder will arrive; the server sends it once per predicted period at 9:00.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";
import type { CycleReminderSettingOut } from "@/lib/types";

const DAY_OPTIONS = [1, 2, 3, 5, 7];

function monthDay(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}月${d}日`;
}

export function CycleEmailReminderCard({ refreshKey }: { refreshKey?: string | null }) {
  const me = useAppStore((state) => state.me);
  const [setting, setSetting] = useState<CycleReminderSettingOut | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSetting(await api.getCycleReminder());
    } catch {
      setSetting(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!me || !setting) return null;

  const recipientId = setting.recipient_user_id ?? me.counterpart.id;
  const toSelf = recipientId === me.user.id;
  const partnerName = me.counterpart.display_name || "TA";

  async function save(next: { enabled?: boolean; days_before?: number; recipient_user_id?: number }) {
    if (!setting || saving) return;
    setSaving(true);
    try {
      setSetting(
        await api.updateCycleReminder({
          enabled: next.enabled ?? setting.enabled,
          days_before: next.days_before ?? setting.days_before,
          recipient_user_id: next.recipient_user_id ?? recipientId,
        }),
      );
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-rose/14 text-rose-deep">
          <Mail className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-display text-lg font-semibold leading-tight text-ink">邮件提醒</p>
            <button
              type="button"
              role="switch"
              aria-checked={setting.enabled}
              aria-label="邮件提醒"
              disabled={saving}
              onClick={() => void save({ enabled: !setting.enabled })}
              className={cn(
                "relative h-8 w-14 flex-none rounded-full transition-colors disabled:opacity-60 focus-ring",
                setting.enabled ? "bg-rose" : "bg-line/80",
              )}
            >
              <span className={cn("absolute top-1 grid h-6 w-6 place-items-center rounded-full bg-white shadow-sm transition-all", setting.enabled ? "left-7" : "left-1")}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />}
              </span>
            </button>
          </div>
          <p className="mt-1 font-sc text-sm leading-relaxed text-ink-soft">
            生理期快到的时候，早上发一封邮件给{toSelf ? "自己" : partnerName}，提前照顾好身体。
          </p>
        </div>
      </div>

      {setting.enabled && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 flex-none font-sc text-sm text-ink-soft">发给</span>
            {[
              { id: me.counterpart.id, label: partnerName },
              { id: me.user.id, label: "我自己" },
            ].map((option) => (
              <button key={option.id} type="button" aria-pressed={recipientId === option.id} disabled={saving}
                onClick={() => recipientId !== option.id && void save({ recipient_user_id: option.id })}
                className={cn(
                  "min-h-10 rounded-full border px-4 font-sc text-sm transition focus-ring",
                  recipientId === option.id ? "border-rose/40 bg-rose/12 text-rose-deep" : "border-line/70 text-ink-soft hover:border-rose/30",
                )}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 flex-none font-sc text-sm text-ink-soft">提前</span>
            {DAY_OPTIONS.map((days) => (
              <button key={days} type="button" aria-pressed={setting.days_before === days} disabled={saving}
                onClick={() => setting.days_before !== days && void save({ days_before: days })}
                className={cn(
                  "min-h-10 min-w-12 rounded-full border px-3 font-sc text-sm transition focus-ring",
                  setting.days_before === days ? "border-rose/40 bg-rose/12 text-rose-deep" : "border-line/70 text-ink-soft hover:border-rose/30",
                )}>
                {days} 天
              </button>
            ))}
          </div>
          {!setting.recipient_has_email ? (
            <p className="rounded-xl bg-peach/18 px-3 py-2 font-sc text-sm text-ink-soft">
              {toSelf ? "你还没有填邮箱，在「我的」里补上就能收到。" : `${partnerName}还没有填邮箱，补上之后才能收到。`}
            </p>
          ) : setting.next_send_on ? (
            <p className="font-sc text-sm text-ink-muted">下一封大约在 {monthDay(setting.next_send_on)} 早上 9 点送到{toSelf ? "你" : partnerName}的邮箱。</p>
          ) : (
            <p className="font-sc text-sm text-ink-muted">记下经期之后，才能算出什么时候提醒。</p>
          )}
        </div>
      )}
    </Card>
  );
}
