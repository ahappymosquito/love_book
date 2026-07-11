"use client";

// Unified authenticated Liquid Glass app header with mobile-safe width, avatar navigation, predictable action placement, safe-area spacing, and logout.

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "./avatar";
import { GlassSurface } from "@/components/ui/glass-surface";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";

export interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  back?: { href: string; label?: string };
  rightSlot?: ReactNode;
  mode?: "default" | "compact";
  maxWidth?: "5xl" | "7xl";
}

export function AppHeader({
  title,
  subtitle,
  back,
  rightSlot,
  mode = "default",
  maxWidth = "7xl",
}: AppHeaderProps) {
  const router = useRouter();
  const me = useAppStore((s) => s.me);
  const logout = useAppStore((s) => s.logout);

  if (!me) return null;

  const compact = mode === "compact";
  const defaultSubtitle = subtitle ?? `和 ${me.counterpart.display_name} 一起收集日常`;

  return (
    <header className="app-header-shell sticky top-0 z-30 max-w-full">
      <GlassSurface
        variant="regular"
        className={cn(
          "app-header-glass flex w-full min-w-0 items-center gap-3",
          maxWidth === "5xl" ? "max-w-5xl" : "max-w-7xl",
          compact ? "h-[60px] sm:h-[64px]" : "h-16",
        )}
      >
        {back ? (
          <Link
            href={back.href}
            className="grid h-10 w-10 flex-none place-items-center rounded-full text-ink transition hover:bg-ink/5 focus-ring"
            aria-label={back.label || "返回"}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        ) : (
          <Link
            href="/me"
            className={cn(
              "inline-flex flex-none items-center rounded-full transition hover:bg-ink/5 focus-ring",
              compact ? "gap-2 py-1 pl-1 pr-2.5" : "gap-2 py-1 pl-1 pr-3",
            )}
            aria-label="进入我的设置"
          >
            <Avatar user={me.user} size="md" />
          </Link>
        )}

        <div className={cn("min-w-0 flex-1", back && !subtitle && "text-center")}>
          {title ? (
            <>
              <h1 className={cn("truncate font-display font-semibold leading-tight text-ink", compact ? "text-base sm:text-lg" : "text-lg sm:text-xl")}>
                {title}
              </h1>
              {subtitle ? (
                <p className={cn("truncate font-sc text-ink-muted", compact ? "text-[10px] sm:text-[11px]" : "text-[11px]")}>
                  {subtitle}
                </p>
              ) : null}
            </>
          ) : (
            <div>
              <p className={cn("truncate font-display font-semibold leading-tight text-ink", compact ? "text-[15px] sm:text-base" : "text-base sm:text-lg")}>
                {me.user.display_name}
              </p>
              <p className={cn("truncate font-sc text-ink-muted", compact ? "text-[10px] sm:text-[11px]" : "text-[11px]")}>
                {defaultSubtitle}
              </p>
            </div>
          )}
        </div>

        <div className={cn("flex flex-none items-center", compact ? "gap-1.5" : "gap-2")}>
          {rightSlot}
          <button
            type="button"
            onClick={() => {
              logout();
              toast.success("已退出，期待再见");
              router.replace("/");
            }}
            className={cn(
              "grid place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 focus-ring",
              compact ? "h-9 w-9 sm:h-10 sm:w-10" : "h-10 w-10",
            )}
            aria-label="退出"
          >
            <LogOut className={compact ? "h-4 w-4 sm:h-5 sm:w-5" : "h-5 w-5"} />
          </button>
        </div>
      </GlassSurface>
    </header>
  );
}
