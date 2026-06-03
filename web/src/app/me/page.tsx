"use client";

// Profile settings page for editing avatar, display name, email, and collapsible shared/default quote libraries.

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Heart,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { AvatarPicker } from "@/components/avatar-picker";
import { TimelineHeader } from "@/components/timeline-header";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { DefaultQuoteOut, QuoteOut } from "@/lib/types";

function todayDateOnly(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysTogether(startedOn: string): number {
  const start = new Date(`${startedOn}T00:00:00`);
  const end = new Date(`${todayDateOnly()}T00:00:00`);
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
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
  const [quotes, setQuotes] = useState<QuoteOut[] | null>(null);
  const [defaultQuotes, setDefaultQuotes] = useState<DefaultQuoteOut[] | null>(null);
  const [quoteText, setQuoteText] = useState("");
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(true);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const togetherDays = useMemo(() => daysTogether(me.love_started_on), [me.love_started_on]);

  const profileDirty = useMemo(
    () => displayName.trim() !== me.user.display_name || email.trim() !== (me.user.email ?? ""),
    [displayName, email, me.user.display_name, me.user.email],
  );

  useEffect(() => {
    setDisplayName(me.user.display_name);
    setEmail(me.user.email ?? "");
  }, [me.user.display_name, me.user.email]);

  useEffect(() => {
    void loadQuotes();
    void loadDefaultQuotes();
  }, []);

  async function loadQuotes() {
    try {
      setQuotes(await api.listQuotes());
    } catch {
      setQuotes([]);
    }
  }

  async function loadDefaultQuotes() {
    try {
      setDefaultQuotes(await api.listDefaultQuotes());
    } catch {
      setDefaultQuotes([]);
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
      setSharedOpen(true);
    } finally {
      setQuoteSaving(false);
    }
  }

  async function deleteQuote(id: number) {
    await api.deleteQuote(id);
    toast.success("语录已删除");
    await loadQuotes();
  }

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader title="设置" />

      <main className="mx-auto max-w-4xl px-4 pt-5 sm:px-6 scroll-pad-bottom">
        <motion.form
          onSubmit={saveProfile}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card overflow-hidden rounded-3xl p-5 sm:p-6"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
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
                  和 {me.counterpart.display_name} 在一起第 {togetherDays} 天
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-peach/18 px-3 py-2 font-sc text-xs text-ink-soft hairline">
              <Settings className="h-3.5 w-3.5 text-rose-deep" />
              头像、昵称和邮箱都在这里改
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
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

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-sc text-xs leading-relaxed text-ink-muted">
              邮箱留空会关闭邮件提醒地址，头像图片会按私有媒体保存。
            </p>
            <button
              type="submit"
              disabled={!profileDirty || !displayName.trim() || savingProfile}
              className="btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-sc text-sm font-medium focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存资料
            </button>
          </div>
        </motion.form>

        <section className="mt-5 glass-card overflow-hidden rounded-3xl">
          <QuotePanelHeader
            title="共享语录"
            description="你们自己写下的话会优先加入普通日随机池。"
            icon={<Sparkles className="h-5 w-5 text-rose-deep" />}
            count={quotes?.length ?? 0}
            open={sharedOpen}
            onToggle={() => setSharedOpen((value) => !value)}
          />
          {sharedOpen && (
            <div className="border-t border-line/60 p-5 sm:p-6">
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
                  {quoteSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </button>
              </form>

              <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {quotes === null ? (
                  <QuoteMessage>正在读取共享语录...</QuoteMessage>
                ) : quotes.length === 0 ? (
                  <QuoteMessage>还没有自定义语录，普通日会先使用默认语录。</QuoteMessage>
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
            </div>
          )}

          <QuotePanelHeader
            title="默认语录"
            description="系统兜底语录只读展示，会排在你们自己的语录下面。"
            icon={<Heart className="h-5 w-5 text-rose-deep" />}
            count={defaultQuotes?.length ?? 0}
            open={defaultsOpen}
            onToggle={() => setDefaultsOpen((value) => !value)}
            separated
          />
          {defaultsOpen && (
            <div className="border-t border-line/60 p-5 sm:p-6">
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {defaultQuotes === null ? (
                  <QuoteMessage>正在读取默认语录...</QuoteMessage>
                ) : defaultQuotes.length === 0 ? (
                  <QuoteMessage>暂时没有默认语录。</QuoteMessage>
                ) : (
                  defaultQuotes.map((quote) => (
                    <p
                      key={quote.id}
                      className="break-words rounded-2xl bg-sage/12 px-4 py-3 font-sc text-sm leading-relaxed text-ink-soft"
                    >
                      {quote.text}
                    </p>
                  ))
                )}
              </div>
            </div>
          )}
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

function QuotePanelHeader({
  title,
  description,
  icon,
  count,
  open,
  onToggle,
  separated = false,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  separated?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/45 focus-ring sm:px-6 ${
        separated ? "border-t border-line/60" : ""
      }`}
      aria-expanded={open}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-2xl bg-peach/22">{icon}</span>
        <span className="min-w-0">
          <span className="block font-display text-lg font-semibold leading-tight text-ink">{title}</span>
          <span className="mt-1 block font-sc text-xs leading-relaxed text-ink-muted">{description}</span>
        </span>
      </span>
      <span className="flex flex-none items-center gap-2">
        <span className="pill bg-peach/22 text-ink-soft">{count} 条</span>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-rose/10 text-rose-deep">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </span>
    </button>
  );
}

function QuoteMessage({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-peach/14 px-4 py-3 font-sc text-sm leading-relaxed text-ink-muted">{children}</p>;
}
