"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  Clock,
  Filter,
  Globe2,
  KeyRound,
  Loader2,
  Monitor,
  RefreshCw,
  ScrollText,
  Smartphone,
  Sparkles,
  Wifi,
} from "lucide-react";
import { api, APIError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Avatar } from "@/components/avatar";
import { formatAbsolute, formatRelative } from "@/lib/format";
import type { LoginLogOut } from "@/lib/types";
import { cn } from "@/lib/cn";

export default function RecordPage() {
  const router = useRouter();
  const { adminKey, setAdminKey, logoutAdmin, hydrated } = useAppStore();
  const [keyInput, setKeyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [logs, setLogs] = useState<LoginLogOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterUserId, setFilterUserId] = useState<number | "all">("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listLoginLogs({ limit: 200 });
      setLogs(list);
    } catch (err) {
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
        logoutAdmin();
      }
    } finally {
      setLoading(false);
    }
  }, [logoutAdmin]);

  useEffect(() => {
    if (!adminKey) return;
    void refresh();
  }, [adminKey, refresh]);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setVerifying(true);
    try {
      await api.verifyAdmin(key);
      setAdminKey(key);
      setKeyInput("");
      toast.success("管理身份已验证");
    } catch (err) {
      if (err instanceof APIError && err.status === 401) {
        toast.error("admin key 不正确");
      } else {
        toast.error("验证失败，请稍后再试");
      }
    } finally {
      setVerifying(false);
    }
  }

  const userOptions = useMemo(() => {
    const map = new Map<number, { id: number; name: string; avatar: string }>();
    for (const log of logs) {
      if (log.user && !map.has(log.user.id)) {
        map.set(log.user.id, {
          id: log.user.id,
          name: log.user.display_name,
          avatar: log.user.avatar,
        });
      }
    }
    return Array.from(map.values());
  }, [logs]);

  const filtered = useMemo(() => {
    if (filterUserId === "all") return logs;
    return logs.filter((l) => l.user_id === filterUserId);
  }, [logs, filterUserId]);

  if (!hydrated) return null;

  return (
    <div className="min-h-dvh w-full">
      <header className="sticky top-0 z-30 frosted-bar">
        <div className="max-w-4xl mx-auto px-5 sm:px-6 py-4 flex items-center justify-between">
          <Link
            href={adminKey ? "/admin" : "/"}
            className="inline-flex items-center gap-2 text-sm font-sc text-ink-soft hover:text-rose focus-ring rounded-full px-2 py-1"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <h1 className="font-display text-lg sm:text-xl text-ink inline-flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-rose-deep" />
            登录记录
          </h1>
          {adminKey ? (
            <button
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 text-sm font-sc text-ink-soft hover:text-rose-deep focus-ring rounded-full px-2 py-1"
              disabled={loading}
              aria-label="刷新"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              刷新
            </button>
          ) : (
            <span className="w-14" />
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 sm:px-6 py-8 space-y-6">
        {!adminKey ? (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-3xl p-6 sm:p-8 max-w-md mx-auto"
          >
            <div className="flex items-center gap-3 mb-1">
              <div className="h-10 w-10 grid place-items-center rounded-2xl bg-rose/12 text-rose-deep">
                <KeyRound className="h-5 w-5" />
              </div>
              <h2 className="font-display text-2xl text-ink">管理员校验</h2>
            </div>
            <p className="font-sc text-sm text-ink-soft mb-5">
              请先用 admin key 验证身份，再查看所有用户的登录记录。
            </p>
            <form onSubmit={onVerify} className="space-y-4">
              <input
                type="password"
                className="input-field"
                placeholder="admin key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={verifying || !keyInput.trim()}
                className="btn-primary w-full rounded-2xl px-5 py-3.5 font-sc text-[15px] font-medium focus-ring inline-flex items-center justify-center gap-2 min-h-[48px]"
              >
                {verifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                验证
              </button>
            </form>
          </motion.section>
        ) : (
          <>
            <section className="glass-card rounded-3xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3 px-1">
                <Filter className="h-4 w-4 text-rose-deep" />
                <span className="font-sc text-sm text-ink">按用户筛选</span>
                <span className="font-sc text-xs text-ink-muted ml-auto">
                  共 {filtered.length} 条
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  active={filterUserId === "all"}
                  onClick={() => setFilterUserId("all")}
                  label="全部"
                />
                {userOptions.map((u) => (
                  <FilterChip
                    key={u.id}
                    active={filterUserId === u.id}
                    onClick={() => setFilterUserId(u.id)}
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-base leading-none">{u.avatar}</span>
                        {u.name}
                      </span>
                    }
                  />
                ))}
              </div>
            </section>

            {loading ? (
              <div className="glass-card rounded-3xl p-12 grid place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="glass-card rounded-3xl p-12 text-center font-sc text-sm text-ink-muted">
                还没有登录记录。
              </div>
            ) : (
              <ul className="space-y-3">
                {filtered.map((log) => (
                  <LogCard key={log.id} log={log} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-sc transition focus-ring",
        active
          ? "bg-rose text-white shadow-soft"
          : "bg-cream-deep/40 text-ink-soft hover:bg-cream-deep/70",
      )}
    >
      {label}
    </button>
  );
}

function LogCard({ log }: { log: LoginLogOut }) {
  const isMobile =
    (log.device || "").toLowerCase().includes("iphone") ||
    (log.device || "").toLowerCase().includes("android") ||
    (log.device || "").toLowerCase().includes("mobile");
  const location =
    [log.country, log.region, log.city].filter(Boolean).join(" · ") || "未知地点";
  return (
    <li className="glass-card rounded-3xl p-5 sm:p-6 transition hover:shadow-glow">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {log.user ? (
            <Avatar emoji={log.user.avatar} name={log.user.display_name} size="md" />
          ) : (
            <div className="h-12 w-12 rounded-2xl bg-cream-deep/50 grid place-items-center text-ink-muted">
              ?
            </div>
          )}
          <div className="min-w-0">
            <p className="font-display text-base text-ink truncate">
              {log.user?.display_name || `user #${log.user_id}`}
            </p>
            <p className="font-sc text-[11px] text-ink-muted inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatAbsolute(log.created_at)} · {formatRelative(log.created_at)}
            </p>
          </div>
        </div>
        <div className="ml-auto inline-flex items-center gap-1.5 font-sc text-[11px] text-ink-muted">
          {isMobile ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
          {log.device || "未知设备"}
        </div>
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3 text-[12px] font-sc">
        <InfoRow icon={<Wifi className="h-3.5 w-3.5" />} label="IP" value={log.ip || "—"} mono />
        <InfoRow
          icon={<Globe2 className="h-3.5 w-3.5" />}
          label="地理"
          value={location}
          extra={log.isp || undefined}
        />
        <InfoRow label="操作系统" value={log.os || "—"} />
        <InfoRow label="浏览器" value={log.browser || "—"} />
        <InfoRow label="语言" value={log.locale || "—"} />
        <InfoRow label="时区" value={log.timezone_name || "—"} />
        <InfoRow label="屏幕" value={log.screen || "—"} />
      </div>

      {log.user_agent && (
        <details className="mt-3">
          <summary className="cursor-pointer font-sc text-[11px] text-ink-muted hover:text-rose-deep">
            原始 User-Agent
          </summary>
          <p className="mt-2 font-mono text-[11px] break-all text-ink-soft bg-cream-deep/40 rounded-xl p-3 leading-relaxed">
            {log.user_agent}
          </p>
        </details>
      )}
    </li>
  );
}

function InfoRow({
  icon,
  label,
  value,
  extra,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  extra?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface-raised/60 hairline px-3 py-2">
      <div className="flex items-center gap-1.5 text-ink-muted text-[10px] uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <p className={cn("text-ink truncate", mono && "font-mono")}>{value}</p>
      {extra && <p className="text-[11px] text-ink-muted truncate">{extra}</p>}
    </div>
  );
}
