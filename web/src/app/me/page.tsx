"use client";

// Profile page for the current paired user to edit avatar, display name, email, and shared anniversary quote pool.

import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Heart, Loader2, Mail, Pencil, RefreshCw, Sparkles, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { AvatarPicker } from "@/components/avatar-picker";
import { TimelineHeader } from "@/components/timeline-header";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { AnniversaryOut, QuoteOut } from "@/lib/types";

function todayDateOnly(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysTogether(startedOn: string, today: string): number {
  const start = new Date(`${startedOn}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function fallbackAnniversary(startedOn: string): AnniversaryOut {
  const today = todayDateOnly();
  return {
    love_started_on: startedOn,
    today,
    days_together: daysTogether(startedOn, today),
    anniversary_items: [],
    love_festival_items: [],
    holiday_items: [],
    message: "今天也把喜欢好好收起来。",
    message_source: "local",
  };
}

export default function MePage() {
  return (
    <AuthGate>
      <MeInner />
    </AuthGate>
  );
}

function MeInner() {
  const me = useAppStore((s) => s.me)!;
  const setMe = useAppStore((s) => s.setMe);
  const [displayName, setDisplayName] = useState(me.user.display_name);
  const [email, setEmail] = useState(me.user.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [anniversary, setAnniversary] = useState<AnniversaryOut>(() => fallbackAnniversary(me.love_started_on));
  const [anniversaryLoading, setAnniversaryLoading] = useState(false);
  const [quotes, setQuotes] = useState<QuoteOut[] | null>(null);
  const [quoteText, setQuoteText] = useState("");
  const [quoteSaving, setQuoteSaving] = useState(false);

  const profileDirty = useMemo(
    () => displayName.trim() !== me.user.display_name || email.trim() !== (me.user.email ?? ""),
    [displayName, email, me.user.display_name, me.user.email],
  );

  useEffect(() => {
    setDisplayName(me.user.display_name);
    setEmail(me.user.email ?? "");
  }, [me.user.display_name, me.user.email]);

  useEffect(() => {
    void loadAnniversary();
    void loadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAnniversary() {
    setAnniversaryLoading(true);
    try {
      setAnniversary(await api.getAnniversary());
    } catch {
      setAnniversary(fallbackAnniversary(me.love_started_on));
    } finally {
      setAnniversaryLoading(false);
    }
  }

  async function loadQuotes() {
    try {
      setQuotes(await api.listQuotes());
    } catch {
      setQuotes([]);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = displayName.trim();
    if (!nextName || savingProfile) return;
    setSavingProfile(true);
    try {
      const updated = await api.patchMe({
        display_name: nextName,
        email: email.trim() || null,
      });
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("资料已保存");
    } finally {
      setSavingProfile(false);
    }
  }

  async function pickAvatar(emoji: string) {
    setAvatarBusy(true);
    try {
      const updated = await api.patchMe({ avatar: emoji });
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("头像已更新");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    try {
      const updated = await api.uploadMyAvatar(file);
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("头像图片已更新");
      setAvatarPickerOpen(false);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function deleteAvatarImage() {
    setAvatarBusy(true);
    try {
      const updated = await api.deleteMyAvatar();
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("头像图片已清除");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = quoteText.trim();
    if (!text || quoteSaving) return;
    setQuoteSaving(true);
    try {
      await api.createQuote(text);
      setQuoteText("");
      toast.success("语录已添加");
      await loadQuotes();
      await loadAnniversary();
    } finally {
      setQuoteSaving(false);
    }
  }

  async function deleteQuote(id: number) {
    await api.deleteQuote(id);
    toast.success("语录已删除");
    await loadQuotes();
    await loadAnniversary();
  }

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader title="我的" />

      <main className="mx-auto max-w-4xl px-4 pt-5 sm:px-6 scroll-pad-bottom">
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card overflow-hidden rounded-3xl p-5 sm:p-6"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <button
                type="button"
                onClick={() => setAvatarPickerOpen(true)}
                className="relative flex-none rounded-full focus-ring"
                aria-label="编辑头像"
              >
                <Avatar user={me.user} size="lg" />
                <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-surface bg-rose text-white shadow-soft">
                  <Pencil className="h-3.5 w-3.5" />
                </span>
              </button>
              <div className="min-w-0">
                <p className="font-sc text-xs font-semibold text-rose-deep">我的小档案</p>
                <h1 className="mt-1 truncate font-display text-2xl font-bold leading-tight text-ink">
                  {me.user.display_name}
                </h1>
                <p className="mt-1 font-sc text-sm text-ink-soft">
                  和 {me.counterpart.display_name} 在一起第 {anniversary.days_together} 天
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadAnniversary()}
              disabled={anniversaryLoading}
              className="btn-ghost inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 font-sc text-sm focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {anniversaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              刷新话语
            </button>
          </div>

          <div className="mt-5 rounded-3xl bg-peach/18 p-4 hairline">
            <div className="mb-2 flex items-center gap-2 text-rose-deep">
              <Heart className="h-4 w-4" />
              <span className="font-sc text-xs font-semibold">纪念日板块话语</span>
            </div>
            <p className="font-sc text-[15px] leading-relaxed text-ink">{anniversary.message}</p>
          </div>
        </motion.section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form onSubmit={saveProfile} className="glass-card rounded-3xl p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-2">
              <UserRound className="h-5 w-5 text-rose-deep" />
              <h2 className="font-display text-xl font-semibold text-ink">资料</h2>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block font-sc text-xs font-medium text-ink-muted">用户名</span>
                <input
                  className="input-field"
                  value={displayName}
                  maxLength={100}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="写一个你喜欢的名字"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 flex items-center gap-1.5 font-sc text-xs font-medium text-ink-muted">
                  <Mail className="h-3.5 w-3.5" />
                  邮箱
                </span>
                <input
                  className="input-field"
                  value={email}
                  maxLength={255}
                  inputMode="email"
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="用于接收提醒邮件"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={!profileDirty || !displayName.trim() || savingProfile}
              className="btn-primary mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 font-sc text-sm font-medium focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存资料
            </button>
          </form>

          <section className="glass-card rounded-3xl p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-rose-deep" />
                <h2 className="font-display text-xl font-semibold text-ink">共享语录</h2>
              </div>
              <span className="pill bg-peach/22 text-ink-soft">{quotes?.length ?? 0} 条</span>
            </div>

            <form onSubmit={createQuote} className="flex gap-2">
              <input
                value={quoteText}
                onChange={(event) => setQuoteText(event.target.value)}
                maxLength={500}
                placeholder="写一句普通日会随机出现的话"
                className="input-field min-w-0 flex-1 text-sm"
              />
              <button
                type="submit"
                disabled={quoteSaving || !quoteText.trim()}
                className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-rose text-white transition hover:bg-rose-deep disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
                aria-label="添加语录"
              >
                {quoteSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
            </form>

            <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {quotes === null ? (
                <p className="rounded-2xl bg-peach/14 px-4 py-3 font-sc text-sm text-ink-muted">正在读取语录...</p>
              ) : quotes.length === 0 ? (
                <p className="rounded-2xl bg-peach/14 px-4 py-3 font-sc text-sm leading-relaxed text-ink-muted">
                  还没有自定义语录，普通日会先使用默认语录。
                </p>
              ) : (
                quotes.map((quote) => (
                  <div key={quote.id} className="flex items-start gap-3 rounded-2xl bg-peach/18 px-4 py-3">
                    <p className="min-w-0 flex-1 break-words font-sc text-sm leading-relaxed text-ink-soft">
                      {quote.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => void deleteQuote(quote.id)}
                      className="grid h-9 w-9 flex-none place-items-center rounded-full text-ink-muted transition hover:bg-white/70 hover:text-rose-deep focus-ring"
                      aria-label="删除语录"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </section>
      </main>

      <AvatarPicker
        open={avatarPickerOpen}
        current={me.user.avatar}
        hasImage={me.user.avatar_has_image}
        uploading={avatarBusy}
        onClose={() => setAvatarPickerOpen(false)}
        onPick={pickAvatar}
        onUpload={uploadAvatar}
        onDeleteImage={deleteAvatarImage}
        title="挑一个属于你的样子"
      />
    </div>
  );
}
