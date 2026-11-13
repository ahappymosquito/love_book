"use client";

// Fullscreen unwrap experience for a wrapped gift: the receiver taps the box, the ribbon unties, the lid pops, a capped petal burst plays (none under reduced motion), the gift card rises with title/message/photos, then an optional "说说收到的感受" response step; opaque overlay without backdrop-filter, safe-area padded, Escape closes.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gift, Loader2, MessageCircleHeart, X } from "lucide-react";
import { EventImagePreview } from "@/components/event-image-preview";
import { GiftBoxArt, GiftCardPeek, type GiftBoxStage } from "@/components/gift-box";
import { GiftResponseForm } from "@/components/gift-response-form";
import { PolaroidFrame } from "@/components/scrapbook-decor";
import { APIError, api } from "@/lib/api";
import { cardTilt } from "@/lib/gift-scrapbook";
import { confettiParticles } from "@/lib/gift-state";
import { MOTION_EASE, MOTION_TRANSITIONS } from "@/lib/motion";
import type { EventDetail, GiftWrapStyle } from "@/lib/types";

type Stage = "ready" | "opening" | "revealed" | "respond";

const UNTIE_MS = 380;
const MIN_OPEN_MS = 520;

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function GiftUnwrapOverlay({
  open,
  eventId,
  wrapStyle,
  teaser,
  senderName,
  onClose,
  onFinished,
}: {
  open: boolean;
  eventId: number;
  wrapStyle: GiftWrapStyle;
  teaser: string | null;
  senderName: string;
  onClose: () => void;
  onFinished: (event: EventDetail) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState<Stage>("ready");
  const [boxStage, setBoxStage] = useState<GiftBoxStage>("wrapped");
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [burst, setBurst] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const particles = useMemo(() => confettiParticles(40, eventId, Boolean(reducedMotion)), [eventId, reducedMotion]);

  useEffect(() => {
    if (!open) return;
    setStage("ready");
    setBoxStage("wrapped");
    setDetail(null);
    setBurst(false);
    setError(null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => openButtonRef.current?.focus(), 60);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  const detailRef = useRef<EventDetail | null>(null);
  detailRef.current = detail;

  function close() {
    if (detailRef.current) onFinished(detailRef.current);
    else onClose();
  }

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  async function unwrap() {
    if (stage !== "ready") return;
    setError(null);
    setStage("opening");
    const request = api.openGift(eventId);
    try {
      if (reducedMotion) {
        const opened = await request;
        setDetail(opened);
        setBoxStage("open");
        setStage("revealed");
        return;
      }
      setBoxStage("untying");
      const [opened] = await Promise.all([request, wait(MIN_OPEN_MS)]);
      setBoxStage("lid-off");
      await wait(UNTIE_MS);
      setDetail(opened);
      setBoxStage("open");
      setBurst(true);
      setStage("revealed");
    } catch (caught) {
      setBoxStage("wrapped");
      setStage("ready");
      setError(
        caught instanceof APIError && caught.status === 409
          ? "还没到拆开的时间，再等等它"
          : caught instanceof APIError && caught.status === 403
            ? "这份礼物是给 TA 的哦"
            : "礼物有点难拆，稍后再试一次",
      );
    }
  }

  if (typeof document === "undefined") return null;

  const images = detail?.contents.images.slice(0, 3) ?? [];

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="gift-unwrap"
          role="dialog"
          aria-modal="true"
          aria-label="拆礼物"
          className="gift-unwrap-overlay fixed inset-0 z-[90] overflow-y-auto overscroll-contain"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
        >
          <button
            type="button"
            onClick={close}
            className="fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-full bg-surface-raised text-ink-soft shadow-soft hairline focus-ring"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="mx-auto flex min-h-full w-full max-w-lg flex-col items-center px-5 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-[calc(env(safe-area-inset-top,0px)+4.5rem)] text-center">
            <p className="font-sc text-xs font-semibold text-rose-deep">来自 {senderName} 的礼物</p>
            {stage === "ready" || stage === "opening" ? (
              <h2 className="scrapbook-hand mt-2 text-2xl font-semibold text-ink">{teaser || "猜猜里面是什么"}</h2>
            ) : null}

            <div className="relative mt-6 w-full">
              <motion.button
                ref={openButtonRef}
                type="button"
                onClick={() => void unwrap()}
                disabled={stage !== "ready"}
                aria-label="拆开礼物"
                className="mx-auto block w-[min(68vw,260px)] rounded-3xl focus-ring disabled:cursor-default"
                animate={
                  stage === "revealed" || stage === "respond"
                    ? reducedMotion
                      ? { opacity: 1 }
                      : { scale: 0.62, y: -8 }
                    : stage === "opening" && !reducedMotion
                      ? { rotate: [0, -3, 3, -2, 0], scale: 1.02 }
                      : { rotate: 0, scale: 1, y: 0 }
                }
                transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { duration: 0.5, ease: MOTION_EASE }}
                whileTap={stage === "ready" && !reducedMotion ? { scale: 0.97 } : undefined}
              >
                <GiftBoxArt
                  wrapStyle={wrapStyle}
                  stage={boxStage}
                  idle={stage === "ready"}
                  reducedMotion={reducedMotion}
                  inside={<GiftCardPeek />}
                  className="aspect-square w-full"
                />
              </motion.button>

              {burst && particles.length > 0 && (
                <div className="pointer-events-none absolute left-1/2 top-[40%] h-0 w-0" aria-hidden="true">
                  {particles.map((particle) => (
                    <motion.span
                      key={particle.id}
                      className={`gift-confetti gift-confetti-${particle.shape} gift-confetti-${particle.tone}`}
                      style={{ width: particle.size, height: particle.size }}
                      initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
                      animate={{
                        x: particle.x,
                        y: [0, particle.y, particle.y + 70],
                        opacity: [0, 1, 0],
                        scale: [0.4, 1, 0.9],
                        rotate: particle.rotate,
                      }}
                      transition={{ duration: 1.1, delay: particle.delay, ease: "easeOut" }}
                    />
                  ))}
                </div>
              )}
            </div>

            {stage === "ready" && (
              <p className="mt-4 font-sc text-sm text-ink-soft">轻点礼物，拆开它</p>
            )}
            {stage === "opening" && (
              <p className="mt-4 inline-flex items-center gap-2 font-sc text-sm text-ink-soft">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                正在解开丝带…
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 rounded-full bg-peach/22 px-4 py-2 font-sc text-sm text-ink">
                {error}
              </p>
            )}

            <AnimatePresence mode="wait">
              {detail && stage === "revealed" && (
                <motion.article
                  key="card"
                  className="gift-reveal-card relative -mt-6 w-full text-left"
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 70, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                  transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { duration: 0.6, ease: MOTION_EASE, delay: 0.08 }}
                >
                  <p className="font-sc text-[11px] font-semibold text-peach-deep">礼物卡片</p>
                  <h2 className="scrapbook-hand mt-1 break-words text-2xl font-semibold leading-snug text-ink">{detail.title}</h2>
                  {detail.description && (
                    <p className="mt-3 whitespace-pre-wrap break-words font-sc text-[15px] leading-relaxed text-ink-soft">{detail.description}</p>
                  )}
                  {images.length > 0 && (
                    <div className="mt-4 flex flex-wrap justify-center gap-3">
                      {images.map((image) => (
                        <PolaroidFrame key={image.id} tilt={cardTilt(image.id)} className="w-[min(40%,140px)]">
                          <EventImagePreview imageId={image.id} alt="礼物照片" className="aspect-square w-full" />
                        </PolaroidFrame>
                      ))}
                    </div>
                  )}
                  <p className="mt-4 text-right font-sc text-xs text-ink-muted">—— {senderName}</p>
                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={close} className="btn-ghost min-h-11 rounded-full px-4 font-sc text-sm focus-ring">
                      先收好
                    </button>
                    <button
                      type="button"
                      onClick={() => setStage("respond")}
                      className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring"
                    >
                      <MessageCircleHeart className="h-4 w-4" />
                      说说收到的感受
                    </button>
                  </div>
                </motion.article>
              )}
              {detail && stage === "respond" && (
                <motion.section
                  key="respond"
                  className="gift-reveal-card relative -mt-6 w-full text-left"
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.layout}
                  aria-label="说说收到的感受"
                >
                  <p className="inline-flex items-center gap-1.5 font-sc text-[11px] font-semibold text-peach-deep">
                    <Gift className="h-3.5 w-3.5" />
                    {detail.title}
                  </p>
                  <h2 className="scrapbook-hand mt-1 text-xl font-semibold text-ink">说说收到的感受</h2>
                  <div className="mt-4">
                    <GiftResponseForm eventId={detail.id} onSaved={onFinished} onSkip={() => onFinished(detail)} />
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
