"use client";

// 全屏或嵌入式加载态。嵌入登录页时只占备案条上方的剩余高度。

export function LoadingScreen({ label = "正在加载…", embedded = false }: { label?: string; embedded?: boolean }) {
  return (
    <div className={embedded ? "grid min-h-0 w-full flex-1 place-items-center px-6" : "grid min-h-dvh w-full place-items-center px-6"}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 rounded-full border-2 border-rose/20" />
          <div className="absolute inset-0 rounded-full border-2 border-rose border-t-transparent animate-spin" />
        </div>
        <p className="font-sc text-sm text-ink-muted tracking-wide">{label}</p>
      </div>
    </div>
  );
}
