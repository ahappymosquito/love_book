"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { api, APIError } from "@/lib/api";
import { LoadingScreen } from "./loading-screen";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, me, hydrated, setMe, logout } = useAppStore();
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
      .me()
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        setChecking(false);
      })
      .catch((err) => {
        if (cancelled) return;
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
  }, [hydrated, token, me, router, setMe, logout]);

  if (!hydrated || checking || !me) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
