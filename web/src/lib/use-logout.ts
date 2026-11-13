"use client";

// 共享退出登录动作：清除本机会话、给出温和提示并回到首页，供顶部栏和设置页复用。

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAppStore } from "./store";

export function useLogout(): () => void {
  const router = useRouter();
  const logout = useAppStore((s) => s.logout);
  return useCallback(() => {
    logout();
    toast.success("已退出，期待再见");
    router.replace("/");
  }, [logout, router]);
}
