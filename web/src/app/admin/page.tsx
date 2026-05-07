"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { api, APIError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Avatar } from "@/components/avatar";
import { AvatarPicker } from "@/components/avatar-picker";
import { formatAbsolute, fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { AVATAR_PRESETS, type PairCreated, type PairOut } from "@/lib/types";
import { cn } from "@/lib/cn";

export default function AdminPage() {
  const { adminKey, setAdminKey, logoutAdmin, hydrated } = useAppStore();
  const [keyInput, setKeyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [pairs, setPairs] = useState<PairOut[]>([]);
  const [loadingPairs, setLoadingPairs] = useState(false);
  const [created, setCreated] = useState<PairCreated | null>(null);

  // Form state
  const [aName, setAName] = useState("");
  const [bName, setBName] = useState("");
  const [aAvatar, setAAvatar] = useState<string>(AVATAR_PRESETS[0]);
  const [bAvatar, setBAvatar] = useState<string>(AVATAR_PRESETS[1]);
  const [pickerFor, setPickerFor] = useState<"a" | "b" | null>(null);
  const [tokenExpiryMode, setTokenExpiryMode] = useState<"never" | "custom">("never");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const minimumTokenExpiresAt = toLocalInputValue(new Date(Date.now() + 60_000));

  const refreshPairs = useCallback(async () => {
    setLoadingPairs(true);
    try {
      const list = await api.listPairs();
      setPairs(list);
    } catch (err) {
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
        logoutAdmin();
      }
    } finally {
      setLoadingPairs(false);
    }
  }, [logoutAdmin]);

  useEffect(() => {
    if (!adminKey) return;
    void refreshPairs();
  }, [adminKey, refreshPairs]);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setVerifying(true);
    try {
      await api.verifyAdmin(key);
      setAdminKey(key);
      toast.success("管理身份已验证");
      setKeyInput("");
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        toast.error("admin key 不正确");
      } else {
        toast.error("验证失败，请稍后再试");
      }
    } finally {
      setVerifying(false);
    }
  }

  async function onCreatePair(e: React.FormEvent) {
    e.preventDefault();
    if (!aName.trim() || !bName.trim()) return;
    if (tokenExpiryMode === "custom" && !tokenExpiresAt) return;
    setCreating(true);
    try {
      const result = await api.createPair({
        user_a_display_name: aName.trim(),
        user_b_display_name: bName.trim(),
        user_a_avatar: aAvatar,
        user_b_avatar: bAvatar,
        token_expires_at: tokenExpiryMode === "custom" ? fromLocalInputValue(tokenExpiresAt) : null,
      });
      setCreated(result);
      setAName("");
      setBName("");
      setTokenExpiryMode("never");
      setTokenExpiresAt("");
      toast.success("配对已创建");
      void refreshPairs();
    } catch {
      // toast handled by api
    } finally {
      setCreating(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 已复制`);
    } catch {
      toast.error("复制失败，请手动选择");
    }
  }

  function entryLink(token: string): string {
    if (typeof window === "undefined") return `/?token=${token}`;
    const origin = window.location.origin;
    return `${origin}/?token=${token}`;
  }

  if (!hydrated) {
    return null;
  }

  return (
    <div className="min-h-dvh w-full">
      <header className="sticky top-0 z-30 frosted-bar">
        <div className="max-w-3xl mx-auto px-5 sm:px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-sc text-ink-soft hover:text-rose focus-ring rounded-full px-2 py-1"
            aria-label="返回登录"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <h1 className="font-display text-lg sm:text-xl text-ink">管理控制台</h1>
          {adminKey ? (
            <button
              onClick={() => {
                logoutAdmin();
                toast.success("已退出管理");
              }}
              className="inline-flex items-center gap-1.5 text-sm font-sc text-ink-soft hover:text-rose-deep focus-ring rounded-full px-2 py-1"
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
          ) : (
            <span className="w-14" />
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 py-8 space-y-8">
        <AnimatePresence mode="wait">
          {!adminKey ? (
            <motion.section
              key="auth"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-card rounded-3xl p-6 sm:p-8"
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 grid place-items-center rounded-2xl bg-rose/12 text-rose-deep">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h2 className="font-display text-2xl text-ink">管理员校验</h2>
              </div>
              <p className="font-sc text-sm text-ink-soft mb-5">
                先用 admin key 验证身份，再创建配对。
              </p>

              <form onSubmit={onVerify} className="space-y-4">
                <input
                  type="password"
                  className="input-field"
                  placeholder="admin key"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  disabled={verifying || !keyInput.trim()}
                  className="btn-primary w-full rounded-2xl px-5 py-3.5 font-sc text-[15px] font-medium focus-ring inline-flex items-center justify-center gap-2 min-h-[48px]"
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  验证
                </button>
              </form>
            </motion.section>
          ) : (
            <motion.div
              key="dash"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-8"
            >
              {/* Create pair */}
              <section className="glass-card rounded-3xl p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 grid place-items-center rounded-2xl bg-rose/12 text-rose-deep">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-2xl text-ink">新建配对</h2>
                    <p className="font-sc text-xs text-ink-muted">创建后会得到两条不同的 token</p>
                  </div>
                </div>

                <form onSubmit={onCreatePair} className="space-y-5">
                  <div className="grid sm:grid-cols-2 gap-5">
                    <UserField
                      label="ta 一"
                      value={aName}
                      onChange={setAName}
                      avatar={aAvatar}
                      onPickAvatar={() => setPickerFor("a")}
                      placeholder="例如：阿白"
                    />
                    <UserField
                      label="ta 二"
                      value={bName}
                      onChange={setBName}
                      avatar={bAvatar}
                      onPickAvatar={() => setPickerFor("b")}
                      placeholder="例如：小棕"
                    />
                  </div>

                  <div className="rounded-2xl bg-surface-raised/65 hairline p-4 space-y-3">
                    <div className="flex items-center gap-2 text-ink">
                      <CalendarClock className="h-4 w-4 text-rose-deep" />
                      <span className="font-sc text-sm font-medium">token 有效期</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <label
                        className={cn(
                          "rounded-2xl hairline px-4 py-3 cursor-pointer transition",
                          tokenExpiryMode === "never" ? "bg-rose/10 text-rose-deep" : "bg-cream-deep/30 text-ink-soft",
                        )}
                      >
                        <input
                          type="radio"
                          name="token-expiry"
                          value="never"
                          checked={tokenExpiryMode === "never"}
                          onChange={() => setTokenExpiryMode("never")}
                          className="sr-only"
                        />
                        <span className="font-sc text-sm">永久有效</span>
                        <span className="block font-sc text-xs text-ink-muted mt-1">兼容原有分发方式</span>
                      </label>
                      <label
                        className={cn(
                          "rounded-2xl hairline px-4 py-3 cursor-pointer transition",
                          tokenExpiryMode === "custom" ? "bg-rose/10 text-rose-deep" : "bg-cream-deep/30 text-ink-soft",
                        )}
                      >
                        <input
                          type="radio"
                          name="token-expiry"
                          value="custom"
                          checked={tokenExpiryMode === "custom"}
                          onChange={() => setTokenExpiryMode("custom")}
                          className="sr-only"
                        />
                        <span className="font-sc text-sm">指定过期时间</span>
                        <span className="block font-sc text-xs text-ink-muted mt-1">到期后入口 token 无法继续使用</span>
                      </label>
                    </div>
                    <AnimatePresence>
                      {tokenExpiryMode === "custom" && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: "auto" }}
                          exit={{ opacity: 0, y: -4, height: 0 }}
                          className="overflow-hidden"
                        >
                          <input
                            type="datetime-local"
                            className="input-field"
                            min={minimumTokenExpiresAt}
                            value={tokenExpiresAt}
                            onChange={(e) => setTokenExpiresAt(e.target.value)}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button
                    type="submit"
                    disabled={creating || !aName.trim() || !bName.trim() || (tokenExpiryMode === "custom" && !tokenExpiresAt)}
                    className="btn-primary w-full sm:w-auto rounded-2xl px-6 py-3.5 font-sc text-[15px] font-medium focus-ring inline-flex items-center justify-center gap-2 min-h-[48px]"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    创建配对
                  </button>
                </form>

                {/* Result panel */}
                <AnimatePresence>
                  {created && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: 8, height: 0 }}
                      className="mt-6 overflow-hidden"
                    >
                      <div className="rounded-2xl bg-cream-deep/60 hairline p-5 space-y-4">
                        <div className="flex items-center gap-2 font-sc text-sm text-rose-deep">
                          <Check className="h-4 w-4" />
                          <span>配对已就绪 · pair #{created.pair_id}</span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <TokenCard
                            user={created.user_a}
                            token={created.user_a_token}
                            expiresAt={created.user_a_token_expires_at}
                            link={entryLink(created.user_a_token)}
                            onCopy={copy}
                          />
                          <TokenCard
                            user={created.user_b}
                            token={created.user_b_token}
                            expiresAt={created.user_b_token_expires_at}
                            link={entryLink(created.user_b_token)}
                            onCopy={copy}
                          />
                        </div>
                        <button
                          className="font-sc text-xs text-ink-muted hover:text-rose underline-offset-4 hover:underline"
                          onClick={() => setCreated(null)}
                        >
                          收起
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              {/* List pairs */}
              <section>
                <div className="flex items-center gap-3 mb-4 px-1">
                  <div className="h-9 w-9 grid place-items-center rounded-2xl bg-peach/30 text-rose-deep">
                    <Users className="h-4 w-4" />
                  </div>
                  <h2 className="font-display text-xl text-ink">已发出的配对</h2>
                  <span className="font-sc text-xs text-ink-muted">{pairs.length} 对</span>
                </div>

                {loadingPairs ? (
                  <div className="glass-card rounded-3xl p-10 grid place-items-center">
                    <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
                  </div>
                ) : pairs.length === 0 ? (
                  <div className="glass-card rounded-3xl p-10 text-center font-sc text-sm text-ink-muted">
                    还没有任何配对，先创建一对吧。
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {pairs.map((p) => (
                      <li
                        key={p.pair_id}
                        className="glass-card rounded-3xl p-5 sm:p-6 transition hover:shadow-glow"
                      >
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar emoji={p.user_a.avatar} name={p.user_a.display_name} size="md" />
                            <div className="font-display text-2xl text-rose">·</div>
                            <Avatar emoji={p.user_b.avatar} name={p.user_b.display_name} size="md" />
                            <div className="ml-1 min-w-0">
                              <p className="font-display text-base text-ink truncate">
                                {p.user_a.display_name} <span className="text-rose">&</span>{" "}
                                {p.user_b.display_name}
                              </p>
                              <p className="font-sc text-[11px] text-ink-muted">
                                pair #{p.pair_id} · {formatAbsolute(p.created_at)}
                              </p>
                              <p className={cn("font-sc text-[11px]", tokenExpiryClass(p.user_a_token_expires_at))}>
                                token {formatTokenExpiry(p.user_a_token_expires_at)}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
                            onClick={() => copy(p.user_a_token, `${p.user_a.display_name} 的 token`)}
                          >
                            <Copy className="h-3 w-3" /> {p.user_a.display_name}
                          </button>
                          <button
                            className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
                            onClick={() => copy(p.user_b_token, `${p.user_b.display_name} 的 token`)}
                          >
                            <Copy className="h-3 w-3" /> {p.user_b.display_name}
                          </button>
                          <button
                            className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
                            onClick={() => copy(entryLink(p.user_a_token), `${p.user_a.display_name} 的入口链接`)}
                          >
                            <ArrowRight className="h-3 w-3" /> {p.user_a.display_name}
                          </button>
                          <button
                            className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
                            onClick={() => copy(entryLink(p.user_b_token), `${p.user_b.display_name} 的入口链接`)}
                          >
                            <ArrowRight className="h-3 w-3" /> {p.user_b.display_name}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AvatarPicker
        open={pickerFor === "a"}
        current={aAvatar}
        onClose={() => setPickerFor(null)}
        onPick={(e) => setAAvatar(e)}
        title="选择 ta 一的头像"
      />
      <AvatarPicker
        open={pickerFor === "b"}
        current={bAvatar}
        onClose={() => setPickerFor(null)}
        onPick={(e) => setBAvatar(e)}
        title="选择 ta 二的头像"
      />
    </div>
  );
}

function UserField({
  label,
  value,
  onChange,
  avatar,
  onPickAvatar,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  avatar: string;
  onPickAvatar: () => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <label className="font-sc text-xs font-medium tracking-wider uppercase text-ink-muted">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onPickAvatar}
          className={cn(
            "flex-none h-12 w-12 rounded-2xl text-2xl grid place-items-center hairline bg-surface-raised/70",
            "transition hover:scale-[1.04] focus-ring",
          )}
          aria-label={`${label} 的头像`}
        >
          {avatar}
        </button>
        <input
          type="text"
          className="input-field flex-1"
          value={value}
          maxLength={100}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function TokenCard({
  user,
  token,
  expiresAt,
  link,
  onCopy,
}: {
  user: { display_name: string; avatar: string };
  token: string;
  expiresAt: string | null;
  link: string;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-surface-raised/80 hairline p-4 space-y-3">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar emoji={user.avatar} name={user.display_name} size="sm" />
        <span className="font-display text-base text-ink truncate">
          {user.display_name}
        </span>
      </div>
      <p className="font-mono text-[11px] break-all text-ink-soft bg-cream-deep/40 rounded-xl p-2 leading-relaxed">
        {token}
      </p>
      <p className={cn("font-sc text-[11px]", tokenExpiryClass(expiresAt))}>
        token {formatTokenExpiry(expiresAt)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5"
          onClick={() => onCopy(token, "token")}
        >
          <Copy className="h-3 w-3" />
          复制 token
        </button>
        <button
          className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5"
          onClick={() => onCopy(link, "入口链接")}
        >
          <ArrowRight className="h-3 w-3" />
          复制入口
        </button>
      </div>
    </div>
  );
}

function formatTokenExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "永久有效";
  const date = new Date(expiresAt);
  if (date.getTime() <= Date.now()) return `已于 ${formatAbsolute(date)} 过期`;
  return `有效至 ${formatAbsolute(date)}`;
}

function tokenExpiryClass(expiresAt: string | null): string {
  if (!expiresAt) return "text-emerald-700";
  return new Date(expiresAt).getTime() <= Date.now() ? "text-red-600" : "text-ink-muted";
}
