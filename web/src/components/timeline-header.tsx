"use client";

// Sticky app header with default and compact mobile-friendly layouts, scrapbook navigation, logout, and current user identity while profile editing lives on /me.

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "./avatar";
import { useAppStore } from "@/lib/store";

interface TimelineHeaderProps {
  title?: string;
  back?: { href: string; label?: string };
  rightSlot?: ReactNode;
  mode?: "default" | "compact";
}

export function TimelineHeader({ title, back, rightSlot, mode = "default" }: TimelineHeaderProps) {
  const router = useRouter();
  const me = useAppStore((s) => s.me);
  const logout = useAppStore((s) => s.logout);

  if (!me) return null;

  const compact = mode === "compact";

  return (
    <header className="sticky top-0 z-30 frosted-bar pt-[env(safe-area-inset-top,0px)]">
      <div className={`mx-auto flex max-w-5xl items-center gap-3 px-4 sm:px-6 ${compact ? "h-[60px] sm:h-[64px]" : "h-16"}`}>
        {back ? (
          <Link
            href={back.href}
            className="grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-ink/5 focus-ring"
            aria-label={back.label || "返回"}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        ) : (
          <Link
            href="/me"
            className={`inline-flex items-center rounded-full transition hover:bg-ink/5 focus-ring ${compact ? "gap-2 py-1 pl-1 pr-2.5" : "gap-2 py-1 pl-1 pr-3"}`}
            aria-label="进入我的"
          >
            <Avatar user={me.user} size="md" />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          {title ? (
            <h1 className={`truncate font-display font-semibold text-ink ${compact ? "text-base sm:text-lg" : "text-lg sm:text-xl"}`}>{title}</h1>
          ) : (
            <div>
              <p className={`truncate font-display font-semibold leading-tight text-ink ${compact ? "text-[15px] sm:text-base" : "text-base sm:text-lg"}`}>
                {me.user.display_name}
              </p>
              <p className={`font-sc text-ink-muted ${compact ? "text-[10px] sm:text-[11px]" : "text-[11px]"}`}>
                和 {me.counterpart.display_name} 一起收集日常
              </p>
            </div>
          )}
        </div>

        <div className={`flex items-center ${compact ? "gap-1.5" : "gap-2"}`}>
          {rightSlot}
          <button
            onClick={() => {
              logout();
              toast.success("已退出，期待再见");
              router.replace("/");
            }}
            className={`grid place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 focus-ring ${compact ? "h-9 w-9 sm:h-10 sm:w-10" : "h-10 w-10"}`}
            aria-label="退出"
          >
            <LogOut className={compact ? "h-4.5 w-4.5 sm:h-5 sm:w-5" : "h-5 w-5"} />
          </button>
        </div>
      </div>
    </header>
  );
}
