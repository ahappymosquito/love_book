"use client";

// Responsive shared editor for a meeting title and inclusive Beijing date range, with merge preview and cancellation.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { MeetingSessionLite, MeetingSessionOut } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";

interface Props {
  open: boolean;
  session: MeetingSessionLite | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (session: MeetingSessionOut) => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}

export function MeetingEditorDialog({ open, session, onOpenChange, onSaved, onDeleted }: Props) {
  const reducedMotion = useReducedMotion();
  const [title, setTitle] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [endedOn, setEndedOn] = useState("");
  const [sessions, setSessions] = useState<MeetingSessionOut[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open || !session) return;
    setTitle(session.title);
    setStartedOn(session.started_on);
    setEndedOn(session.ended_on);
    setConfirmDelete(false);
    api.listMeetingSessions().then(setSessions).catch(() => setSessions([]));
  }, [open, session]);

  const overlaps = useMemo(() => {
    if (!session || !startedOn || !endedOn || startedOn > endedOn) return [];
    return sessions.filter((item) =>
      item.id !== session.id && item.started_on <= endedOn && startedOn <= item.ended_on,
    );
  }, [endedOn, session, sessions, startedOn]);

  const retained = useMemo(() => {
    if (!session || !overlaps.length) return null;
    const current = sessions.find((item) => item.id === session.id);
    if (!current) return null;
    return [current, ...overlaps].sort((a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id - b.id,
    )[0];
  }, [overlaps, session, sessions]);

  async function save() {
    if (!session || saving) return;
    if (!title.trim()) return void toast.error("请填写见面标题");
    if (!startedOn || !endedOn) return void toast.error("请选择开始和结束日期");
    if (startedOn > endedOn) return void toast.error("结束日期不能早于开始日期");
    setSaving(true);
    try {
      const updated = await api.updateMeetingSession(session.id, {
        title: title.trim(), started_on: startedOn, ended_on: endedOn,
      });
      await onSaved(updated);
      toast.success(overlaps.length ? "见面已合并并重新归类" : "见面信息已保存");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!session || deleting) return;
    setDeleting(true);
    try {
      await api.deleteMeetingSession(session.id);
      await onDeleted();
      toast.success("这次见面已取消");
      setConfirmDelete(false);
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <AnimatePresence>
      {open && session && <motion.div
        className="fixed inset-0 z-[70] flex items-end justify-center overflow-x-hidden sm:items-center sm:p-6"
        initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <button className="absolute inset-0 bg-ink/40 backdrop-blur-sm" aria-label="关闭见面编辑"
          onClick={() => !saving && onOpenChange(false)} />
        <motion.section role="dialog" aria-modal="true" aria-labelledby="meeting-editor-title"
          className="content-surface relative max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-[1.75rem] border border-line/70 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-4 shadow-card sm:max-w-lg sm:rounded-[1.75rem] sm:p-7"
          initial={reducedMotion ? false : { y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 32, opacity: 0 }}
        >
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line sm:hidden" />
          <div className="flex items-start justify-between gap-4">
            <div><h2 id="meeting-editor-title" className="font-display text-xl font-semibold text-ink">编辑这次见面</h2>
              <p className="mt-1 font-sc text-sm leading-6 text-ink-soft">日期范围内的小事会自动收进这次见面。</p></div>
            <button className="focus-ring grid size-11 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-rose-soft/60"
              onClick={() => onOpenChange(false)} disabled={saving} aria-label="关闭"><X className="size-5" /></button>
          </div>
          <div className="mt-6 space-y-5">
            <label className="block font-sc text-sm text-ink">见面标题
              <input className="input-field mt-2 w-full" value={title} maxLength={200} autoFocus disabled={saving}
                onChange={(event) => setTitle(event.target.value)} /></label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block font-sc text-sm text-ink">开始日期
                <input type="date" className="input-field mt-2 w-full min-w-0" value={startedOn} disabled={saving}
                  onChange={(event) => setStartedOn(event.target.value)} /></label>
              <label className="block font-sc text-sm text-ink">结束日期
                <input type="date" className="input-field mt-2 w-full min-w-0" value={endedOn} min={startedOn || undefined} disabled={saving}
                  onChange={(event) => setEndedOn(event.target.value)} /></label>
            </div>
          </div>
          {retained && <div className="mt-5 flex gap-3 rounded-2xl border border-peach/45 bg-peach/10 p-4 text-sm text-ink-soft">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-deep" /><p className="leading-6">
              这个范围会和 {overlaps.length} 次已有见面重叠。保存后自动合并，并保留较早创建的标题“{retained.id === session.id ? title.trim() || session.title : retained.title}”。
            </p></div>}
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm text-rose-deep hover:bg-rose-soft/55"
              onClick={() => setConfirmDelete(true)} disabled={saving}><Trash2 className="size-4" />取消这次见面</button>
            <button className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium"
              onClick={save} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}{saving ? "保存中…" : "保存见面"}</button>
          </div>
        </motion.section>
      </motion.div>}
    </AnimatePresence>
    <ConfirmDialog open={confirmDelete} title="取消这次见面？"
      description="这个日期范围会被删除，其中的小事会按剩余见面范围重新归类。"
      confirmLabel="确认取消" destructive loading={deleting} onConfirm={remove}
      onCancel={() => !deleting && setConfirmDelete(false)} />
  </>;
}
