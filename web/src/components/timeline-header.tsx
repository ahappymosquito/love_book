"use client";

// Sticky app header with scrapbook navigation, logout, and current user identity display while profile editing lives on /me.

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
}

export function TimelineHeader({ title, back, rightSlot }: TimelineHeaderProps) {
  const router = useRouter();
  const me = useAppStore((s) => s.me);
  const logout = useAppStore((s) => s.logout);

  if (!me) return null;

  return (
    <header className="sticky top-0 z-30 frosted-bar pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
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
            className="inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition hover:bg-ink/5 focus-ring"
            aria-label="进入我的"
          >
            <Avatar user={me.user} size="md" />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          {title ? (
            <h1 className="truncate font-display text-lg font-semibold text-ink sm:text-xl">{title}</h1>
          ) : (
            <div>
              <p className="truncate font-display text-base font-semibold leading-tight text-ink sm:text-lg">
                {me.user.display_name}
              </p>
              <p className="font-sc text-[11px] text-ink-muted">
                和 {me.counterpart.display_name} 一起
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {rightSlot}
          <button
            onClick={() => {
              logout();
              toast.success("已退出，期待再见");
              router.replace("/");
            }}
            className="grid h-10 w-10 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 focus-ring"
            aria-label="退出"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
