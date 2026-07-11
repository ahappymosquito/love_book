"use client";

// Full-screen puppy login stage with mobile-safe framing, high-contrast Liquid Glass controls, restrained motion, token auto-login, and admin entry.

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
    <div className="viewport-guard relative min-h-dvh overflow-hidden">
      <div className="absolute inset-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(255_255_255_/_0.86),transparent_28%),radial-gradient(circle_at_18%_18%,rgb(255_234_238_/_0.38),transparent_24%),linear-gradient(180deg,rgb(255_250_245_/_0.12)_0%,rgb(255_249_243_/_0.08)_38%,rgb(255_249_243_/_0.72)_100%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgb(255_255_255_/_0.16),transparent_24%),radial-gradient(circle_at_18%_18%,rgb(224_132_153_/_0.16),transparent_22%),linear-gradient(180deg,rgb(20_16_19_/_0.18)_0%,rgb(35_27_30_/_0.22)_42%,rgb(27_21_24_/_0.78)_100%)]" />
        <PuppyScene variant="hero" interactive reducedMotionFallback="soft" className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34svh] bg-[linear-gradient(180deg,transparent_0%,rgb(255_249_243_/_0.14)_26%,rgb(255_249_243_/_0.78)_100%)] dark:bg-[linear-gradient(180deg,transparent_0%,rgb(35_27_30_/_0.18)_30%,rgb(27_21_24_/_0.82)_100%)]" />
      </div>

      <div className="relative z-10 flex min-h-dvh w-full max-w-full flex-col px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-[calc(env(safe-area-inset-top,0px)+1rem)] sm:px-6 lg:px-8">
        <div className="flex items-start justify-between">
          <div className="login-brand-chip inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold">
            <Heart className="h-4 w-4 text-rose" fill="currentColor" />
            <span className="font-display">love book</span>
          </div>
        </div>

        <main className="flex flex-1 items-end pb-2 sm:pb-4 lg:items-end lg:pb-[7vh]">
          <motion.section
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="login-floating-panel w-full max-w-[23rem] sm:max-w-[25rem] lg:ml-auto lg:mr-[6vw] xl:mr-[8vw]"
          >
            <div className="mb-6">
              <p className="font-sc text-[11px] font-semibold tracking-[0.04em] text-rose-deep/90">欢迎回家</p>
              <h1 className="mt-2 max-w-[10ch] text-balance font-display text-[2rem] font-bold leading-tight text-ink sm:text-[2.3rem]">
                小狗在等你。
              </h1>
              <p className="mt-3 font-sc text-sm leading-6 text-ink-soft">把口令贴进来，我们就继续今天。</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
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
                className="btn-primary inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[1rem] px-5 py-3.5 font-sc text-[15px] font-medium focus-ring"
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

            <Link
              href="/admin"
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 font-sc text-sm font-medium text-rose-deep transition hover:text-rose focus-ring"
            >
              管理员入口
              <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.section>
        </main>
      </div>
    </div>
  );
}
