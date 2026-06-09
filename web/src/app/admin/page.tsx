"use client";

// Admin console with scrapbook panels for pairs, tokens, contacts, AMap-grounded AI test status, avatars, and clipboard-safe links.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarClock,
  CalendarHeart,
  Check,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Sparkles,
  Users,
} from "lucide-react";
import { api, APIError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Avatar } from "@/components/avatar";
import { AvatarPicker } from "@/components/avatar-picker";
import { formatAbsolute, fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { AVATAR_PRESETS, type AdminAIConfigOut, type AdminAIConnectionTestOut, type AIProtocol, type PairCreated, type PairOut } from "@/lib/types";
import { cn } from "@/lib/cn";

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function AdminPage() {
  const { adminKey, setAdminKey, logoutAdmin, hydrated } = useAppStore();
  const [keyInput, setKeyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [pairs, setPairs] = useState<PairOut[]>([]);
  const [loadingPairs, setLoadingPairs] = useState(false);
  const [created, setCreated] = useState<PairCreated | null>(null);

  // Form state
  const [aName, setAName] = useState("");
  const [bName, setBName] = useState("");
  const [aAvatar, setAAvatar] = useState<string>(AVATAR_PRESETS[0]);
  const [bAvatar, setBAvatar] = useState<string>(AVATAR_PRESETS[1]);
  const [aEmail, setAEmail] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [loveStartedOn, setLoveStartedOn] = useState(toDateInputValue(new Date()));
  const [pickerFor, setPickerFor] = useState<"a" | "b" | null>(null);
  const [tokenExpiryMode, setTokenExpiryMode] = useState<"never" | "custom">("never");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const minimumTokenExpiresAt = toLocalInputValue(new Date(Date.now() + 60_000));

  const refreshPairs = useCallback(async () => {
    setLoadingPairs(true);
    try {
      const list = await api.listPairs();
      setPairs(list);
    } catch (err) {
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
        logoutAdmin();
      }
    } finally {
      setLoadingPairs(false);
    }
  }, [logoutAdmin]);

  useEffect(() => {
    if (!adminKey) return;
    void refreshPairs();
  }, [adminKey, refreshPairs]);

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setVerifying(true);
    try {
      await api.verifyAdmin(key);
      setAdminKey(key);
      toast.success("管理身份已验证");
      setKeyInput("");
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

  async function onCreatePair(e: React.FormEvent) {
    e.preventDefault();
    if (!aName.trim() || !bName.trim()) return;
    if (tokenExpiryMode === "custom" && !tokenExpiresAt) return;
    setCreating(true);
    try {
      const result = await api.createPair({
        user_a_display_name: aName.trim(),
        user_b_display_name: bName.trim(),
        user_a_avatar: aAvatar,
        user_b_avatar: bAvatar,
        user_a_email: aEmail.trim() || null,
        user_b_email: bEmail.trim() || null,
        love_started_on: loveStartedOn || null,
        token_expires_at: tokenExpiryMode === "custom" ? fromLocalInputValue(tokenExpiresAt) : null,
      });
      setCreated(result);
      setAName("");
      setBName("");
      setAEmail("");
      setBEmail("");
      setLoveStartedOn(toDateInputValue(new Date()));
      setTokenExpiryMode("never");
      setTokenExpiresAt("");
      toast.success("配对已创建");
      void refreshPairs();
    } catch {
      // toast handled by api
    } finally {
      setCreating(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await copyToClipboard(text);
      toast.success(`${label} 已复制`);
    } catch {
      toast.error("复制失败，请手动选择");
    }
  }

  function entryLink(token: string): string {
    const encodedToken = encodeURIComponent(token);
    if (typeof window === "undefined") return `/?token=${encodedToken}`;
    return `${window.location.origin}/?token=${encodedToken}`;
  }

  if (!hydrated) {
    return null;
  }

  return (
    <div className="min-h-dvh w-full">
      <header className="sticky top-0 z-30 frosted-bar">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-sc text-ink-soft hover:text-rose focus-ring rounded-full px-2 py-1"
            aria-label="返回登录"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <h1 className="font-display text-lg font-semibold text-ink sm:text-xl">管理控制台</h1>
          {adminKey ? (
            <div className="flex items-center gap-1">
              <Link
                href="/record"
                className="inline-flex items-center gap-1.5 text-sm font-sc text-ink-soft hover:text-rose-deep focus-ring rounded-full px-2 py-1"
              >
                <ScrollText className="h-4 w-4" />
                登录记录
              </Link>
              <button
                onClick={() => {
                  logoutAdmin();
                  toast.success("已退出管理");
                }}
                className="inline-flex items-center gap-1.5 text-sm font-sc text-ink-soft hover:text-rose-deep focus-ring rounded-full px-2 py-1"
              >
                <LogOut className="h-4 w-4" />
                退出
              </button>
            </div>
          ) : (
            <span className="w-14" />
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <AnimatePresence mode="wait">
          {!adminKey ? (
            <motion.section
              key="auth"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-card rounded-3xl p-5 sm:p-6"
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 grid place-items-center rounded-2xl bg-peach/30 text-rose-deep">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h2 className="font-display text-xl font-semibold text-ink">管理员校验</h2>
              </div>
              <p className="font-sc text-sm text-ink-soft mb-5">
                先用 admin key 验证身份，再创建配对。
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
            <motion.div
              key="dash"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Create pair */}
              <section className="glass-card rounded-3xl p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 grid place-items-center rounded-2xl bg-peach/30 text-rose-deep">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-ink">新建配对</h2>
                    <p className="font-sc text-xs text-ink-muted">创建后会得到两条不同的 token</p>
                  </div>
                </div>

                <form onSubmit={onCreatePair} className="space-y-5">
                  <div className="grid sm:grid-cols-2 gap-5">
                    <UserField
                      label="ta 一"
                      value={aName}
                      onChange={setAName}
                      avatar={aAvatar}
                      onPickAvatar={() => setPickerFor("a")}
                      placeholder="例如：阿白"
                      email={aEmail}
                      onEmailChange={setAEmail}
                    />
                    <UserField
                      label="ta 二"
                      value={bName}
                      onChange={setBName}
                      avatar={bAvatar}
                      onPickAvatar={() => setPickerFor("b")}
                      placeholder="例如：小棕"
                      email={bEmail}
                      onEmailChange={setBEmail}
                    />
                  </div>

                  <div className="rounded-2xl bg-peach/14 p-4 space-y-2 hairline">
                    <label className="flex items-center gap-2 text-ink font-sc text-sm font-medium">
                      <CalendarHeart className="h-4 w-4 text-rose-deep" />
                      情侣日期
                    </label>
                    <input
                      type="date"
                      className="input-field"
                      value={loveStartedOn}
                      onChange={(e) => setLoveStartedOn(e.target.value)}
                    />
                    <p className="font-sc text-[11px] text-ink-muted">
                      首页会从这一天开始计算“一起第几天”和纪念日。
                    </p>
                  </div>

                  <div className="rounded-2xl bg-peach/14 p-4 space-y-3 hairline">
                    <div className="flex items-center gap-2 text-ink">
                      <CalendarClock className="h-4 w-4 text-rose-deep" />
                      <span className="font-sc text-sm font-medium">token 有效期</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <label
                        className={cn(
                          "rounded-2xl hairline px-4 py-3 cursor-pointer transition",
                          tokenExpiryMode === "never" ? "bg-peach/28 text-rose-deep" : "bg-peach/12 text-ink-soft",
                        )}
                      >
                        <input
                          type="radio"
                          name="token-expiry"
                          value="never"
                          checked={tokenExpiryMode === "never"}
                          onChange={() => setTokenExpiryMode("never")}
                          className="sr-only"
                        />
                        <span className="font-sc text-sm">永久有效</span>
                        <span className="block font-sc text-xs text-ink-muted mt-1">兼容原有分发方式</span>
                      </label>
                      <label
                        className={cn(
                          "rounded-2xl hairline px-4 py-3 cursor-pointer transition",
                          tokenExpiryMode === "custom" ? "bg-peach/28 text-rose-deep" : "bg-peach/12 text-ink-soft",
                        )}
                      >
                        <input
                          type="radio"
                          name="token-expiry"
                          value="custom"
                          checked={tokenExpiryMode === "custom"}
                          onChange={() => setTokenExpiryMode("custom")}
                          className="sr-only"
                        />
                        <span className="font-sc text-sm">指定过期时间</span>
                        <span className="block font-sc text-xs text-ink-muted mt-1">到期后入口 token 无法继续使用</span>
                      </label>
                    </div>
                    <AnimatePresence>
                      {tokenExpiryMode === "custom" && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: "auto" }}
                          exit={{ opacity: 0, y: -4, height: 0 }}
                          className="overflow-hidden"
                        >
                          <input
                            type="datetime-local"
                            className="input-field"
                            min={minimumTokenExpiresAt}
                            value={tokenExpiresAt}
                            onChange={(e) => setTokenExpiresAt(e.target.value)}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button
                    type="submit"
                    disabled={creating || !aName.trim() || !bName.trim() || (tokenExpiryMode === "custom" && !tokenExpiresAt)}
                    className="btn-primary w-full sm:w-auto rounded-2xl px-6 py-3.5 font-sc text-[15px] font-medium focus-ring inline-flex items-center justify-center gap-2 min-h-[48px]"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    创建配对
                  </button>
                </form>

                {/* Result panel */}
                <AnimatePresence>
                  {created && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: 8, height: 0 }}
                      className="mt-6 overflow-hidden"
                    >
                      <div className="space-y-4 rounded-2xl bg-peach/18 p-5 hairline">
                        <div className="flex items-center gap-2 font-sc text-sm text-rose-deep">
                          <Check className="h-4 w-4" />
                          <span>配对已就绪 · pair #{created.pair_id}</span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <TokenCard
                            user={created.user_a}
                            token={created.user_a_token}
                            expiresAt={created.user_a_token_expires_at}
                            link={entryLink(created.user_a_token)}
                            onCopy={copy}
                          />
                          <TokenCard
                            user={created.user_b}
                            token={created.user_b_token}
                            expiresAt={created.user_b_token_expires_at}
                            link={entryLink(created.user_b_token)}
                            onCopy={copy}
                          />
                        </div>
                        <button
                          className="font-sc text-xs text-ink-muted hover:text-rose underline-offset-4 hover:underline"
                          onClick={() => setCreated(null)}
                        >
                          收起
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              <AIConfigPanel />

              {/* List pairs */}
              <section>
                <div className="flex items-center gap-3 mb-4 px-1">
                  <div className="h-9 w-9 grid place-items-center rounded-2xl bg-peach/30 text-rose-deep">
                    <Users className="h-4 w-4" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-ink">已发出的配对</h2>
                  <span className="font-sc text-xs text-ink-muted">{pairs.length} 对</span>
                </div>

                {loadingPairs ? (
                  <div className="glass-card rounded-3xl p-10 grid place-items-center">
                    <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
                  </div>
                ) : pairs.length === 0 ? (
                  <div className="glass-card rounded-3xl p-10 text-center font-sc text-sm text-ink-muted">
                    还没有任何配对，先创建一对吧。
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {pairs.map((p) => (
                      <PairRow
                        key={p.pair_id}
                        pair={p}
                        onCopy={copy}
                        onEntryLink={entryLink}
                        onUpdated={(updated) =>
                          setPairs((cur) =>
                            cur.map((it) => (it.pair_id === updated.pair_id ? updated : it)),
                          )
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AvatarPicker
        open={pickerFor === "a"}
        current={aAvatar}
        onClose={() => setPickerFor(null)}
        onPick={(e) => setAAvatar(e)}
        title="选择 ta 一的头像"
      />
      <AvatarPicker
        open={pickerFor === "b"}
        current={bAvatar}
        onClose={() => setPickerFor(null)}
        onPick={(e) => setBAvatar(e)}
        title="选择 ta 二的头像"
      />
    </div>
  );
}

function AIConfigPanel() {
  const [config, setConfig] = useState<AdminAIConfigOut | null>(null);
  const [protocol, setProtocol] = useState<AIProtocol>("openai");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [amapApiKey, setAmapApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [modelMessage, setModelMessage] = useState("");
  const [testResult, setTestResult] = useState<AdminAIConnectionTestOut | null>(null);
  const [testError, setTestError] = useState("");

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getAdminAIConfig();
      setConfig(next);
      setProtocol(next.protocol);
      setOpenaiBaseUrl(next.openai_base_url);
      setAnthropicBaseUrl(next.anthropic_base_url);
      setApiKey(next.api_key);
      setAmapApiKey(next.amap_api_key);
      setSelectedModel(next.selected_model || next.env_model);
      setTestResult(null);
      setTestError("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const activeBaseUrl = protocol === "openai" ? openaiBaseUrl : anthropicBaseUrl;

  function configPayload(model = selectedModel) {
    return {
      protocol,
      selected_model: model.trim(),
      openai_base_url: openaiBaseUrl.trim(),
      anthropic_base_url: anthropicBaseUrl.trim(),
      api_key: apiKey.trim(),
      amap_api_key: amapApiKey.trim(),
    };
  }

  async function loadModels() {
    setLoading(true);
    setModelMessage("");
    try {
      await api.updateAdminAIConfig(configPayload());
      const result = await api.listAdminAIModels(protocol);
      setModels(result.models);
      setModelMessage(`已获取 ${result.models.length} 个模型`);
      if (!selectedModel && result.models[0]) setSelectedModel(result.models[0]);
      setTestResult(null);
      setTestError("");
      toast.success(`模型列表已更新：${result.models.length} 个`);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig(model = selectedModel, showToast = true) {
    setSaving(true);
    try {
      const next = await api.updateAdminAIConfig(configPayload(model));
      setConfig(next);
      setTestResult(null);
      setTestError("");
      if (showToast) toast.success("模型配置已保存");
      return next;
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(showToast = true) {
    setTesting(true);
    try {
      await saveConfig(selectedModel, false);
      const result = await api.testAdminAIConfig();
      setTestResult(result);
      setTestError("");
      if (showToast) toast.success(result.message || "连接测试通过");
      return result;
    } catch (err) {
      setTestResult(null);
      setTestError(err instanceof APIError ? err.message : "AI 测试失败，请检查协议、地址、token 和模型。");
      throw err;
    } finally {
      setTesting(false);
    }
  }

  async function chooseModel(model: string) {
    setSelectedModel(model);
    if (!model) return;
    try {
      await saveConfig(model, false);
      const result = await api.testAdminAIConfig();
      setTestResult(result);
      setTestError("");
      toast.success(result.message || "模型已选择，连接测试通过");
    } catch (err) {
      setTestResult(null);
      setTestError(err instanceof APIError ? err.message : "AI 测试失败，请检查协议、地址、token 和模型。");
      // toast handled by api client
    }
  }

  return (
    <section className="glass-card rounded-3xl p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-peach/30 text-rose-deep">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">AI / 模型配置</h2>
            <p className="font-sc text-xs text-ink-muted">先选协议，再填写对应地址和 token；高德密钥单独配置。</p>
          </div>
        </div>
        <button type="button" onClick={loadConfig} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/70 focus-ring" aria-label="刷新配置">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {config && (
        <div className="mb-4 grid gap-2 rounded-2xl bg-peach/12 p-4 text-xs font-sc text-ink-soft hairline sm:grid-cols-2">
          <span>当前协议：{config.protocol === "openai" ? "OpenAI" : "Anthropic"}</span>
          <span>当前模型：{config.selected_model || "未选择"}</span>
          <span>LLM Key: {config.has_api_key ? config.api_key_preview : "未配置"}</span>
          <span>高德 Key: {config.has_amap_key ? config.amap_key_preview : "未配置"}</span>
        </div>
      )}

      <div
        className={cn(
          "mb-4 rounded-2xl border p-4 font-sc text-xs",
          testError
            ? "border-red-200 bg-red-50 text-red-700"
            : testResult
              ? "border-sage/40 bg-sage/12 text-ink-soft"
              : "border-line/70 bg-surface-raised/70 text-ink-muted",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-ink">高德取证 + 真实补全测试</span>
          <span>{testResult ? `已返回 ${testResult.sample_category || "未知"}` : testError ? "测试失败" : "尚未测试"}</span>
        </div>
        <p className="mt-2 leading-relaxed">
          {testError || testResult?.message || "保存配置后点击测试连接，会先用高德 MCP 获取样例餐厅信息，再让当前模型基于 POI 证据回答 food/play 分类。"}
        </p>
        {testResult && (
          <div className="mt-3 grid gap-2 text-ink-soft sm:grid-cols-2">
            <div className="rounded-xl bg-surface/70 p-3">
              <p className="font-medium text-ink">1. 高德 MCP 取证</p>
              <p className="mt-1">样例：{testResult.sample_keyword || "江西小炒(西溪北苑东区店)"}</p>
              <p className="mt-1">POI：{testResult.amap_name || "未返回名称"}</p>
              <p className="mt-1">地址：{testResult.amap_address || "未返回地址"}</p>
              <p className="mt-1">类型：{testResult.amap_poi_type || "未返回类型"}</p>
            </div>
            <div className="rounded-xl bg-surface/70 p-3">
              <p className="font-medium text-ink">2. LLM 基于证据判断</p>
              <p className="mt-1">返回：{testResult.sample_category || "未知"}</p>
              <p className="mt-1">POI ID：{testResult.amap_poi_id || "未返回"}</p>
              <p className="mt-1 line-clamp-3">{testResult.evidence_note || "已将高德 POI 信息作为补全输入。"}</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(["openai", "anthropic"] as AIProtocol[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setProtocol(item);
                setModels([]);
                setModelMessage("");
                setSelectedModel("");
                setTestResult(null);
                setTestError("");
              }}
              className={cn(
                "min-h-11 rounded-2xl px-4 font-sc text-sm hairline focus-ring",
                protocol === item ? "bg-peach/28 text-rose-deep" : "bg-surface-raised/72 text-ink-soft",
              )}
            >
              {item === "openai" ? "OpenAI 协议" : "Anthropic 协议"}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label className="font-sc text-xs font-medium text-ink-muted">
            {protocol === "openai" ? "OpenAI 地址" : "Anthropic 地址"}
          </label>
          <input
            className="input-field"
            value={activeBaseUrl}
            onChange={(event) =>
              protocol === "openai" ? setOpenaiBaseUrl(event.target.value) : setAnthropicBaseUrl(event.target.value)
            }
            placeholder={protocol === "openai" ? "https://example.com/v1" : "https://example.com/anthropic"}
            maxLength={500}
          />
        </div>

        <div className="space-y-2">
          <label className="font-sc text-xs font-medium text-ink-muted">
            {protocol === "openai" ? "OpenAI Token" : "Anthropic Token"}
          </label>
          <input
            className="input-field font-mono text-sm"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="填写模型服务 token"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <label className="font-sc text-xs font-medium text-ink-muted">高德 AMAP_MAPS_API_KEY</label>
          <input
            className="input-field font-mono text-sm"
            type="password"
            value={amapApiKey}
            onChange={(event) => setAmapApiKey(event.target.value)}
            placeholder="填写高德 Web 服务 Key"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <button
          type="button"
          onClick={loadModels}
          disabled={loading || !activeBaseUrl.trim() || !apiKey.trim()}
          className="btn-ghost min-h-12 w-full rounded-2xl px-4 font-sc text-sm inline-flex items-center justify-center gap-2 focus-ring"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          获取模型列表
        </button>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="font-sc text-xs font-medium text-ink-muted">选择模型</label>
            <span className="font-sc text-xs text-ink-muted">{modelMessage || `已载入 ${models.length} 个模型`}</span>
          </div>
          <select
            className="input-field"
            value={selectedModel}
            onChange={(event) => void chooseModel(event.target.value)}
            disabled={models.length === 0}
          >
            <option value="">请先获取模型列表</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void saveConfig()} disabled={saving} className="btn-primary min-h-11 rounded-2xl px-4 font-sc text-sm inline-flex items-center gap-2 focus-ring">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存配置
          </button>
          <button type="button" onClick={() => void testConnection()} disabled={testing} className="btn-ghost min-h-11 rounded-2xl px-4 font-sc text-sm inline-flex items-center gap-2 focus-ring">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            测试连接
          </button>
        </div>
      </div>
    </section>
  );
}

function UserField({
  label,
  value,
  onChange,
  avatar,
  onPickAvatar,
  placeholder,
  email,
  onEmailChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  avatar: string;
  onPickAvatar: () => void;
  placeholder: string;
  email?: string;
  onEmailChange?: (s: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="font-sc text-xs font-medium text-ink-muted">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onPickAvatar}
          className={cn(
            "flex-none h-12 w-12 rounded-2xl text-2xl grid place-items-center hairline bg-peach/18",
            "transition focus-ring",
          )}
          aria-label={`${label} 的头像`}
        >
          {avatar}
        </button>
        <input
          type="text"
          className="input-field flex-1"
          value={value}
          maxLength={100}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {onEmailChange && (
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <input
            type="email"
            className="input-field pl-9"
            value={email ?? ""}
            maxLength={255}
            placeholder="可选 · 邮箱（用于通知）"
            onChange={(e) => onEmailChange(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      )}
    </div>
  );
}

function TokenCard({
  user,
  token,
  expiresAt,
  link,
  onCopy,
}: {
  user: Pick<PairOut["user_a"], "id" | "display_name" | "avatar" | "avatar_has_image" | "avatar_updated_at">;
  token: string;
  expiresAt: string | null;
  link: string;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl bg-peach/12 p-4 hairline">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar user={user} size="sm" />
        <span className="truncate font-display text-base font-semibold text-ink">
          {user.display_name}
        </span>
      </div>
      <p className="rounded-xl bg-peach/16 p-2 font-mono text-[11px] leading-relaxed text-ink-soft break-all">
        {token}
      </p>
      <p className={cn("font-sc text-[11px]", tokenExpiryClass(expiresAt))}>
        token {formatTokenExpiry(expiresAt)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5"
          onClick={() => onCopy(token, "token")}
        >
          <Copy className="h-3 w-3" />
          复制 token
        </button>
        <button
          className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5"
          onClick={() => onCopy(link, "入口链接")}
        >
          <ArrowRight className="h-3 w-3" />
          复制入口
        </button>
      </div>
    </div>
  );
}

function PairRow({
  pair,
  onCopy,
  onEntryLink,
  onUpdated,
}: {
  pair: PairOut;
  onCopy: (text: string, label: string) => void;
  onEntryLink: (token: string) => string;
  onUpdated: (next: PairOut) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [aEmail, setAEmail] = useState(pair.user_a.email ?? "");
  const [bEmail, setBEmail] = useState(pair.user_b.email ?? "");
  const [loveStartedOn, setLoveStartedOn] = useState(pair.love_started_on);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    try {
      const updated = await api.updatePair(pair.pair_id, {
        user_a_email: aEmail.trim() || null,
        user_b_email: bEmail.trim() || null,
        love_started_on: loveStartedOn || null,
      });
      onUpdated(updated);
      toast.success("邮箱已更新");
      setEditing(false);
    } catch {
      // toast handled
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="glass-card space-y-3 rounded-3xl p-5 transition sm:p-6 hover:border-rose/35">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar user={pair.user_a} size="md" />
          <div className="font-display text-2xl text-rose">·</div>
          <Avatar user={pair.user_b} size="md" />
          <div className="ml-1 min-w-0">
            <p className="truncate font-display text-base font-semibold text-ink">
              {pair.user_a.display_name} <span className="text-rose">&</span>{" "}
              {pair.user_b.display_name}
            </p>
            <p className="font-sc text-[11px] text-ink-muted">
              pair #{pair.pair_id} · {formatAbsolute(pair.created_at)}
            </p>
            <p className={cn("font-sc text-[11px]", tokenExpiryClass(pair.user_a_token_expires_at))}>
              token {formatTokenExpiry(pair.user_a_token_expires_at)}
            </p>
            <p className="font-sc text-[11px] text-ink-muted">
              情侣日期 {pair.love_started_on}
            </p>
          </div>
        </div>
        <button
          className="btn-ghost rounded-full px-3 py-1.5 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
          onClick={() => setEditing((v) => !v)}
        >
          <Mail className="h-3 w-3" />
          {editing ? "收起邮箱" : "编辑邮箱"}
        </button>
      </div>

      {!editing && (
        <div className="grid sm:grid-cols-2 gap-2 text-[11px] font-sc text-ink-muted">
          <span className="truncate">
            {pair.user_a.display_name}：{pair.user_a.email || <i className="text-ink-muted/70">未设置</i>}
          </span>
          <span className="truncate">
            {pair.user_b.display_name}：{pair.user_b.email || <i className="text-ink-muted/70">未设置</i>}
          </span>
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <label className="font-sc text-[11px] text-ink-muted">
                  {pair.user_a.display_name} 的邮箱
                </label>
                <input
                  type="email"
                  className="input-field"
                  value={aEmail}
                  maxLength={255}
                  placeholder="example@mail.com"
                  onChange={(e) => setAEmail(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1">
                <label className="font-sc text-[11px] text-ink-muted">
                  {pair.user_b.display_name} 的邮箱
                </label>
                <input
                  type="email"
                  className="input-field"
                  value={bEmail}
                  maxLength={255}
                  placeholder="example@mail.com"
                  onChange={(e) => setBEmail(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="space-y-1 pt-3">
              <label className="font-sc text-[11px] text-ink-muted">
                情侣日期
              </label>
              <input
                type="date"
                className="input-field"
                value={loveStartedOn}
                onChange={(e) => setLoveStartedOn(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button
                className="btn-ghost rounded-full px-3 py-2 text-xs font-sc"
                onClick={() => {
                  setAEmail(pair.user_a.email ?? "");
                  setBEmail(pair.user_b.email ?? "");
                  setLoveStartedOn(pair.love_started_on);
                  setEditing(false);
                }}
                disabled={saving}
              >
                取消
              </button>
              <button
                className="btn-primary rounded-full px-4 py-2 text-xs font-sc inline-flex items-center gap-1.5"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                保存
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
          onClick={() => onCopy(pair.user_a_token, `${pair.user_a.display_name} 的 token`)}
        >
          <Copy className="h-3 w-3" /> {pair.user_a.display_name}
        </button>
        <button
          className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
          onClick={() => onCopy(pair.user_b_token, `${pair.user_b.display_name} 的 token`)}
        >
          <Copy className="h-3 w-3" /> {pair.user_b.display_name}
        </button>
        <button
          className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
          onClick={() => onCopy(onEntryLink(pair.user_a_token), `${pair.user_a.display_name} 的入口链接`)}
        >
          <ArrowRight className="h-3 w-3" /> {pair.user_a.display_name}
        </button>
        <button
          className="btn-ghost rounded-full px-3 py-2 text-xs font-sc inline-flex items-center gap-1.5 focus-ring"
          onClick={() => onCopy(onEntryLink(pair.user_b_token), `${pair.user_b.display_name} 的入口链接`)}
        >
          <ArrowRight className="h-3 w-3" /> {pair.user_b.display_name}
        </button>
      </div>
    </li>
  );
}

function formatTokenExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "永久有效";
  const date = new Date(expiresAt);
  if (date.getTime() <= Date.now()) return `已于 ${formatAbsolute(date)} 过期`;
  return `有效至 ${formatAbsolute(date)}`;
}

function tokenExpiryClass(expiresAt: string | null): string {
  if (!expiresAt) return "text-emerald-700";
  return new Date(expiresAt).getTime() <= Date.now() ? "text-red-600" : "text-ink-muted";
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for non-secure contexts or denied clipboard permissions.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (previousRange && selection) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }

  if (!copied) {
    throw new Error("Copy command failed");
  }
}
