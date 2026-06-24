"use client";

// Mobile-first login screen with a dedicated puppy hero stage, token auto-login, admin entry, and a touch-friendly scrapbook access form.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, Heart, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { api, APIError } from "@/lib/api";
import { useAppStore } from "@/lib/store";

const PuppyScene = dynamic(
  () => import("@/components/puppy-scene").then((module) => module.PuppyScene),
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

  const canSubmit = useMemo(() => tokenInput.trim().length > 0 && !submitting, [submitting, tokenInput]);

  const doLogin = useCallback(
    async (nextToken: string, next?: string | null) => {
      setSubmitting(true);
      setToken(nextToken);
      try {
        const me = await api.me();
        setMe(me);
        toast.success(`欢迎回来，${me.user.display_name}`);
        void reportLoginFingerprint();
        router.replace(sanitizeNext(next) || "/timeline");
      } catch (error) {
        setToken(null);
        if (error instanceof APIError && error.status === 401) {
          toast.error(error.message.includes("expired") ? "这个入口 token 已经过期" : "token 不对劲，请确认后再试");
        } else {
          toast.error("登录失败了，请稍后再试");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [router, setMe, setToken],
  );

  async function reportLoginFingerprint() {
    if (typeof window === "undefined") return;
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const screen = `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`;
      await api.recordLogin({
        user_agent: navigator.userAgent,
        locale: navigator.language,
        timezone_name: timeZone,
        screen,
      });
    } catch {
      // 登录记录失败不影响主流程。
    }
  }

  useEffect(() => {
    if (!hydrated || autoRan.current) return;

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const hash = window.location.hash.replace(/^#/, "");
      const hashParams = new URLSearchParams(hash);
      const queryToken = url.searchParams.get("token");
      const hashToken = hashParams.get("token");
      const incomingToken = queryToken || hashToken;
      const nextParam = url.searchParams.get("next") || hashParams.get("next");

      if (incomingToken) {
        autoRan.current = true;
        url.searchParams.delete("token");
        url.searchParams.delete("next");
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
        void doLogin(incomingToken, nextParam);
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
  }, [doLogin, hydrated, router, token]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextToken = tokenInput.trim();
    if (!nextToken) return;
    void doLogin(nextToken);
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgb(255_255_255_/_0.72),transparent_42%),linear-gradient(180deg,rgb(var(--cream))_0%,rgb(253_243_238)_48%,rgb(247_251_246)_100%)] dark:bg-[radial-gradient(circle_at_top,rgb(255_255_255_/_0.12),transparent_38%),linear-gradient(180deg,rgb(var(--cream-deep))_0%,rgb(42_30_35)_54%,rgb(32_44_39)_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-[calc(env(safe-area-inset-top,0px)+0.9rem)] sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/65 bg-surface-raised/84 px-3.5 py-2 text-sm font-semibold text-ink shadow-[0_12px_30px_-24px_rgb(var(--rose)/0.45),inset_0_1px_0_rgba(255,255,255,0.7)]">
            <Heart className="h-4 w-4 text-rose" fill="currentColor" />
            <span className="font-display">love book</span>
          </div>
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/60 bg-surface-raised/78 px-4 py-2 font-sc text-xs font-medium text-rose-deep shadow-[0_10px_24px_-22px_rgb(var(--rose)/0.42)] transition hover:bg-surface-raised focus-ring"
          >
            管理员入口
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </header>

        <main className="flex flex-1 flex-col justify-end py-4 lg:grid lg:grid-cols-[minmax(0,1.18fr)_minmax(380px,460px)] lg:items-stretch lg:gap-6 lg:py-6">
          <section className="login-stage relative min-h-[40svh] overflow-hidden rounded-[2rem] lg:min-h-0 lg:rounded-[2.4rem]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgb(255_255_255_/_0.72),transparent_32%),linear-gradient(180deg,rgb(var(--rose-soft)/0.2),transparent_34%),linear-gradient(180deg,transparent_52%,rgb(var(--cream))/0.62_100%)] dark:bg-[radial-gradient(circle_at_50%_8%,rgb(255_255_255_/_0.14),transparent_34%),linear-gradient(180deg,rgb(var(--rose)/0.14),transparent_38%),linear-gradient(180deg,transparent_50%,rgb(var(--cream-deep))/0.66_100%)]" />
            <PuppyScene
              variant="hero"
              interactive
              reducedMotionFallback="soft"
              className="absolute inset-0"
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 sm:p-5 lg:p-6">
              <div className="login-hero-note ml-auto max-w-[20rem] rounded-[1.6rem] px-4 py-3 text-left">
                <p className="font-sc text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-deep/85">
                  陪你进门
                </p>
                <p className="mt-1 font-display text-lg leading-tight text-ink">
                  轻点一下小狗，它会摇尾巴欢迎你。
                </p>
                <p className="mt-2 font-sc text-xs leading-relaxed text-ink-soft">
                  手机端会把主角留在上半屏，输入区贴近拇指，键盘弹起时也不挤乱布局。
                </p>
              </div>
            </div>
          </section>

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="glass-card mt-4 rounded-[2rem] p-5 sm:p-6 lg:mt-0 lg:self-center lg:rounded-[2.2rem] lg:p-7"
          >
            <div className="mb-6">
              <p className="font-sc text-xs font-semibold text-rose-deep">暖暖小书，只给两个人看</p>
              <h1 className="mt-2 font-display text-[2rem] font-bold leading-tight text-ink sm:text-[2.35rem]">
                把心动和日常，写成一本会陪着长大的小书。
              </h1>
              <p className="mt-3 max-w-md font-sc text-sm leading-relaxed text-ink-soft">
                粘贴对方发来的入口口令，马上回到你们的时间线、纪念日提醒和想一起完成的小计划。
              </p>
            </div>

            <div className="mb-5 flex flex-wrap gap-2">
              <span className="pill inline-flex items-center gap-1.5 bg-rose/12 text-rose-deep">
                <Sparkles className="h-3.5 w-3.5" />
                自动识别链接 token
              </span>
              <span className="pill inline-flex items-center gap-1.5 bg-peach/22 text-ink-soft">
                手机端单手可点
              </span>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="token" className="font-sc text-xs font-medium text-ink-muted">
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
                    onChange={(event) => setTokenInput(event.target.value)}
                    className="input-field min-h-[52px] pr-12 text-base"
                    spellCheck={false}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((value) => !value)}
                    disabled={submitting}
                    aria-label={reveal ? "隐藏 token" : "显示 token"}
                    className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 focus-ring disabled:opacity-50"
                  >
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="btn-primary inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[1.25rem] px-5 py-3.5 font-sc text-[15px] font-medium focus-ring"
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
            </form>

            <div className="mt-5 rounded-[1.25rem] border border-line/60 bg-surface-raised/66 px-4 py-3">
              <p className="font-sc text-xs leading-relaxed text-ink-soft">
                你也可以直接打开带有 <span className="font-semibold text-rose-deep">?token=</span> 或
                <span className="font-semibold text-rose-deep"> #token=</span> 的入口链接，页面会自动帮你登录。
              </p>
            </div>
          </motion.section>
        </main>

        <footer className="pt-3 text-center font-sc text-[11px] text-ink-muted/85">
          © {new Date().getFullYear()} love book，一本只属于两个人的小书。
        </footer>
      </div>
    </div>
  );
}
