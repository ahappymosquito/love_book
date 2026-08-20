"use client";

// 无 token 时全屏代码花田加开始弹窗；有 token 或入口口令时直接进入，不挂游戏。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ChevronLeft, Eye, EyeOff, Heart, KeyRound, ListOrdered, LoaderCircle, LogIn, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/loading-screen";
import { XiaohuaRunner, type XiaohuaRunnerHandle } from "@/components/xiaohua-runner";
import { api, APIError } from "@/lib/api";
import { RUNNER_CHAPTER_LABELS } from "@/lib/xiaohua-runner";
import { useAppStore } from "@/lib/store";
import type { GameLeaderboardOut } from "@/lib/types";

type LoginMethod = "password" | "token";
type Overlay = "menu" | "login" | "leaderboard" | "over" | "score" | null;
type Gate = "wait" | "play" | "enter";

const PLAYER_NAME_KEY = "love-book:runner-player-name";

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
    await api.recordLogin({
      user_agent: navigator.userAgent,
      locale: navigator.language,
      timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`,
    });
  } catch {
    // Login telemetry must never block entry.
  }
}

function loginErrorMessage(error: unknown, method: LoginMethod) {
  if (error instanceof APIError && error.status === 429) return "尝试次数较多，请稍等一会儿再试。";
  if (error instanceof APIError && error.status === 401) {
    if (method === "password") return "登录名或安全密码不正确。";
    return error.message.includes("expired") ? "这个入口口令已过期，请联系对方获取新的入口链接。" : "入口口令不正确，请检查后再试。";
  }
  if (error instanceof APIError && error.status === 0) return "暂时无法连接 Love Book，请检查网络后重试。";
  return "暂时无法登录，请稍后再试。";
}

export default function LoginPage() {
  const router = useRouter();
  const { token, hydrated, setToken, setMe } = useAppStore();
  const runnerRef = useRef<XiaohuaRunnerHandle>(null);
  const [gate, setGate] = useState<Gate>("wait");
  const [method, setMethod] = useState<LoginMethod>("password");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>("menu");
  const [leaderboard, setLeaderboard] = useState<GameLeaderboardOut>({ items: [], threshold: 0 });
  const [scoreToName, setScoreToName] = useState<number | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [scoreSubmitting, setScoreSubmitting] = useState(false);
  const [lastRun, setLastRun] = useState<{ score: number; chapter: keyof typeof RUNNER_CHAPTER_LABELS; petals: number; maxCombo: number } | null>(null);
  const [pausedMidRun, setPausedMidRun] = useState(false);
  const autoRan = useRef(false);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    return method === "token" ? tokenInput.trim().length > 0 : loginName.trim().length >= 3 && password.length >= 15;
  }, [loginName, method, password, submitting, tokenInput]);

  const finishLogin = useCallback(
    async (nextToken: string, next?: string | null, loginMethod: LoginMethod = "token") => {
      setSubmitting(true);
      setLoginError(null);
      setToken(nextToken);
      try {
        const me = await api.me({ silent: true });
        setMe(me);
        toast.success(`欢迎回来，${me.user.display_name}`);
        void reportLoginFingerprint();
        router.replace(sanitizeNext(next) || "/timeline");
      } catch (error) {
        setToken(null);
        setGate("play");
        setOverlay("login");
        setLoginError(loginErrorMessage(error, loginMethod));
      } finally {
        setSubmitting(false);
      }
    },
    [router, setMe, setToken],
  );

  useEffect(() => {
    void api.getGameLeaderboard().then(setLeaderboard).catch(() => undefined);
    setPlayerName(window.localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  }, []);

  useEffect(() => {
    if (!hydrated || autoRan.current) return;
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const incomingToken = url.searchParams.get("token") || hashParams.get("token");
    const nextParam = url.searchParams.get("next") || hashParams.get("next");
    if (incomingToken) {
      autoRan.current = true;
      setGate("enter");
      url.searchParams.delete("token");
      url.searchParams.delete("next");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      void finishLogin(incomingToken, nextParam, "token");
      return;
    }
    if (token) {
      autoRan.current = true;
      setGate("enter");
      router.replace(sanitizeNext(nextParam) || "/timeline");
      return;
    }
    setGate("play");
  }, [finishLogin, hydrated, router, token]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setLoginError(null);
    if (method === "token") {
      await finishLogin(tokenInput.trim(), null, "token");
      return;
    }
    try {
      const session = await api.passwordLogin({ login_name: loginName.trim(), password });
      await finishLogin(session.access_token, null, "password");
    } catch (error) {
      setLoginError(loginErrorMessage(error, "password"));
      setSubmitting(false);
    }
  }

  function startGame() {
    setOverlay(null);
    setPausedMidRun(false);
    if (!pausedMidRun) setLastRun(null);
    requestAnimationFrame(() => runnerRef.current?.play());
  }

  function openMenu() {
    setOverlay("menu");
  }

  function handleGameOver(summary: { score: number; chapter: keyof typeof RUNNER_CHAPTER_LABELS; petals: number; maxCombo: number }) {
    setLastRun(summary);
    const qualifies = leaderboard.items.length < 3 || summary.score >= leaderboard.threshold;
    if (summary.score > 0 && qualifies) {
      setScoreToName(summary.score);
      setOverlay("score");
      return;
    }
    setOverlay("over");
  }

  async function submitScore(event: React.FormEvent) {
    event.preventDefault();
    const name = playerName.trim();
    if (scoreToName == null || !name || scoreSubmitting) return;
    setScoreSubmitting(true);
    try {
      const result = await api.submitGameScore({ player_name: name, score: scoreToName });
      window.localStorage.setItem(PLAYER_NAME_KEY, name);
      setLeaderboard({ items: result.items, threshold: result.threshold });
      setScoreToName(null);
      setOverlay("leaderboard");
      toast.success(result.entered ? `这段拾光排到第 ${result.rank} 名` : "成绩已提交");
    } catch {
      toast.error("排行榜暂时没有回应，继续玩也没关系");
    } finally {
      setScoreSubmitting(false);
    }
  }

  if (!hydrated || gate !== "play") {
    return <LoadingScreen label={gate === "enter" ? "正在回家…" : "正在加载…"} />;
  }

  const overlayOpen = overlay !== null;

  return (
    <main className="login-runner-shell viewport-guard">
      <XiaohuaRunner
        ref={runnerRef}
        leaderboardBest={leaderboard.items[0]?.score ?? null}
        pauseRequested={overlayOpen}
        interactionBlocked={overlayOpen}
        celebrating={overlay === "score"}
        onGameOver={handleGameOver}
        onPause={() => {
          setPausedMidRun(true);
          openMenu();
        }}
      />

      {overlay === "menu" ? (
        <section className="runner-start-menu content-surface" aria-labelledby="runner-menu-title">
          <p className="runner-menu-brand"><Heart className="h-4 w-4" fill="currentColor" /> Love Book</p>
          <h1 id="runner-menu-title" className="font-display text-3xl font-bold text-ink">花田拾光</h1>
          <p className="mt-2 font-sc text-sm leading-6 text-ink-soft">陪小花跑过晨光到星夜。拾起花瓣，躲开石头和小鸟。</p>
          <div className="mt-5 grid gap-2">
            <button type="button" className="login-runner-submit flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-sc text-sm font-semibold focus-ring" onClick={startGame}>
              <Play className="h-4 w-4" /> {pausedMidRun ? "继续拾光" : "开始游戏"}
            </button>
            <button type="button" className="runner-menu-secondary focus-ring" onClick={() => setOverlay("leaderboard")}>
              <ListOrdered className="h-4 w-4" /> 全站 Top 3
            </button>
            <button type="button" className="runner-menu-secondary focus-ring" onClick={() => setOverlay("login")}>
              <LogIn className="h-4 w-4" /> 登录 Love Book
            </button>
          </div>
        </section>
      ) : null}

      {overlay === "login" ? (
        <section className="runner-start-menu content-surface" aria-labelledby="login-title">
          <button type="button" className="runner-menu-back focus-ring" onClick={openMenu} aria-label="返回开始菜单">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 id="login-title" className="font-display text-2xl font-bold text-ink">欢迎回家</h1>
          <p className="mt-1 font-sc text-sm text-ink-soft">用好记的安全密码，或继续粘贴入口口令。</p>

          <div className="login-method-tabs" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" aria-selected={method === "password"} onClick={() => { setMethod("password"); setLoginError(null); }}>安全密码</button>
            <button type="button" role="tab" aria-selected={method === "token"} onClick={() => { setMethod("token"); setLoginError(null); }}>入口口令</button>
          </div>

          <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate aria-busy={submitting}>
            {method === "password" ? (
              <>
                <label className="block"><span className="login-field-label">登录名</span><input className="input-field mt-1 min-h-11 text-base" autoComplete="username" value={loginName} onChange={(event) => setLoginName(event.target.value)} maxLength={32} disabled={submitting} /></label>
                <label className="block"><span className="login-field-label">安全密码</span><span className="relative mt-1 block"><input className="input-field min-h-11 pr-12 text-base" type={reveal ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={15} maxLength={128} disabled={submitting} /><button type="button" className="login-reveal focus-ring" onClick={() => setReveal((value) => !value)} aria-label={reveal ? "隐藏安全密码" : "显示安全密码"}>{reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
              </>
            ) : (
              <label className="block"><span className="login-field-label">入口口令</span><span className="relative mt-1 block"><input className="input-field min-h-11 pr-12 text-base" type={reveal ? "text" : "password"} autoComplete="one-time-code" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} disabled={submitting} /><button type="button" className="login-reveal focus-ring" onClick={() => setReveal((value) => !value)} aria-label={reveal ? "隐藏入口口令" : "显示入口口令"}>{reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
            )}
            {loginError ? <p role="alert" className="login-inline-error"><AlertCircle className="h-4 w-4 shrink-0" />{loginError}</p> : null}
            <button type="submit" disabled={!canSubmit} className="login-runner-submit flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-sc text-sm font-semibold focus-ring disabled:opacity-50">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : method === "password" ? <KeyRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}{submitting ? "正在登录" : "进入 Love Book"}</button>
          </form>
          <Link href="/admin" className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 font-sc text-sm text-rose-deep focus-ring">管理员入口 <ArrowRight className="h-4 w-4" /></Link>
        </section>
      ) : null}

      {overlay === "leaderboard" ? (
        <aside className="runner-start-menu content-surface" aria-label="花田拾光排行榜">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">全站 Top 3</h2>
            <button type="button" onClick={openMenu} className="runner-close focus-ring" aria-label="关闭排行榜"><X className="h-4 w-4" /></button>
          </div>
          <ol className="mt-3 space-y-1.5">
            {leaderboard.items.length ? leaderboard.items.map((item, index) => (
              <li key={item.id} className="runner-rank-row"><span>{index + 1}</span><strong>{item.player_name}</strong><b>{item.score}</b></li>
            )) : <li className="py-5 text-center font-sc text-sm text-ink-muted">花田还空着，来拾第一段光吧。</li>}
          </ol>
          <button type="button" className="login-runner-submit mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 font-sc text-sm font-semibold focus-ring" onClick={startGame}>
            <Play className="h-4 w-4" /> 开始游戏
          </button>
        </aside>
      ) : null}

      {overlay === "score" && scoreToName != null ? (
        <form className="runner-start-menu content-surface" onSubmit={submitScore}>
          <button type="button" onClick={() => { setScoreToName(null); setOverlay("over"); }} className="runner-close focus-ring" aria-label="暂不留名"><X className="h-4 w-4" /></button>
          <p className="font-display text-lg font-semibold text-ink">这段拾光，{scoreToName} 分</p>
          <label className="mt-3 block"><span className="login-field-label">留下名字</span><input autoFocus className="input-field mt-1 min-h-11 text-base" value={playerName} onChange={(event) => setPlayerName(event.target.value)} maxLength={12} required /></label>
          <button type="submit" className="login-runner-submit mt-3 min-h-11 w-full rounded-xl px-4 font-sc text-sm focus-ring" disabled={!playerName.trim() || scoreSubmitting}>{scoreSubmitting ? "正在记录" : "写进排行榜"}</button>
        </form>
      ) : null}

      {overlay === "over" ? (
        <section className="runner-start-menu content-surface" aria-labelledby="runner-over-title">
          <h2 id="runner-over-title" className="font-display text-2xl font-bold text-ink">这一程走完了</h2>
          <p className="mt-2 font-sc text-sm text-ink-soft">本局 {lastRun?.score ?? 0} 分 · 拾到 {lastRun?.petals ?? 0} 片花瓣 · 最高连击 {lastRun?.maxCombo ?? 0}{lastRun ? ` · ${RUNNER_CHAPTER_LABELS[lastRun.chapter]}` : ""}</p>
          <div className="mt-5 grid gap-2">
            <button type="button" className="login-runner-submit flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-sc text-sm font-semibold focus-ring" onClick={startGame}>
              <RotateCcw className="h-4 w-4" /> 再拾一次
            </button>
            <button type="button" className="runner-menu-secondary focus-ring" onClick={openMenu}>回到菜单</button>
            <button type="button" className="runner-menu-secondary focus-ring" onClick={() => setOverlay("login")}>
              <LogIn className="h-4 w-4" /> 登录 Love Book
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
