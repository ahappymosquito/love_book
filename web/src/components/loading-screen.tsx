"use client";

export function LoadingScreen({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="min-h-dvh w-full grid place-items-center px-6">
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
