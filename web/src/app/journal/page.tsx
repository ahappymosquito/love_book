"use client";

// /journal 手账页：只有已登录的 pair 双方能进入（AuthGate），在线翻看并导出 HTML / PDF / 长图；地址可带 ?scope=range&start&end 或 ?scope=meeting&meeting_id 指定初始范围。

import { Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { JournalStudio } from "@/components/journal/journal-studio";
import { LoadingScreen } from "@/components/loading-screen";

export default function JournalPage() {
  return (
    <AuthGate>
      <Suspense fallback={<LoadingScreen />}>
        <JournalStudio />
      </Suspense>
    </AuthGate>
  );
}
