"use client";

// Responsive Love Book login with an immediate solid form, state-linked interactive sunset meadow, safe token auto-login, and accessible inline recovery.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, Heart, LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { PuppySceneMood } from "@/components/puppy-scene";
import { GlassSurface } from "@/components/ui/glass-surface";
import { api, APIError } from "@/lib/api";
import { useAppStore } from "@/lib/store";

const PuppyScene = dynamic(
  () => import("@/components/puppy-scene").then((module) => module.PuppyScene),
  { ssr: false, loading: () => null },
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

function getLoginError(error: unknown) {
  if (error instanceof APIError && error.status === 401) {
    return error.message.includes("expired")
      ? "这个入口口令已过期，请联系对方获取新的入口链接。"
      : "这个入口口令不正确，请检查是否完整粘贴后再试。";
  }
  if (error instanceof APIError && error.status === 0) {
    return "暂时无法连接 Love Book，请检查网络后重试。";
  }
  return "暂时无法登录，请稍后再试。";
}

export default function LoginPage() {
  const router = useRouter();
  const { token, hydrated, setToken, setMe } = useAppStore();
  const [tokenInput, setTokenInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [loginSucceeded, setLoginSucceeded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const autoRan = useRef(false);

  const canSubmit = useMemo(() => tokenInput.trim().length > 0 && !submitting, [submitting, tokenInput]);
  const sceneMood: PuppySceneMood = loginSucceeded
    ? "success"
    : submitting
      ? "submitting"
      : loginError
        ? "error"
        : inputFocused
          ? "focused"
          : "idle";
  const markSceneReady = useCallback(() => setSceneReady(true), []);

  const doLogin = useCallback(
    async (nextToken: string, next?: string | null) => {
      setSubmitting(true);
      setLoginError(null);
      setLoginSucceeded(false);
      setToken(nextToken);
      try {
        const me = await api.me({ silent: true });
        setMe(me);
        setLoginSucceeded(true);
        toast.success(`欢迎回来，${me.user.display_name}`);
        void reportLoginFingerprint();
        router.replace(sanitizeNext(next) || "/timeline");
      } catch (error) {
        setToken(null);
        setLoginError(getLoginError(error));
      } finally {
        setSubmitting(false);
      }
    },
    [router, setMe, setToken],
  );

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

      if (token && !submitting && nextParam) {
        const target = sanitizeNext(nextParam);
        if (target) {
          router.replace(target);
          return;
        }
      }
    }

    if (token && !submitting) router.replace("/timeline");
  }, [doLogin, hydrated, router, submitting, token]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextToken = tokenInput.trim();
    if (!nextToken) {
      setLoginError("请先粘贴入口口令。");
      return;
    }
    void doLogin(nextToken);
  }

  return (
    <div className="login-shell viewport-guard" data-login-mood={sceneMood}>
      <div className={`login-scene-layer ${sceneReady ? "is-ready" : ""}`} aria-hidden="true">
        <div className="login-scene-placeholder" />
        <PuppyScene
          variant="hero"
          interactive
          reducedMotionFallback="soft"
          mood={sceneMood}
          onReady={markSceneReady}
        />
      </div>

      <div className="login-submit-flight" aria-hidden="true">
        <span />
      </div>

      <div className="login-content">
        <header className="login-brand-row">
          <GlassSurface variant="clear" shape="capsule" className="login-brand-chip inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold">
            <Heart className="h-4 w-4 text-rose" fill="currentColor" aria-hidden="true" />
            <span className="font-display">love book</span>
          </GlassSurface>
        </header>

        <main className="login-main">
          <section className="login-floating-panel w-full max-w-[25rem]" aria-labelledby="login-title">
            <div className="mb-6">
              <p className="font-sc text-xs font-semibold text-rose-deep">欢迎回家</p>
              <h1 id="login-title" className="mt-2 max-w-[10ch] text-balance font-display text-[2rem] font-bold leading-tight text-ink sm:text-[2.25rem]">
                小狗在等你。
              </h1>
              <p className="mt-3 font-sc text-base leading-6 text-ink-soft">把口令贴进来，我们就继续今天。</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate aria-busy={submitting}>
              <div className="space-y-2">
                <label htmlFor="token" className="font-sc text-sm font-medium text-ink-soft">
                  入口口令
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
                    onChange={(event) => {
                      setTokenInput(event.target.value);
                      if (loginError) setLoginError(null);
                    }}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    className={`input-field min-h-[52px] pr-14 text-base ${loginError ? "login-input-error" : ""}`}
                    aria-invalid={Boolean(loginError)}
                    aria-describedby={loginError ? "token-error" : undefined}
                    spellCheck={false}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((value) => !value)}
                    disabled={submitting}
                    aria-label={reveal ? "隐藏入口口令" : "显示入口口令"}
                    className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-ink-soft transition-colors hover:bg-ink/5 active:bg-ink/10 focus-ring disabled:opacity-50"
                  >
                    {reveal ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                {loginError ? (
                  <p id="token-error" role="alert" className="login-inline-error font-sc text-sm leading-5">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{loginError}</span>
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="login-submit-button btn-primary inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[1rem] px-5 py-3.5 font-sc text-base font-semibold focus-ring"
              >
                {submitting ? (
                  <>
                    <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                    正在翻开小书
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    进入
                  </>
                )}
              </button>
            </form>

            <Link
              href="/admin"
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 font-sc text-sm font-medium text-rose-deep transition-colors hover:text-rose active:text-rose focus-ring"
            >
              管理员入口
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}
