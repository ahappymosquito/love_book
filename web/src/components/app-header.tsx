"use client";

// Unified authenticated Liquid Glass app header: avatar to /me (or a back link), title/subtitle, page action slot, and a confirmed logout button on main task pages; width follows the shared page-width table so header, content, and bottom nav align.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, LogOut } from "lucide-react";
import { Avatar } from "./avatar";
import { ConfirmDialog } from "./confirm-dialog";
import { GlassSurface } from "@/components/ui/glass-surface";
import { cn } from "@/lib/cn";
import { PAGE_CHROME_WIDTH_CLASS, pageWidthForPath } from "@/lib/page-width";
import { useAppStore } from "@/lib/store";
import { useLogout } from "@/lib/use-logout";

export interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  back?: { href: string; label?: string; onClick?: () => boolean | void };
  rightSlot?: ReactNode;
  mode?: "default" | "compact";
  showLogout?: boolean;
}

export function AppHeader({
  title,
  subtitle,
  back,
  rightSlot,
  mode = "default",
  showLogout = !back,
}: AppHeaderProps) {
  const me = useAppStore((s) => s.me);
  const pathname = usePathname();
  const logout = useLogout();
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (!me) return null;

  const compact = mode === "compact";
  const defaultSubtitle = subtitle ?? `和 ${me.counterpart.display_name} 一起收集日常`;

  return (
    <header className="app-header-shell sticky top-0 z-30 max-w-full">
      <GlassSurface
        variant="regular"
        className={cn(
          "app-header-glass flex w-full min-w-0 items-center gap-2 sm:gap-3",
          PAGE_CHROME_WIDTH_CLASS[pageWidthForPath(pathname)],
          compact ? "h-[60px] sm:h-[64px]" : "h-16",
        )}
      >
        {back ? (
          <Link
            href={back.href}
            onClick={(event) => {
              if (back.onClick?.() === false) event.preventDefault();
            }}
            className="grid h-11 w-11 flex-none place-items-center rounded-full text-ink transition hover:bg-ink/5 focus-ring"
            aria-label={back.label || "返回"}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        ) : (
          <Link
            href="/me"
            className={cn(
              "inline-flex min-h-11 flex-none items-center rounded-full transition hover:bg-ink/5 focus-ring",
              compact ? "gap-2 py-0.5 pl-0.5 pr-1.5" : "gap-2 py-0.5 pl-0.5 pr-2",
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

        <div className={cn("flex flex-none items-center", compact ? "gap-1" : "gap-1.5 sm:gap-2")}>
          {rightSlot}
          {showLogout && (
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="grid h-11 w-11 flex-none place-items-center rounded-full text-ink-muted transition hover:bg-ink/5 hover:text-rose-deep focus-ring"
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </GlassSurface>
      {showLogout && typeof document !== "undefined"
        ? createPortal(
            <ConfirmDialog
              open={confirmLogout}
              title="要先退出吗？"
              description="退出后，可以用安全密码或专属入口链接再回来。"
              confirmLabel="退出登录"
              onConfirm={() => {
                setConfirmLogout(false);
                logout();
              }}
              onCancel={() => setConfirmLogout(false)}
            />,
            document.body,
          )
        : null}
    </header>
  );
}
