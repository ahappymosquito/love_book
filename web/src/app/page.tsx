"use client";

// Game-first Love Book login with a Canvas pixel runner, token/password authentication, and public Top 10 scores.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ChevronDown, Eye, EyeOff, Heart, KeyRound, ListOrdered, LoaderCircle, LogIn, X } from "lucide-react";
import { toast } from "sonner";
import { XiaohuaRunner } from "@/components/xiaohua-runner";
import { api, APIError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { GameLeaderboardOut } from "@/lib/types";

type LoginMethod = "password" | "token";

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
  const [method, setMethod] = useState<LoginMethod>("password");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<GameLeaderboardOut>({ items: [], threshold: 0 });
  const [scoreToName, setScoreToName] = useState<number | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [scoreSubmitting, setScoreSubmitting] = useState(false);
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
    const landscape = window.matchMedia("(orientation: landscape) and (max-height: 600px)");
    const syncPanelForOrientation = () => setPanelOpen(!landscape.matches);
    syncPanelForOrientation();
    landscape.addEventListener?.("change", syncPanelForOrientation);
    return () => landscape.removeEventListener?.("change", syncPanelForOrientation);
  }, []);

  useEffect(() => {
    if (!hydrated || autoRan.current) return;
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const incomingToken = url.searchParams.get("token") || hashParams.get("token");
    const nextParam = url.searchParams.get("next") || hashParams.get("next");
    if (incomingToken) {
      autoRan.current = true;
      url.searchParams.delete("token");
      url.searchParams.delete("next");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      void finishLogin(incomingToken, nextParam, "token");
      return;
    }
    if (token && !submitting) router.replace(sanitizeNext(nextParam) || "/timeline");
  }, [finishLogin, hydrated, router, submitting, token]);

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

  function handleGameOver(score: number) {
    const qualifies = leaderboard.items.length < 10 || score >= leaderboard.threshold;
    if (score > 0 && qualifies) setScoreToName(score);
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
      setLeaderboardOpen(true);
      toast.success(result.entered ? `小花跑进第 ${result.rank} 名啦` : "成绩已提交");
    } catch {
      toast.error("排行榜暂时没有回应，继续玩也没关系");
    } finally {
      setScoreSubmitting(false);
    }
  }

  return (
    <main className="login-runner-shell viewport-guard" data-panel-open={panelOpen ? "true" : "false"}>
      <XiaohuaRunner
        leaderboardBest={leaderboard.items[0]?.score ?? null}
        pauseRequested={panelOpen}
        celebrating={scoreToName != null}
        onStart={() => setPanelOpen(false)}
        onGameOver={handleGameOver}
      />

      <header className="login-runner-header">
        <div className="login-runner-brand"><Heart className="h-4 w-4" fill="currentColor" /> Love Book</div>
        <div className="flex gap-2">
          <button type="button" className="login-runner-action focus-ring" onClick={() => setLeaderboardOpen((value) => !value)}>
            <ListOrdered className="h-4 w-4" /> Top 10
          </button>
          <button type="button" className="login-runner-action login-panel-trigger focus-ring" onClick={() => setPanelOpen((value) => !value)}>
            <LogIn className="h-4 w-4" /> 登录 Love Book
          </button>
        </div>
      </header>

      <section
        className="login-runner-panel"
        aria-labelledby="login-title"
        aria-hidden={!panelOpen}
        inert={!panelOpen}
      >
        <button type="button" className="login-panel-close focus-ring" onClick={() => setPanelOpen(false)} aria-label="收起登录框"><ChevronDown className="h-5 w-5" /></button>
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
          <button type="submit" disabled={!canSubmit} className="btn-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-sc text-sm font-semibold focus-ring disabled:opacity-50">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : method === "password" ? <KeyRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}{submitting ? "正在登录" : "进入 Love Book"}</button>
        </form>
        <Link href="/admin" className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 font-sc text-sm text-rose-deep focus-ring">管理员入口 <ArrowRight className="h-4 w-4" /></Link>
      </section>

      {leaderboardOpen ? (
        <aside className="runner-leaderboard" aria-label="小花跑酷排行榜">
          <div className="flex items-center justify-between"><h2 className="font-display text-lg font-semibold text-ink">全站 Top 10</h2><button type="button" onClick={() => setLeaderboardOpen(false)} className="runner-close focus-ring" aria-label="关闭排行榜"><X className="h-4 w-4" /></button></div>
          <ol className="mt-3 space-y-1.5">{leaderboard.items.length ? leaderboard.items.map((item, index) => <li key={item.id} className="runner-rank-row"><span>{index + 1}</span><strong>{item.player_name}</strong><b>{item.score}</b></li>) : <li className="py-5 text-center font-sc text-sm text-ink-muted">还没有纪录，来跑第一局吧。</li>}</ol>
        </aside>
      ) : null}

      {scoreToName != null ? (
        <form className="runner-name-score" onSubmit={submitScore}>
          <button type="button" onClick={() => setScoreToName(null)} className="runner-close focus-ring" aria-label="暂不留名"><X className="h-4 w-4" /></button>
          <p className="font-display text-lg font-semibold text-ink">新纪录，{scoreToName} 分</p>
          <label className="mt-3 block"><span className="login-field-label">留下名字</span><input autoFocus className="input-field mt-1 min-h-11 text-base" value={playerName} onChange={(event) => setPlayerName(event.target.value)} maxLength={12} required /></label>
          <button type="submit" className="btn-primary mt-3 min-h-11 w-full rounded-xl px-4 font-sc text-sm focus-ring" disabled={!playerName.trim() || scoreSubmitting}>{scoreSubmitting ? "正在记录" : "写进排行榜"}</button>
        </form>
      ) : null}
    </main>
  );
}
