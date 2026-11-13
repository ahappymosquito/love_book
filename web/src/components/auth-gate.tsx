"use client";

// 已登录页面的会话门禁：无 token 或 401 回首页，已合上的 pair 带上告别句再回去；网络或服务暂时失败时展示温和的重试状态，不会一直停在加载中。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RotateCcw } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { api, APIError, pairDissolvedFromError } from "@/lib/api";
import { LoadingScreen } from "./loading-screen";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, me, hydrated, setMe, setFarewell, logout } = useAppStore();
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!hydrated) return;

    if (!token) {
      router.replace("/");
      return;
    }

    if (me) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);
    setFailed(false);
    api
      .me({ silent: true })
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        setChecking(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const farewell = pairDissolvedFromError(err);
        if (farewell) {
          setFarewell(farewell);
          logout();
          router.replace("/");
          return;
        }
        if (err instanceof APIError && err.status === 401) {
          logout();
          router.replace("/");
        } else {
          setChecking(false);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, me, router, setMe, setFarewell, logout, attempt]);

  if (failed && !me) {
    return (
      <div className="grid min-h-dvh w-full place-items-center px-6">
        <section className="content-surface w-full max-w-sm p-6 text-center" role="alert">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-peach/24 text-rose-deep">
            <CloudOff className="h-6 w-6" />
          </span>
          <h1 className="mt-4 font-display text-xl font-semibold text-ink">暂时没连上我们的小书</h1>
          <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">可能是网络有点慢，或者小书正在休息。稍等一下再试试，记下的内容都还在。</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="btn-primary mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring"
          >
            <RotateCcw className="h-4 w-4" />
            再试一次
          </button>
        </section>
      </div>
    );
  }

  if (!hydrated || checking || !me) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
