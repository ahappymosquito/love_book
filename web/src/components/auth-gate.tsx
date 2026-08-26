"use client";

// 已登录页面的会话门禁：无 token 或 401 回首页，已合上的 pair 带上告别句再回去。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { api, APIError, pairDissolvedFromError } from "@/lib/api";
import { LoadingScreen } from "./loading-screen";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, me, hydrated, setMe, setFarewell, logout } = useAppStore();
  const [checking, setChecking] = useState(true);

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
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, me, router, setMe, setFarewell, logout]);

  if (!hydrated || checking || !me) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
