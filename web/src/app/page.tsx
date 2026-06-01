"use client";

// Login screen with token auto-login, admin entry, lively 3D puppy background, and bright scrapbook access form.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Heart, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { api, APIError } from "@/lib/api";
import { useAppStore } from "@/lib/store";

const PuppyScene = dynamic(
  () => import("@/components/puppy-scene").then((m) => m.PuppyScene),
  { ssr: false },
);

function sanitizeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return null;
  return decoded;
}

export default function LoginPage() {
  const router = useRouter();
  const { token, hydrated, setToken, setMe } = useAppStore();
  const [tokenInput, setTokenInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const autoRan = useRef(false);

  const doLogin = useCallback(async (t: string, next?: string | null) => {
    setSubmitting(true);
    setToken(t);
    try {
      const me = await api.me();
      setMe(me);
      toast.success(`欢迎回来，${me.user.display_name}`);
      void reportLoginFingerprint();
      const target = sanitizeNext(next) || "/timeline";
      router.replace(target);
    } catch (err) {
      setToken(null);
      if (err instanceof APIError && err.status === 401) {
        toast.error(err.message.includes("expired") ? "这个入口 token 已过期" : "token 不对劲，请确认后再试");
      }
    } finally {
      setSubmitting(false);
    }
  }, [router, setMe, setToken]);

  async function reportLoginFingerprint() {
    if (typeof window === "undefined") return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const screen = `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`;
      await api.recordLogin({
        user_agent: navigator.userAgent,
        locale: navigator.language,
        timezone_name: tz,
        screen,
      });
    } catch {
      // 静默忽略，登录日志不影响主流程
    }
  }

  useEffect(() => {
    if (!hydrated) return;

    if (autoRan.current) return;

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const hash = window.location.hash.replace(/^#/, "");
      const hashParams = new URLSearchParams(hash);
      const queryToken = url.searchParams.get("token");
      const hashToken = hashParams.get("token");
      const incoming = queryToken || hashToken;
      const nextParam = url.searchParams.get("next") || hashParams.get("next");
      if (incoming) {
        autoRan.current = true;
        url.searchParams.delete("token");
        url.searchParams.delete("next");
        const cleanUrl = `${url.pathname}${url.search}`;
        window.history.replaceState(null, "", cleanUrl);
        void doLogin(incoming, nextParam);
        return;
      }

      if (token && nextParam) {
        const target = sanitizeNext(nextParam);
        if (target) {
          router.replace(target);
          return;
        }
      }
    }

    if (token) {
      router.replace("/timeline");
    }
  }, [doLogin, hydrated, token, router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    void doLogin(tokenInput.trim());
  }

  return (
    <div className="relative min-h-dvh w-full overflow-hidden">
      {/* 3D background */}
      <PuppyScene />

      {/* Warm overlay keeps the puppy visible while preserving form contrast. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cream/20 via-cream/35 to-cream/70 dark:from-cream/35 dark:via-cream/55 dark:to-cream/82" />

      {/* Foreground content */}
      <div className="relative z-10 min-h-dvh flex flex-col px-6 pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-[calc(env(safe-area-inset-bottom,0px)+2rem)]">
        <header className="flex items-center justify-between text-ink/85">
          <div className="inline-flex items-center gap-2 rounded-full bg-surface-raised/70 px-3 py-2 font-display text-base font-semibold shadow-soft hairline">
            <Heart className="h-4 w-4 text-rose" fill="currentColor" />
            <span>love · book</span>
          </div>
          <Link
            href="/admin"
            className="rounded-full bg-surface-raised/70 px-3 py-2 font-sc text-xs text-rose-deep transition-colors hover:bg-rose/10 focus-ring hairline"
          >
            管理员入口 →
          </Link>
        </header>

        <div className="flex-1 flex items-center justify-center pt-2 pb-4">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md"
          >
            <div className="mb-6 select-none text-center">
              <p className="mb-2 font-sc text-xs font-semibold text-rose-deep">莓果小书 · 两个人专属</p>
              <h1 className="font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
                我们之间的小事
              </h1>
              <p className="mx-auto mt-3 max-w-sm font-sc text-sm leading-relaxed text-ink-soft">
                把心动、约会和日常小计划，写成热乎乎的一本书。
              </p>
            </div>

            <form
              onSubmit={onSubmit}
              className="glass-card space-y-5 rounded-3xl p-5 sm:p-6"
            >
              <div className="space-y-2">
                <label
                  htmlFor="token"
                  className="font-sc text-xs font-medium text-ink-muted"
                >
                  你的 token
                </label>
                <div className="relative">
                  <input
                    id="token"
                    name="token"
                    type={reveal ? "text" : "password"}
                    autoComplete="one-time-code"
                    inputMode="text"
                    placeholder="粘贴对方发给你的入口口令"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="input-field pr-12 text-base"
                    spellCheck={false}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? "隐藏 token" : "显示 token"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-full hover:bg-ink/5 focus-ring text-ink-soft"
                  >
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !tokenInput.trim()}
                className="btn-primary inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 font-sc text-[15px] font-medium focus-ring"
              >
                {submitting ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    正在翻开小书
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    进入
                  </>
                )}
              </button>

              <p className="px-2 text-center font-sc text-[11px] leading-relaxed text-ink-muted">
                轻轻点一下小狗，它会摇尾巴跟你打招呼。
              </p>
            </form>
          </motion.div>
        </div>

        <footer className="text-center font-sc text-[11px] text-ink-muted/80 pt-2">
          © {new Date().getFullYear()} love · book — 一座两个人的小博物馆
        </footer>
      </div>
    </div>
  );
}
