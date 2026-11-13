"use client";

// Event detail screen styled as a scrapbook page for memories, meetings, and gifts: creator-only metadata editing (a wrapped gift's sender can re-wrap title, card message, teaser, paper, and open time), a shared meeting editor both partners can open from the calendar heart, polaroid-framed private images, and a mobile-safe composer. A wrapped gift shows the receiver only the box, teaser, sender, and countdown with the unwrap overlay, and hides comments until opened; opened gifts show the card, photos, and the receiver's response or response form.

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Trash2,
  CalendarHeart,
  Check,
  Gift as GiftIcon,
  Pencil,
  Sparkles,
  Lock,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { AppHeader } from "@/components/app-header";
import { Avatar } from "@/components/avatar";
import { Composer } from "@/components/composer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GiftBoxArt, GiftCardPeek } from "@/components/gift-box";
import { GiftCountdownPill, useGiftClock } from "@/components/gift-countdown";
import { GiftResponseForm, GiftResponseSticker, GiftStampRating } from "@/components/gift-response-form";
import { GiftUnwrapOverlay } from "@/components/gift-unwrap-overlay";
import { GiftWrapStylePicker } from "@/components/gift-wrap-form";
import { PolaroidFrame, WashiTapeStrip } from "@/components/scrapbook-decor";
import { ImageThumb } from "@/components/image-thumb";
import { Lightbox } from "@/components/lightbox";
import { LoadingScreen } from "@/components/loading-screen";
import { MeetingEditorDialog } from "@/components/meeting-editor-dialog";
import { VisibilityBadge } from "@/components/visibility-badge";
import { api } from "@/lib/api";
import { GIFT_FEELING_OPTIONS } from "@/lib/gift-feelings";
import { cardTilt, washiFor } from "@/lib/gift-scrapbook";
import { DEFAULT_GIFT_WRAP_STYLE, deriveGiftView, giftWrapStyleOf, isGiftEvent } from "@/lib/gift-state";
import { useAppStore } from "@/lib/store";
import { formatAbsolute, formatRelative, fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { MOTION_EASE, MOTION_TRANSITIONS } from "@/lib/motion";
import type {
  CommentOut,
  CommentReactionSummary,
  CommentReactionType,
  EventDetail,
  ImageOut,
  GiftFeeling,
  GiftWrapStyle,
  UserOut,
  VisibilityMode,
} from "@/lib/types";
import { cn } from "@/lib/cn";

interface PendingComment {
  kind: "comment";
  pendingId: string;
  text: string;
  authorId: number;
  createdAt: string;
}
interface PendingImage {
  kind: "image";
  pendingId: string;
  authorId: number;
  blobUrl: string;
  createdAt: string;
}
type Pending = PendingComment | PendingImage;

const COMMENT_REACTIONS: {
  type: CommentReactionType;
  label: string;
  Icon: typeof ThumbsUp;
}[] = [
  { type: "like", label: "点赞", Icon: ThumbsUp },
  { type: "dislike", label: "倒赞", Icon: ThumbsDown },
];

export default function EventDetailPage() {
  return (
    <AuthGate>
      <EventDetailInner />
    </AuthGate>
  );
}

function EventDetailInner() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const router = useRouter();
  const me = useAppStore((s) => s.me)!;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingKind, setUpdatingKind] = useState(false);
  const [meetingEditorOpen, setMeetingEditorOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editOccurredAt, setEditOccurredAt] = useState("");
  const [editVisibility, setEditVisibility] = useState<VisibilityMode>("public");
  const [editGiftRating, setEditGiftRating] = useState<number | null>(null);
  const [editGiftFeelings, setEditGiftFeelings] = useState<GiftFeeling[]>([]);
  const [editTeaser, setEditTeaser] = useState("");
  const [editWrapStyle, setEditWrapStyle] = useState<GiftWrapStyle>(DEFAULT_GIFT_WRAP_STYLE);
  const [editOpenAt, setEditOpenAt] = useState("");
  const [respondingGift, setRespondingGift] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const giftNow = useGiftClock(event?.gift_state === "wrapped" ? event.gift_open_at : null);

  const load = useCallback(async () => {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
    } catch {
      router.replace("/timeline");
    }
  }, [eventId, router]);

  useEffect(() => {
    if (Number.isNaN(eventId)) return;
    void load();
  }, [eventId, load]);

  async function refreshContents() {
    try {
      const c = await api.getContents(eventId);
      setEvent((prev) => (prev ? { ...prev, contents: c, submission_state: c.submission_state } : prev));
    } catch {
      // toast handled
    }
  }

  function replaceComment(updated: CommentOut) {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        contents: {
          ...prev.contents,
          comments: prev.contents.comments.map((comment) => (comment.id === updated.id ? updated : comment)),
        },
      };
    });
  }

  async function handleToggleCommentReaction(comment: CommentOut, reactionType: CommentReactionType) {
    const previous = comment;
    const selected = comment.reactions.find((reaction) => reaction.reacted_by_me)?.reaction_type;
    const nextComment = {
      ...comment,
      reactions: nextReactionSummaries(comment.reactions, reactionType),
    };
    replaceComment(nextComment);
    try {
      const updated =
        selected === reactionType
          ? await api.deleteCommentReaction(comment.id)
          : await api.setCommentReaction(comment.id, reactionType);
      replaceComment(updated);
    } catch {
      replaceComment(previous);
    }
  }

  function lookupAuthor(authorId: number): UserOut {
    if (!event) return me.user;
    if (authorId === me.user.id) return me.user;
    if (authorId === me.counterpart.id) return me.counterpart;
    return me.user;
  }

  const stream = useMemo(() => {
    if (!event) return [];
    type StreamItem =
      | { kind: "comment"; data: CommentOut; pending?: false }
      | { kind: "image"; data: ImageOut; pending?: false }
      | { kind: "comment-pending"; data: PendingComment }
      | { kind: "image-pending"; data: PendingImage };

    const items: StreamItem[] = [];
    for (const c of event.contents.comments) items.push({ kind: "comment", data: c });
    if (!isGiftEvent(event)) {
      for (const i of event.contents.images) items.push({ kind: "image", data: i });
    }
    for (const p of pending) {
      if (p.kind === "comment") items.push({ kind: "comment-pending", data: p });
      if (p.kind === "image") items.push({ kind: "image-pending", data: p });
    }
    const timeOf = (it: StreamItem) => {
      if (
        it.kind === "comment-pending" ||
        it.kind === "image-pending"
      ) {
        return new Date(it.data.createdAt).getTime();
      }
      return new Date(it.data.created_at).getTime();
    };
    items.sort((a, b) => timeOf(a) - timeOf(b));
    return items;
  }, [event, pending]);

  async function handleSendText(text: string) {
    const tempId = `c-${Date.now()}`;
    const createdAt = new Date().toISOString();
    setPending((p) => [
      ...p,
      { kind: "comment", pendingId: tempId, text, authorId: me.user.id, createdAt },
    ]);
    try {
      await api.postComment(eventId, text);
      setPending((p) => p.filter((x) => x.kind !== "comment" || x.pendingId !== tempId));
      await refreshContents();
    } catch {
      setPending((p) => p.filter((x) => x.kind !== "comment" || x.pendingId !== tempId));
    }
  }

  async function handlePickImages(files: File[]) {
    const additions: PendingImage[] = files.map((f, i) => ({
      kind: "image",
      pendingId: `i-${Date.now()}-${i}`,
      authorId: me.user.id,
      blobUrl: URL.createObjectURL(f),
      createdAt: new Date(Date.now() + i).toISOString(),
    }));
    setPending((p) => [...p, ...additions]);

    let ok = 0;
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      const tempId = additions[idx].pendingId;
      try {
        await api.postImage(eventId, file);
        ok++;
      } catch {
        // toast handled
      } finally {
        setPending((p) => {
          const next = p.filter((x) => !(x.kind === "image" && x.pendingId === tempId));
          return next;
        });
        URL.revokeObjectURL(additions[idx].blobUrl);
      }
    }
    if (ok > 0) await refreshContents();
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteEvent(eventId);
      toast.success("已删除这条记录");
      router.replace("/timeline");
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleToggleMeetingKind() {
    if (!event || updatingKind) return;
    if (event.meeting_session) {
      setMeetingEditorOpen(true);
      return;
    }
    const previous = event;
    setUpdatingKind(true);
    setEvent({ ...event, event_kind: isGiftEvent(event) ? event.event_kind : "offline_meeting" });
    try {
      const updated = await api.updateEvent(event.id, { event_kind: "offline_meeting" });
      setEvent(updated);
      toast.success("已放进见面时间河流");
    } catch {
      setEvent(previous);
    } finally {
      setUpdatingKind(false);
    }
  }

  function beginEditing() {
    if (!event) return;
    setEditTitle(event.title);
    setEditDescription(event.description ?? "");
    setEditOccurredAt(event.occurred_at ? toLocalInputValue(new Date(event.occurred_at)) : "");
    setEditVisibility(event.visibility_mode);
    setEditGiftRating(event.gift_rating);
    setEditGiftFeelings(event.gift_feelings);
    setEditTeaser(event.gift_teaser ?? "");
    setEditWrapStyle(giftWrapStyleOf(event.gift_wrap_style));
    setEditOpenAt(event.gift_open_at ? toLocalInputValue(new Date(event.gift_open_at)) : "");
    setEditing(true);
  }

  async function saveEventEdit() {
    if (!event || !editTitle.trim() || savingEdit) return;
    const legacyGift = event.event_kind === "gift_received";
    const wrappedGift = event.event_kind === "gift" && event.gift_state === "wrapped";
    setSavingEdit(true);
    try {
      const updated = await api.updateEvent(
        event.id,
        wrappedGift
          ? {
              title: editTitle.trim(),
              description: editDescription.trim() || null,
              gift_teaser: editTeaser.trim() || null,
              gift_wrap_style: editWrapStyle,
              gift_open_at: editOpenAt ? fromLocalInputValue(editOpenAt) : null,
            }
          : {
              title: editTitle.trim(),
              description: editDescription.trim() || null,
              occurred_at: editOccurredAt ? fromLocalInputValue(editOccurredAt) : null,
              visibility_mode: legacyGift ? "public" : editVisibility,
              gift_rating: legacyGift ? editGiftRating : undefined,
              gift_feelings: legacyGift ? editGiftFeelings : undefined,
            },
      );
      setEvent(updated);
      setEditing(false);
      toast.success(wrappedGift ? "礼物重新包好了" : "记录已保存");
    } catch {
      // toast handled
    } finally {
      setSavingEdit(false);
    }
  }

  function toggleEditGiftFeeling(value: GiftFeeling) {
    setEditGiftFeelings((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= 3) {
        toast.error("最多选择 3 个感受");
        return current;
      }
      return [...current, value];
    });
  }

  if (!event) {
    return (
      <>
        <AppHeader back={{ href: "/timeline" }} />
        <LoadingScreen />
      </>
    );
  }

  const creator = lookupAuthor(event.creator_id);
  const isMine = event.creator_id === me.user.id;
  const isMeeting = event.meeting_session !== null;
  const isGift = isGiftEvent(event);
  const gift = isGift ? deriveGiftView(event, me.user.id, giftNow) : null;
  const giftReceiverId = gift ? gift.receiverId ?? (isMine ? me.counterpart.id : me.user.id) : null;
  const giftSenderId = gift ? gift.senderId ?? (giftReceiverId === me.user.id ? me.counterpart.id : me.user.id) : null;
  const giftSenderName = giftSenderId === me.user.id ? "你" : lookupAuthor(giftSenderId ?? me.counterpart.id).display_name;
  const giftReceiverName = giftReceiverId === me.user.id ? "你" : lookupAuthor(giftReceiverId ?? me.counterpart.id).display_name;
  const giftWrapped = Boolean(gift && (gift.phase === "ready" || gift.phase === "sealed" || gift.phase === "waiting"));
  const canEdit = isMine && (!gift || gift.legacy || gift.phase === "waiting");
  const submission = event.submission_state;
  const locked = !submission.unlocked && event.visibility_mode === "mutual_submit";
  const canOpenMeetingHeart = isMine || isMeeting;
  const meetingHeartLabel = isMeeting ? "编辑这次见面" : "记成一次见面";
  const editingWrappedGift = event.event_kind === "gift" && event.gift_state === "wrapped";

  return (
    <div className="viewport-guard relative z-[60] min-h-dvh w-full bg-[rgb(var(--cream)/1)] pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">
      <AppHeader
        back={{ href: "/timeline" }}
        title={isGift ? "一份礼物" : "一笔小事"}
        rightSlot={
          canEdit || canOpenMeetingHeart || isMine ? (
            <>
              {canEdit && (
                <button
                  onClick={beginEditing}
                  disabled={editing || savingEdit}
                  className="grid h-11 w-11 place-items-center rounded-full text-ink-soft transition hover:bg-peach/16 hover:text-rose-deep focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={editingWrappedGift ? "重新包装礼物" : "编辑记录"}
                  title={editingWrappedGift ? "重新包装礼物" : "编辑记录"}
                >
                  <Pencil className="h-[18px] w-[18px]" />
                </button>
              )}
              {canOpenMeetingHeart && (
                <button
                  onClick={handleToggleMeetingKind}
                  disabled={updatingKind || editing}
                  className={cn(
                    "grid h-11 w-11 place-items-center rounded-full transition focus-ring disabled:cursor-wait disabled:opacity-60",
                    isMeeting
                      ? "bg-rose/12 text-rose-deep hover:bg-rose/18"
                      : "text-ink-soft hover:bg-peach/16 hover:text-rose-deep",
                  )}
                  aria-label={meetingHeartLabel}
                  title={meetingHeartLabel}
                >
                  <CalendarHeart className="h-5 w-5" />
                </button>
              )}
              {isMine && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="grid h-11 w-11 place-items-center rounded-full text-rose-deep hover:bg-rose-deep/10 focus-ring"
                  aria-label="删除这条记录"
                  title="删除这条记录"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
            </>
          ) : undefined
        }
      />

      <div ref={containerRef} className="mx-auto w-full max-w-3xl min-w-0 px-4 pt-4 sm:px-6 pb-8">
        {gift && (gift.phase === "ready" || gift.phase === "sealed") ? (
          <GiftSealedPanel
            eventId={event.id}
            wrapStyle={gift.wrapStyle}
            teaser={event.gift_teaser}
            openAt={event.gift_open_at}
            now={giftNow}
            canOpen={gift.canOpen}
            senderName={giftSenderName}
            meetingTitle={event.meeting_session?.title ?? null}
            onOpened={(updated) => setEvent(updated)}
          />
        ) : (
          <>
            {isGift && !editing && event.contents.images.length > 0 && (
              <section className="scrapbook-page scrapbook-paper-dots mb-4 flex flex-wrap justify-center gap-4 px-4 py-5" aria-label="礼物照片">
                {event.contents.images.map((image) => (
                  <PolaroidFrame key={image.id} tilt={cardTilt(image.id)} className="w-[min(44%,200px)]">
                    <ImageThumb imageId={image.id} onClick={(url) => setLightbox(url)} className="!h-auto !w-full aspect-square !rounded-none" />
                  </PolaroidFrame>
                ))}
              </section>
            )}

            <motion.section
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 1.01 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { duration: 0.36, ease: MOTION_EASE }}
              className={cn("scrapbook-page scrapbook-detail-hero relative p-5 sm:p-6", isGift ? "scrapbook-paper-grid" : "scrapbook-paper-lines")}
            >
              <WashiTapeStrip tape={washiFor(event.id)} />
              {gift && (
                <div className="mb-3 flex items-center gap-3">
                  <GiftBoxArt
                    wrapStyle={gift.wrapStyle}
                    stage={gift.phase === "waiting" ? "wrapped" : "open"}
                    idle={gift.phase === "waiting"}
                    reducedMotion={reducedMotion}
                    inside={<GiftCardPeek />}
                    className="h-16 w-16 flex-none sm:h-20 sm:w-20"
                  />
                  <div className="min-w-0">
                    <p className="font-sc text-xs text-ink-muted">
                      {gift.legacy ? `${giftReceiverName}收到的礼物` : `${giftSenderName} 送给 ${giftReceiverName}`}
                    </p>
                    {gift.phase === "waiting" ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="gift-waiting-stamp">等 {giftReceiverName} 拆开</span>
                        <GiftCountdownPill openAt={event.gift_open_at} now={giftNow} />
                      </div>
                    ) : event.gift_opened_at ? (
                      <p className="mt-0.5 font-sc text-xs text-ink-soft">{formatAbsolute(event.gift_opened_at)} 拆开</p>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {isMeeting && (
                  <span className="pill inline-flex items-center gap-1.5 bg-rose/10 text-rose-deep">
                    <CalendarHeart className="h-3 w-3" />
                    {event.meeting_session?.title ?? "见面"}
                  </span>
                )}
                {!isGift && <VisibilityBadge mode={event.visibility_mode} />}
                {event.occurred_at && (
                  <span className="pill inline-flex items-center gap-1.5 bg-peach/22 text-ink-soft">
                    <CalendarHeart className="h-3 w-3" />
                    {formatAbsolute(event.occurred_at)}
                  </span>
                )}
              </div>

              {editing ? (
                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="event-edit-title" className="font-sc text-xs font-medium text-ink-muted">{editingWrappedGift ? "礼物是什么" : "标题"}</label>
                    <input
                      id="event-edit-title"
                      className="input-field font-display text-lg font-semibold"
                      value={editTitle}
                      maxLength={200}
                      autoFocus
                      disabled={savingEdit}
                      onChange={(inputEvent) => setEditTitle(inputEvent.target.value)}
                    />
                  </div>
                  {editingWrappedGift && (
                    <>
                      <div className="space-y-2">
                        <label htmlFor="event-edit-teaser" className="font-sc text-xs font-medium text-ink-muted">写在盒子上的小提示</label>
                        <input
                          id="event-edit-teaser"
                          className="input-field"
                          value={editTeaser}
                          maxLength={60}
                          disabled={savingEdit}
                          onChange={(inputEvent) => setEditTeaser(inputEvent.target.value)}
                        />
                      </div>
                      <fieldset className="space-y-2">
                        <legend className="font-sc text-xs font-medium text-ink-muted">包装纸</legend>
                        <GiftWrapStylePicker value={editWrapStyle} onChange={setEditWrapStyle} disabled={savingEdit} />
                      </fieldset>
                    </>
                  )}
                  <div className="space-y-2">
                    <label htmlFor="event-edit-description" className="font-sc text-xs font-medium text-ink-muted">
                      {editingWrappedGift ? "藏在卡片里的话" : isGift ? "反馈" : "内容"}
                    </label>
                    <textarea
                      id="event-edit-description"
                      className="input-field min-h-28 resize-y font-sc leading-relaxed"
                      value={editDescription}
                      maxLength={2000}
                      disabled={savingEdit}
                      onChange={(inputEvent) => setEditDescription(inputEvent.target.value)}
                    />
                  </div>
                  {isGift && !editingWrappedGift && (
                    <fieldset className="space-y-2">
                      <legend className="font-sc text-xs font-medium text-ink-muted">收到时的感受（最多 3 个）</legend>
                      <div className="flex flex-wrap gap-2">
                        {GIFT_FEELING_OPTIONS.map((option) => {
                          const selected = editGiftFeelings.includes(option.value);
                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={savingEdit || (!selected && editGiftFeelings.length >= 3)}
                              onClick={() => toggleEditGiftFeeling(option.value)}
                              aria-pressed={selected}
                              className={cn(
                                "min-h-10 rounded-full px-3 font-sc text-xs transition focus-ring disabled:opacity-45",
                                selected ? "bg-peach/30 text-ink ring-1 ring-peach-deep/28" : "bg-cream-deep/55 text-ink-soft",
                              )}
                            >
                              {option.emoji} {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {editingWrappedGift ? (
                      <div className="space-y-2">
                        <label htmlFor="event-edit-open-at" className="font-sc text-xs font-medium text-ink-muted">什么时候才能拆（留空就是随时）</label>
                        <input
                          id="event-edit-open-at"
                          type="datetime-local"
                          className="input-field font-sc"
                          value={editOpenAt}
                          disabled={savingEdit}
                          onChange={(inputEvent) => setEditOpenAt(inputEvent.target.value)}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label htmlFor="event-edit-time" className="font-sc text-xs font-medium text-ink-muted">发生时间</label>
                        <input
                          id="event-edit-time"
                          type="datetime-local"
                          className="input-field font-sc"
                          value={editOccurredAt}
                          disabled={savingEdit}
                          onChange={(inputEvent) => setEditOccurredAt(inputEvent.target.value)}
                        />
                      </div>
                    )}
                    {isGift && !editingWrappedGift ? (
                      <fieldset className="space-y-2">
                        <legend className="font-sc text-xs font-medium text-ink-muted">喜欢印章（可选）</legend>
                        <GiftStampRating value={editGiftRating} onChange={setEditGiftRating} disabled={savingEdit} />
                      </fieldset>
                    ) : !isGift ? (
                      <fieldset className="space-y-2">
                        <legend className="font-sc text-xs font-medium text-ink-muted">可见方式</legend>
                        <div className="grid grid-cols-2 gap-2">
                          {(["public", "mutual_submit"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              disabled={savingEdit}
                              aria-pressed={editVisibility === mode}
                              className={cn(
                                "min-h-11 rounded-2xl px-3 font-sc text-sm transition focus-ring",
                                editVisibility === mode ? "bg-rose text-white" : "bg-peach/18 text-ink-soft hover:bg-peach/28",
                              )}
                              onClick={() => setEditVisibility(mode)}
                            >
                              {mode === "public" ? "公开" : "双方提交后"}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-line/55 pt-4">
                    <button
                      type="button"
                      className="btn-ghost inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring"
                      disabled={savingEdit}
                      onClick={() => setEditing(false)}
                    >
                      <X className="h-4 w-4" />
                      取消编辑
                    </button>
                    <button
                      type="button"
                      className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!editTitle.trim() || savingEdit}
                      onClick={() => void saveEventEdit()}
                    >
                      {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {editingWrappedGift ? "重新包好" : "保存记录"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="scrapbook-hand mt-3 break-words text-2xl font-bold leading-snug text-ink sm:text-3xl">
                    {event.title}
                  </h1>
                  {gift && gift.phase === "waiting" && event.gift_teaser && (
                    <p className="mt-2 font-sc text-sm text-ink-soft">盒子上写着：{event.gift_teaser}</p>
                  )}
                  {event.description && !(gift?.legacy) && (
                    <p className="scrapbook-card-message mt-3 max-w-[70ch] whitespace-pre-wrap break-words font-sc text-[15px] leading-relaxed text-ink-soft">
                      {event.description}
                    </p>
                  )}
                </>
              )}

              <div className="mt-5 flex items-center gap-3">
                <Avatar user={creator} size="sm" />
                <div>
                  <p className="font-sc text-xs text-ink-muted">由 {creator.display_name} 起笔</p>
                  <p className="font-sc text-[11px] text-ink-muted/80" title={formatAbsolute(event.created_at)}>
                    {formatRelative(event.created_at)}
                  </p>
                </div>
              </div>
            </motion.section>

            {gift && gift.phase === "opened" && !editing && (
              <section className="mt-4" aria-label="收到礼物的回音">
                {gift.hasResponse && !respondingGift ? (
                  <div className="flex flex-col items-start gap-2">
                    <GiftResponseSticker
                      feelings={event.gift_feelings}
                      rating={event.gift_rating}
                      feedback={gift.feedback}
                      receiverName={giftReceiverName}
                    />
                    {gift.canRespond && (
                      <button type="button" onClick={() => setRespondingGift(true)} className="btn-ghost min-h-10 rounded-full px-4 font-sc text-xs focus-ring">
                        改一改回音
                      </button>
                    )}
                  </div>
                ) : gift.canRespond ? (
                  <div className="scrapbook-page scrapbook-paper-lines p-5 sm:p-6">
                    <h2 className="scrapbook-hand text-xl font-semibold text-ink">说说收到的感受</h2>
                    <div className="mt-4">
                      <GiftResponseForm
                        eventId={event.id}
                        initialFeelings={event.gift_feelings}
                        initialRating={event.gift_rating}
                        initialFeedback={event.gift_feedback ?? ""}
                        submitLabel={gift.hasResponse ? "保存回音" : "留下回音"}
                        onSkip={gift.hasResponse ? () => setRespondingGift(false) : undefined}
                        onSaved={(updated) => {
                          setEvent(updated);
                          setRespondingGift(false);
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="font-sc text-sm text-ink-muted">
                    {gift.legacy && giftReceiverId === me.user.id
                      ? "点右上角的铅笔，可以补上收到时的感受。"
                      : `等 ${giftReceiverName} 写下收到时的感受。`}
                  </p>
                )}
              </section>
            )}
          </>
        )}

        {!isGift && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06, duration: 0.32 }}
            className="mt-4 grid grid-cols-2 gap-3"
          >
            <SubmissionTile
              user={me.user}
              submitted={submission.current_user_submitted}
              mine
            />
            <SubmissionTile
              user={me.counterpart}
              submitted={submission.counterpart_submitted}
            />
          </motion.section>
        )}

        {locked && !isGift && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl bg-peach/20 px-4 py-3 hairline">
            <Lock className="h-4 w-4 text-rose-deep mt-0.5" />
            <p className="font-sc text-xs text-ink-soft leading-relaxed">
              这是一条「双方提交后可见」的记录。等你们都写下一点，就会一起解开。
            </p>
          </div>
        )}

        {!isGift && submission.unlocked && event.contents.comments.length + event.contents.images.length > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-sage/18 px-4 py-2 font-sc text-xs text-ink-soft">
            <Sparkles className="h-3 w-3" />
            已解锁双方的全部内容
          </div>
        )}

        {giftWrapped ? (
          <p className="mt-6 text-center font-sc text-sm text-ink-muted">礼物拆开之后，就可以在这里聊聊啦。</p>
        ) : (
          <section className="mt-6 space-y-4">
            {stream.length === 0 && (
              <div className="text-center font-sc text-sm text-ink-muted py-10">
                这里还没有内容。说点什么吧 ↓
              </div>
            )}

            <AnimatePresence initial={false}>
              {stream.map((item, idx) => {
                const authorId =
                  item.kind === "comment-pending" ||
                  item.kind === "image-pending"
                    ? item.data.authorId
                    : item.data.author_id;
                const time =
                  item.kind === "comment-pending" ||
                  item.kind === "image-pending"
                    ? item.data.createdAt
                    : item.data.created_at;
                const author = lookupAuthor(authorId);
                const isMine = authorId === me.user.id;
                const itemKey =
                  item.kind === "comment-pending" ||
                  item.kind === "image-pending"
                    ? `pending-${item.data.pendingId}`
                    : `${item.kind}-${item.data.id}`;

                return (
                  <motion.div
                    key={itemKey}
                    layout
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={
                      reducedMotion
                        ? MOTION_TRANSITIONS.reduced
                        : { ...MOTION_TRANSITIONS.state, delay: Math.min(idx, 6) * 0.02 }
                    }
                    className={cn(
                      "flex gap-3 items-end",
                      isMine ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <Avatar user={author} size="sm" />

                    <div
                      className={cn(
                        "max-w-[78%] flex flex-col gap-1",
                        isMine ? "items-end" : "items-start",
                      )}
                    >
                      <div className="flex items-baseline gap-2 px-1">
                        <span className="font-sc text-[11px] text-ink-soft">{author.display_name}</span>
                        <span className="font-sc text-[10px] text-ink-muted/80" title={formatAbsolute(time)}>
                          {formatRelative(time)}
                        </span>
                      </div>

                      {item.kind === "comment" && (
                        <CommentBubble
                          comment={item.data}
                          text={item.data.text}
                          isMine={isMine}
                          onToggleReaction={handleToggleCommentReaction}
                        />
                      )}
                      {item.kind === "comment-pending" && (
                        <div
                          className={cn(
                            "px-4 py-2.5 max-w-full font-sc text-[15px] leading-relaxed whitespace-pre-wrap break-words opacity-70",
                            isMine
                              ? "rounded-2xl rounded-tr-md bg-rose text-white shadow-soft"
                              : "rounded-2xl rounded-tl-md bg-peach/18 text-ink hairline",
                          )}
                        >
                          {item.data.text}
                          <span className="ml-2 text-[10px] opacity-80">发送中…</span>
                        </div>
                      )}

                      {item.kind === "image" && (
                        <PolaroidFrame tilt={cardTilt(item.data.id)}>
                          <ImageThumb
                            imageId={item.data.id}
                            onClick={(u) => setLightbox(u)}
                            className="!rounded-none"
                          />
                        </PolaroidFrame>
                      )}
                      {item.kind === "image-pending" && (
                        <PolaroidFrame>
                          <ImageThumb
                            imageId={-1}
                            pending
                            localUrl={item.data.blobUrl}
                            onClick={(u) => setLightbox(u)}
                            className="!rounded-none"
                          />
                        </PolaroidFrame>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </section>
        )}
      </div>

      {!giftWrapped && (
        <Composer
          onSendText={handleSendText}
          onPickImages={handlePickImages}
        />
      )}

      <Lightbox url={lightbox} onClose={() => setLightbox(null)} />

      <MeetingEditorDialog open={meetingEditorOpen} session={event.meeting_session}
        onOpenChange={setMeetingEditorOpen} onSaved={async () => load()} onDeleted={async () => load()} />

      <ConfirmDialog
        open={confirmDelete}
        title={isGift ? "收回这份礼物？" : "删除这条记录？"}
        description={isGift ? "删除后，礼物卡片、照片和留言都会一并消失。要确认吗？" : "一旦删除，连带的评论和图片都会一并消失。要确认吗？"}
        confirmLabel="删除"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function GiftSealedPanel({
  eventId,
  wrapStyle,
  teaser,
  openAt,
  now,
  canOpen,
  senderName,
  meetingTitle,
  onOpened,
}: {
  eventId: number;
  wrapStyle: GiftWrapStyle;
  teaser: string | null;
  openAt: string | null;
  now: number;
  canOpen: boolean;
  senderName: string;
  meetingTitle: string | null;
  onOpened: (event: EventDetail) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [unwrapping, setUnwrapping] = useState(false);

  return (
    <motion.section
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 1.01 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { duration: 0.36, ease: MOTION_EASE }}
      className="scrapbook-page scrapbook-paper-dots relative flex flex-col items-center px-5 py-8 text-center sm:py-10"
    >
      <WashiTapeStrip tape={washiFor(eventId)} />
      <p className="font-sc text-xs font-semibold text-rose-deep">来自 {senderName} 的礼物</p>
      {meetingTitle && (
        <span className="pill mt-2 inline-flex items-center gap-1.5 bg-rose/10 text-rose-deep">
          <CalendarHeart className="h-3 w-3" />
          {meetingTitle}
        </span>
      )}
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => setUnwrapping(true)}
        className="mt-5 w-[min(56vw,220px)] rounded-3xl focus-ring disabled:cursor-default"
        aria-label={canOpen ? "拆开礼物" : "礼物还不能拆"}
      >
        <GiftBoxArt wrapStyle={wrapStyle} idle={canOpen} reducedMotion={reducedMotion} className="aspect-square w-full" />
      </button>
      <h1 className="scrapbook-hand mt-4 break-words text-2xl font-semibold leading-snug text-ink">{teaser || "猜猜里面是什么"}</h1>
      {canOpen ? (
        <button
          type="button"
          onClick={() => setUnwrapping(true)}
          className="btn-primary mt-5 inline-flex min-h-12 items-center gap-2 rounded-full px-6 font-sc text-sm font-medium focus-ring"
        >
          <GiftIcon className="h-4 w-4" />
          拆开它
        </button>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-2">
          <GiftCountdownPill openAt={openAt} now={now} />
          <p className="font-sc text-xs text-ink-muted">到时间就能亲手拆开啦</p>
        </div>
      )}
      <GiftUnwrapOverlay
        open={unwrapping}
        eventId={eventId}
        wrapStyle={wrapStyle}
        teaser={teaser}
        senderName={senderName}
        onClose={() => setUnwrapping(false)}
        onFinished={(updated) => {
          setUnwrapping(false);
          onOpened(updated);
        }}
      />
    </motion.section>
  );
}

function nextReactionSummaries(
  reactions: CommentReactionSummary[],
  targetType: CommentReactionType,
): CommentReactionSummary[] {
  const selected = reactions.find((reaction) => reaction.reacted_by_me)?.reaction_type;
  const counts = new Map<CommentReactionType, number>();
  for (const reaction of reactions) {
    counts.set(reaction.reaction_type, reaction.count);
  }
  if (selected) {
    counts.set(selected, Math.max(0, (counts.get(selected) ?? 0) - 1));
  }
  const nextSelected = selected === targetType ? null : targetType;
  if (nextSelected) {
    counts.set(nextSelected, (counts.get(nextSelected) ?? 0) + 1);
  }
  return COMMENT_REACTIONS.flatMap(({ type }) => {
    const count = counts.get(type) ?? 0;
    return count > 0
      ? [
          {
            reaction_type: type,
            count,
            reacted_by_me: type === nextSelected,
          },
        ]
      : [];
  });
}

function CommentBubble({
  comment,
  text,
  isMine,
  pending,
  onToggleReaction,
}: {
  comment?: CommentOut;
  text: string;
  isMine: boolean;
  pending?: boolean;
  onToggleReaction?: (comment: CommentOut, reactionType: CommentReactionType) => void | Promise<void>;
}) {
  const reducedMotion = useReducedMotion();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactionHoverOpen, setReactionHoverOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const selectedType = comment?.reactions.find((reaction) => reaction.reacted_by_me)?.reaction_type;
  const canReact = Boolean(comment && onToggleReaction && !pending);

  function clearLongPress() {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startLongPress(event: PointerEvent<HTMLDivElement>) {
    if (!canReact || event.pointerType === "mouse") return;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      setPickerOpen(true);
      longPressTimer.current = null;
    }, 460);
  }

  function toggleReaction(reactionType: CommentReactionType) {
    if (!comment || !onToggleReaction) return;
    void onToggleReaction(comment, reactionType);
    setPickerOpen(false);
  }

  return (
    <div className={cn("max-w-full", isMine ? "items-end" : "items-start")}>
      <div
        className="relative max-w-full"
        onMouseEnter={() => {
          if (canReact) setReactionHoverOpen(true);
        }}
        onMouseLeave={() => setReactionHoverOpen(false)}
      >
        <div
          onPointerDown={startLongPress}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
          onContextMenu={(event) => {
            if (canReact) event.preventDefault();
          }}
          className={cn(
            "px-4 py-2.5 max-w-full font-sc text-[15px] leading-relaxed whitespace-pre-wrap break-words select-text",
            pending && "opacity-70",
            isMine
              ? "rounded-2xl rounded-tr-md bg-rose text-white shadow-soft"
              : "rounded-2xl rounded-tl-md bg-peach/18 text-ink hairline",
          )}
        >
          {text}
          {pending && <span className="ml-2 text-[10px] opacity-80">发送中...</span>}
        </div>

        {canReact && (
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 z-20 hidden -translate-y-1/2 gap-1 rounded-full bg-surface-raised/95 p-1 opacity-0 shadow-soft transition-opacity duration-200 md:flex hairline",
              reactionHoverOpen && "pointer-events-auto opacity-100",
              isMine ? "right-full mr-1" : "left-full ml-1",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-0 h-full w-3",
                isMine ? "-right-3" : "-left-3",
              )}
            />
            {COMMENT_REACTIONS.map((reaction) => (
              <ReactionIconButton
                key={reaction.type}
                reaction={reaction}
                selected={selectedType === reaction.type}
                onClick={() => toggleReaction(reaction.type)}
              />
            ))}
          </div>
        )}
      </div>

      {comment && comment.reactions.length > 0 && (
        <div className={cn("mt-1 flex flex-wrap gap-1.5 px-1", isMine ? "justify-end" : "justify-start")}>
          {comment.reactions.map((reaction) => {
            const config = COMMENT_REACTIONS.find((item) => item.type === reaction.reaction_type);
            if (!config) return null;
            const Icon = config.Icon;
            return (
              <motion.button
                key={reaction.reaction_type}
                type="button"
                onClick={() => toggleReaction(reaction.reaction_type)}
                disabled={!canReact}
                layout
                whileTap={reducedMotion || !canReact ? undefined : { scale: 0.96 }}
                transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors focus-ring",
                  reaction.reacted_by_me
                    ? "bg-rose/18 text-rose-deep"
                    : "bg-peach/20 text-ink-soft hairline",
                  canReact ? "cursor-pointer hover:bg-rose/12" : "cursor-default",
                )}
                aria-pressed={reaction.reacted_by_me}
                aria-label={`${config.label} ${reaction.count}`}
              >
                <motion.span
                  animate={reaction.reacted_by_me && !reducedMotion ? { scale: [1, 1.14, 1] } : { scale: 1 }}
                  transition={MOTION_TRANSITIONS.state}
                >
                  <Icon className="h-3.5 w-3.5" />
                </motion.span>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={reaction.count}
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
                  >
                    {reaction.count}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>
      )}

      <AnimatePresence initial={false}>
        {pickerOpen && canReact && (
          <motion.div
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="选择留言表情"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.overlay}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/30"
              aria-label="关闭表情选择"
              onClick={() => setPickerOpen(false)}
            />
            <motion.div
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { ...MOTION_TRANSITIONS.state, duration: 0.24 }}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-surface-raised p-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] shadow-glow hairline"
            >
              <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line" />
              <div className="flex items-center justify-center gap-4">
                {COMMENT_REACTIONS.map((reaction) => (
                  <ReactionIconButton
                    key={reaction.type}
                    reaction={reaction}
                    selected={selectedType === reaction.type}
                    onClick={() => toggleReaction(reaction.type)}
                    large
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReactionIconButton({
  reaction,
  selected,
  onClick,
  large,
}: {
  reaction: (typeof COMMENT_REACTIONS)[number];
  selected: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const Icon = reaction.Icon;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={reducedMotion ? undefined : { scale: 0.94 }}
      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
      className={cn(
        "grid place-items-center rounded-full transition-colors focus-ring",
        large ? "h-14 w-14" : "h-9 w-9",
        selected ? "bg-rose text-white" : "bg-peach/24 text-ink-soft hover:bg-rose/12 hover:text-rose-deep",
      )}
      aria-label={reaction.label}
      aria-pressed={selected}
      title={reaction.label}
    >
      <motion.span
        animate={selected && !reducedMotion ? { scale: [1, 1.14, 1] } : { scale: 1 }}
        transition={MOTION_TRANSITIONS.state}
      >
        <Icon className={cn(large ? "h-6 w-6" : "h-4 w-4")} />
      </motion.span>
    </motion.button>
  );
}

function SubmissionTile({
  user,
  submitted,
  mine,
}: {
  user: UserOut;
  submitted: boolean;
  mine?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl p-4 hairline",
        submitted ? "bg-sage/18" : "bg-peach/18",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar user={user} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-sc text-sm text-ink truncate">
            {user.display_name}
            {mine && <span className="text-ink-muted text-xs ml-1">(你)</span>}
          </p>
          <p
            className={cn(
              "font-sc text-xs flex items-center gap-1 mt-0.5",
              submitted ? "text-sage" : "text-ink-muted",
            )}
          >
            {submitted ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                已写下
              </>
            ) : (
              <>
                <Circle className="h-3 w-3" />
                还没写
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
