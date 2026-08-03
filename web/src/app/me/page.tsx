"use client";

// Grouped settings surface for identity, location, shared quotes, security-password access, and logout.

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LocateFixed,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { AvatarPicker } from "@/components/avatar-picker";
import { TimelineHeader } from "@/components/timeline-header";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { DefaultQuoteOut, QuoteOut, SecurityPasswordOut } from "@/lib/types";

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
  const router = useRouter();
  const me = useAppStore((s) => s.me)!;
  const setMe = useAppStore((s) => s.setMe);
  const logout = useAppStore((s) => s.logout);
  const setToken = useAppStore((s) => s.setToken);
  const [displayName, setDisplayName] = useState(me.user.display_name);
  const [email, setEmail] = useState(me.user.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [locationAddress, setLocationAddress] = useState(me.user.location_address ?? "");
  const [locationCity, setLocationCity] = useState(me.user.location_city ?? "");
  const [savingLocation, setSavingLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const [quotes, setQuotes] = useState<QuoteOut[] | null>(null);
  const [defaultQuotes, setDefaultQuotes] = useState<DefaultQuoteOut[] | null>(null);
  const [quoteText, setQuoteText] = useState("");
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(true);
  const [security, setSecurity] = useState<SecurityPasswordOut | null>(null);
  const [loginName, setLoginName] = useState("");
  const [securityPassword, setSecurityPassword] = useState("");
  const [confirmSecurityPassword, setConfirmSecurityPassword] = useState("");
  const [securityReveal, setSecurityReveal] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
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
    setLocationAddress(me.user.location_address ?? "");
    setLocationCity(me.user.location_city ?? "");
  }, [me.user.location_address, me.user.location_city]);

  useEffect(() => {
    void loadQuotes();
    void loadDefaultQuotes();
    void loadSecurityPassword();
  }, []);

  async function loadSecurityPassword() {
    try {
      const current = await api.getSecurityPassword();
      setSecurity(current);
      setLoginName(current.login_name ?? "");
    } catch {
      setSecurity(null);
    }
  }

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
      setEditingProfile(false);
      toast.success("资料已保存");
    } finally {
      setSavingProfile(false);
    }
  }

  function cancelProfileEdit() {
    setDisplayName(me.user.display_name);
    setEmail(me.user.email ?? "");
    setEditingProfile(false);
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

  async function saveManualLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = locationAddress.trim();
    if (!address || savingLocation) return;
    setSavingLocation(true);
    try {
      const updated = await api.patchMyLocation({
        address,
        city: locationCity.trim() || null,
      });
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("常用位置已保存");
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error("当前浏览器不支持定位，可以手动输入位置");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const coords = `${position.coords.longitude},${position.coords.latitude}`;
            const updated = await api.patchMyLocation({ coords });
            setMe({ ...me, user: { ...me.user, ...updated } });
            toast.success("当前位置已保存");
          } finally {
            setLocating(false);
          }
        })();
      },
      () => {
        setLocating(false);
        toast.error("定位未授权，可以手动输入位置");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function clearLocation() {
    setSavingLocation(true);
    try {
      const updated = await api.deleteMyLocation();
      setMe({ ...me, user: { ...me.user, ...updated } });
      setLocationAddress("");
      setLocationCity("");
      toast.success("常用位置已清除");
    } finally {
      setSavingLocation(false);
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

  async function saveSecurityPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingSecurity) return;
    const normalizedName = loginName.trim();
    if (normalizedName.length < 3) {
      toast.error("登录名至少需要 3 个字符");
      return;
    }
    if (securityPassword.length < 15) {
      toast.error("安全密码至少需要 15 个字符");
      return;
    }
    if (securityPassword !== confirmSecurityPassword) {
      toast.error("两次输入的安全密码不一致");
      return;
    }
    setSavingSecurity(true);
    try {
      const result = await api.updateSecurityPassword({ login_name: normalizedName, password: securityPassword });
      setToken(result.access_token);
      setSecurity(result.security);
      setLoginName(result.security.login_name ?? normalizedName);
      setSecurityPassword("");
      setConfirmSecurityPassword("");
      toast.success(security?.configured ? "安全密码已重置" : "安全密码已设置");
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "安全密码保存失败，请稍后再试";
      toast.error(message);
    } finally {
      setSavingSecurity(false);
    }
  }

  function handleLogout() {
    logout();
    toast.success("已退出，期待再见");
    router.replace("/");
  }

  return (
    <div className="viewport-guard min-h-dvh w-full">
      <TimelineHeader title="设置" />

      <main className="mx-auto w-full max-w-4xl min-w-0 px-4 pt-5 sm:px-6 scroll-pad-bottom">
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="content-surface overflow-hidden p-4 sm:p-5"
        >
          <div className="flex min-w-0 items-start gap-4">
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
            <div className="min-w-0 flex-1">
              <p className="font-sc text-xs font-semibold text-rose-deep">我的小档案</p>
              {editingProfile ? (
                <form onSubmit={saveProfile} className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <label className="min-w-0">
                    <span className="sr-only">用户名</span>
                    <input
                      className="input-field py-2.5 text-sm"
                      value={displayName}
                      maxLength={100}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="写一个你喜欢的名字"
                      required
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="sr-only">邮箱</span>
                    <input
                      className="input-field py-2.5 text-sm"
                      value={email}
                      maxLength={255}
                      inputMode="email"
                      autoComplete="email"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="用于接收提醒邮件"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={!profileDirty || !displayName.trim() || savingProfile}
                      className="btn-primary inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl px-4 font-sc text-sm font-medium focus-ring disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                    >
                      {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelProfileEdit}
                      disabled={savingProfile}
                      className="btn-ghost grid h-11 w-11 flex-none place-items-center rounded-2xl focus-ring"
                      aria-label="取消编辑"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingProfile(true)}
                  className="mt-1 block w-full min-w-0 rounded-2xl py-1 text-left transition hover:bg-peach/14 focus-ring"
                  aria-label="编辑用户名和邮箱"
                >
                  <h1 className="truncate font-display text-2xl font-bold leading-tight text-ink">
                    {me.user.display_name}
                  </h1>
                  <p className="mt-1 flex min-w-0 items-center gap-1.5 font-sc text-sm text-ink-soft">
                    <Mail className="h-3.5 w-3.5 flex-none" />
                    <span className="truncate">{me.user.email || "未设置邮箱"}</span>
                  </p>
                </button>
              )}
              <p className="mt-1 font-sc text-sm text-ink-soft">和 {me.counterpart.display_name} 在一起第 {togetherDays} 天</p>
            </div>
          </div>
        </motion.section>

        <section className="settings-group mt-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-2xl bg-peach/20 text-rose-deep">
              <MapPin className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-semibold text-ink">常用位置</h2>
              <p className="mt-1 font-sc text-sm text-ink-muted">
                {me.user.location_coords
                  ? `${me.user.location_label || me.user.location_address || "已保存位置"}${me.user.location_city ? ` · ${me.user.location_city}` : ""}`
                  : "用于 Todo 搜索时优先返回附近的餐馆和住宿"}
              </p>
              {me.user.location_address && (
                <p className="mt-1 break-words font-sc text-xs text-ink-soft">{me.user.location_address}</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCurrentLocation()}
              disabled={locating || savingLocation}
              className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:opacity-50"
            >
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
              使用当前位置
            </button>
            {me.user.location_coords && (
              <button
                type="button"
                onClick={() => void clearLocation()}
                disabled={savingLocation || locating}
                className="btn-ghost min-h-11 rounded-2xl px-4 font-sc text-sm focus-ring disabled:opacity-50"
              >
                清除位置
              </button>
            )}
          </div>

          <form onSubmit={saveManualLocation} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
            <input
              className="input-field text-sm"
              value={locationAddress}
              onChange={(event) => setLocationAddress(event.target.value)}
              placeholder="输入常用地址或地标"
              maxLength={500}
            />
            <input
              className="input-field text-sm"
              value={locationCity}
              onChange={(event) => setLocationCity(event.target.value)}
              placeholder="城市，可选"
              maxLength={100}
            />
            <button
              type="submit"
              disabled={!locationAddress.trim() || savingLocation || locating}
              className="btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:opacity-50"
            >
              {savingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存位置
            </button>
          </form>
        </section>

        <section className="settings-group mt-5 overflow-hidden">
          <QuotePanelHeader
            title="共享语录"
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

              <div className="mt-4 grid max-h-[320px] gap-2 overflow-y-auto pr-1">
                {quotes === null ? (
                  <QuoteMessage>正在读取共享语录...</QuoteMessage>
                ) : quotes.length === 0 ? (
                  <QuoteMessage>还没有自定义语录。</QuoteMessage>
                ) : (
                  quotes.map((quote) => (
                    <div key={quote.id} className="settings-row flex w-full items-start gap-3 px-4 py-3">
                      <p className="min-w-0 flex-1 break-words font-sc text-sm leading-relaxed text-ink">
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

                {defaultQuotes === null ? (
                  <QuoteMessage>正在读取默认语录...</QuoteMessage>
                ) : (
                  defaultQuotes.map((quote) => (
                    <p
                      key={quote.id}
                      className="settings-row w-full break-words px-4 py-3 font-sc text-sm leading-relaxed text-ink-soft"
                    >
                      {quote.text}
                    </p>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        <section className="settings-group mt-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-peach/22 text-rose-deep"><KeyRound className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">登录与账号</h2>
              <p className="mt-1 font-sc text-sm leading-6 text-ink-muted">设置一个好记的登录名和安全密码，入口链接仍然可以继续使用。</p>
            </div>
          </div>

          <form onSubmit={saveSecurityPassword} className="mt-5 grid gap-3" noValidate>
            {security?.configured ? (
              <div className="settings-row flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-sc text-xs text-ink-muted">当前登录名</p>
                  <p className="mt-1 break-all font-sc text-sm font-semibold text-ink">{security.login_name}</p>
                  {security.password_updated_at ? <p className="mt-1 font-sc text-xs text-ink-muted">更新于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(security.password_updated_at))}</p> : null}
                </div>
                <span className="pill bg-sage/18 text-ink-soft">已设置</span>
              </div>
            ) : null}
            <label>
              <span className="font-sc text-sm font-medium text-ink-soft">登录名</span>
              <input className="input-field mt-1 min-h-12 text-base" value={loginName} onChange={(event) => setLoginName(event.target.value)} minLength={3} maxLength={32} autoComplete="username" placeholder="3–32 个字符" required />
            </label>
            <label>
              <span className="font-sc text-sm font-medium text-ink-soft">{security?.configured ? "新安全密码" : "安全密码"}</span>
              <span className="relative mt-1 block"><input className="input-field min-h-12 pr-12 text-base" type={securityReveal ? "text" : "password"} value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} minLength={15} maxLength={128} autoComplete="new-password" placeholder="至少 15 个字符" required /><button type="button" onClick={() => setSecurityReveal((value) => !value)} className="login-reveal focus-ring" aria-label={securityReveal ? "隐藏安全密码" : "显示安全密码"}>{securityReveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
            </label>
            <label>
              <span className="font-sc text-sm font-medium text-ink-soft">确认安全密码</span>
              <input className="input-field mt-1 min-h-12 text-base" type={securityReveal ? "text" : "password"} value={confirmSecurityPassword} onChange={(event) => setConfirmSecurityPassword(event.target.value)} minLength={15} maxLength={128} autoComplete="new-password" required />
            </label>
            <button type="submit" disabled={savingSecurity || !loginName.trim() || securityPassword.length < 15 || securityPassword !== confirmSecurityPassword} className="btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-sc text-sm font-semibold focus-ring disabled:opacity-50">
              {savingSecurity ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {security?.configured ? "重置安全密码" : "设置安全密码"}
            </button>
          </form>

          <div className="mt-6 border-t border-line/60 pt-5">
            <p className="font-sc text-sm text-ink-muted">退出后，可以使用安全密码或专属入口再次登录。</p>
          <button
            type="button"
            onClick={handleLogout}
            className="btn-ghost mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-sc text-sm text-rose-deep focus-ring"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
          </div>
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
  icon,
  count,
  open,
  onToggle,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/45 focus-ring sm:px-6"
      aria-expanded={open}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-2xl bg-peach/22">{icon}</span>
        <span className="min-w-0">
          <span className="block font-display text-lg font-semibold leading-tight text-ink">{title}</span>
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
  return <p className="w-full rounded-2xl bg-peach/14 px-4 py-3 font-sc text-sm leading-relaxed text-ink-muted hairline">{children}</p>;
}
