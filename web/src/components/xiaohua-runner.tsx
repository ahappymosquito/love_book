"use client";

// 全视口「花田拾光」画布：代码绘制小狗与花田，待机呼吸，仅在开始菜单开局后接受跳蹲。

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CircleHelp, Expand, Pause, X } from "lucide-react";
import {
  RUNNER_CHAPTER_LABELS,
  RUNNER_MAX_LIVES,
  RUNNER_STARTING_LIVES,
  RUNNER_STEP,
  createRunnerMetrics,
  createRunnerState,
  jumpRunner,
  pauseRunner,
  releaseRunnerJump,
  runnerPointerAction,
  setRunnerCrouch,
  startRunner,
  stepRunner,
  type RunnerChapterId,
  type RunnerMetrics,
  type RunnerState,
  type RunnerStatus,
} from "@/lib/xiaohua-runner";
import { CHAPTER_SKY, drawScene } from "@/lib/xiaohua-runner-draw";

export interface XiaohuaRunnerHandle {
  play: () => void;
  pause: () => void;
}

export interface RunnerGameOverSummary {
  score: number;
  chapter: RunnerChapterId;
  petals: number;
  maxCombo: number;
}

export interface XiaohuaRunnerProps {
  leaderboardBest?: number | null;
  pauseRequested?: boolean;
  interactionBlocked?: boolean;
  celebrating?: boolean;
  onGameOver?: (summary: RunnerGameOverSummary) => void;
  onPause?: () => void;
}

function HeartPips({ lives }: { lives: number }) {
  return (
    <span className="runner-hearts" aria-label={`还剩 ${lives} 颗小心心`}>
      {Array.from({ length: RUNNER_MAX_LIVES }, (_, index) => (
        <span key={index} data-filled={index < lives ? "true" : "false"}>♥</span>
      ))}
    </span>
  );
}

export const XiaohuaRunner = forwardRef<XiaohuaRunnerHandle, XiaohuaRunnerProps>(function XiaohuaRunner(
  {
    leaderboardBest,
    pauseRequested = false,
    interactionBlocked = false,
    celebrating = false,
    onGameOver,
    onPause,
  },
  ref,
) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createRunnerState());
  const gameOverScoreRef = useRef<number | null>(null);
  const pausedByPanelRef = useRef(false);
  const lastChapterRef = useRef<RunnerChapterId>("dawn");
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(RUNNER_STARTING_LIVES);
  const [petals, setPetals] = useState(0);
  const [chapter, setChapter] = useState<RunnerChapterId>("dawn");
  const [chapterToast, setChapterToast] = useState<string | null>(null);
  const [crouching, setCrouching] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [metrics, setMetrics] = useState<RunnerMetrics | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const touchCrouchPointerRef = useRef<number | null>(null);
  const inputBlocked = interactionBlocked || helpOpen;

  const syncUi = useCallback((state: RunnerState) => {
    setStatus((value) => (value === state.status ? value : state.status));
    setScore((value) => (value === state.score ? value : state.score));
    setCombo((value) => (value === state.combo ? value : state.combo));
    setLives((value) => (value === state.lives ? value : state.lives));
    setPetals((value) => (value === state.petals ? value : state.petals));
    setCrouching((value) => (value === state.crouching ? value : state.crouching));
    setChapter((value) => (value === state.chapter ? value : state.chapter));
    if (state.status === "playing" && state.chapter !== lastChapterRef.current) {
      lastChapterRef.current = state.chapter;
      if (state.chapter !== "dawn") setChapterToast(RUNNER_CHAPTER_LABELS[state.chapter]);
    }
    if (state.status === "idle" || state.status === "gameover") lastChapterRef.current = state.chapter;
  }, []);

  const play = useCallback(() => {
    const wasNewRun = stateRef.current.status === "idle" || stateRef.current.status === "gameover";
    stateRef.current = startRunner(stateRef.current);
    gameOverScoreRef.current = null;
    pausedByPanelRef.current = false;
    if (wasNewRun) {
      lastChapterRef.current = "dawn";
      setChapterToast(null);
      setShowHint(true);
    }
    syncUi(stateRef.current);
  }, [syncUi]);

  const pause = useCallback(() => {
    if (stateRef.current.status !== "playing") return;
    pausedByPanelRef.current = false;
    stateRef.current = pauseRunner(stateRef.current);
    syncUi(stateRef.current);
    onPause?.();
  }, [onPause, syncUi]);

  useImperativeHandle(ref, () => ({ play, pause }), [pause, play]);

  const jump = useCallback(() => {
    if (inputBlocked || stateRef.current.status !== "playing") return;
    stateRef.current = jumpRunner(stateRef.current);
    syncUi(stateRef.current);
  }, [inputBlocked, syncUi]);

  const releaseJump = useCallback(() => {
    stateRef.current = releaseRunnerJump(stateRef.current);
  }, []);

  const crouch = useCallback((held: boolean) => {
    if (!held) {
      stateRef.current = setRunnerCrouch(stateRef.current, false);
      syncUi(stateRef.current);
      return;
    }
    if (inputBlocked || stateRef.current.status !== "playing") return;
    stateRef.current = setRunnerCrouch(stateRef.current, held);
    syncUi(stateRef.current);
  }, [inputBlocked, syncUi]);

  const markOperated = useCallback(() => setShowHint(false), []);

  useEffect(() => {
    if (status !== "playing" || !showHint) return;
    const timeout = window.setTimeout(() => setShowHint(false), 3_500);
    return () => window.clearTimeout(timeout);
  }, [showHint, status]);

  useEffect(() => {
    if (!chapterToast) return;
    const timeout = window.setTimeout(() => setChapterToast(null), 2_200);
    return () => window.clearTimeout(timeout);
  }, [chapterToast]);

  const applyOverlayBlock = useCallback((blocked: boolean) => {
    if (blocked) {
      if (stateRef.current.status === "playing") {
        pausedByPanelRef.current = true;
        stateRef.current = pauseRunner(stateRef.current);
        syncUi(stateRef.current);
      }
      return;
    }
    if (pausedByPanelRef.current && stateRef.current.status === "paused") {
      pausedByPanelRef.current = false;
      stateRef.current = startRunner(stateRef.current);
      syncUi(stateRef.current);
    }
  }, [syncUi]);

  const setHelp = useCallback((open: boolean) => {
    setHelpOpen(open);
    applyOverlayBlock(open || pauseRequested);
  }, [applyOverlayBlock, pauseRequested]);

  useEffect(() => {
    applyOverlayBlock(pauseRequested || helpOpen);
  }, [applyOverlayBlock, helpOpen, pauseRequested]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => {
      const rect = shell.getBoundingClientRect();
      setMetrics(createRunnerMetrics({ width: rect.width, height: rect.height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stateRef.current = pauseRunner(stateRef.current);
        syncUi(stateRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [syncUi]);

  useEffect(() => {
    const ignoresGameKeys = (target: EventTarget | null) => (target as HTMLElement | null)?.closest("input, textarea, button");
    const onKeyDown = (event: KeyboardEvent) => {
      if (inputBlocked || ignoresGameKeys(event.target)) return;
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) {
          markOperated();
          jump();
        }
      } else if (event.code === "ArrowDown" || event.code === "KeyS") {
        event.preventDefault();
        markOperated();
        crouch(true);
      } else if (event.code === "Escape" && stateRef.current.status === "playing") {
        event.preventDefault();
        pause();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ArrowDown" || event.code === "KeyS") crouch(false);
      if (event.code === "Space" || event.code === "ArrowUp") releaseJump();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [crouch, inputBlocked, jump, markOperated, pause, releaseJump]);

  useEffect(() => {
    const releaseRightMouse = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button === 2) crouch(false);
      if (event.pointerType === "mouse" && event.button === 0) releaseJump();
    };
    const releaseAll = () => {
      crouch(false);
      releaseJump();
    };
    window.addEventListener("pointerup", releaseRightMouse);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releaseRightMouse);
      window.removeEventListener("blur", releaseAll);
    };
  }, [crouch, releaseJump]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    const render = (now: number) => {
      const canvas = canvasRef.current;
      const shell = shellRef.current;
      if (canvas && shell) {
        const rect = shell.getBoundingClientRect();
        const currentMetrics = createRunnerMetrics({ width: rect.width, height: rect.height });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
        const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
          canvas.width = nextWidth;
          canvas.height = nextHeight;
        }
        const delta = Math.min(0.1, (now - previous) / 1000);
        previous = now;
        accumulator += delta;
        while (accumulator >= RUNNER_STEP) {
          stateRef.current = stepRunner(stateRef.current, RUNNER_STEP, currentMetrics.worldWidth);
          accumulator -= RUNNER_STEP;
        }
        const context = canvas.getContext("2d");
        if (context) {
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawScene(context, rect.width, rect.height, stateRef.current, currentMetrics, reducedMotion, celebrating, now / 1000, dpr);
        }
        syncUi(stateRef.current);
        if (stateRef.current.status === "gameover" && gameOverScoreRef.current !== stateRef.current.score) {
          gameOverScoreRef.current = stateRef.current.score;
          onGameOver?.({
            score: stateRef.current.score,
            chapter: stateRef.current.chapter,
            petals: stateRef.current.petals,
            maxCombo: stateRef.current.maxCombo,
          });
        }
      } else {
        previous = now;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [celebrating, onGameOver, reducedMotion, syncUi]);

  async function enterLandscape() {
    try {
      await shellRef.current?.requestFullscreen?.();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (value: "landscape") => Promise<void> };
      await orientation.lock?.("landscape");
    } catch {
      // Fullscreen and orientation lock are progressive enhancements.
    }
  }

  const interactionStyle = metrics
    ? {
        top: metrics.frame.y,
        left: metrics.frame.x,
        width: metrics.frame.width,
        height: metrics.frame.height,
      }
    : undefined;

  return (
    <div
      ref={shellRef}
      className="runner-stage"
      data-runner-status={status}
      data-chapter={chapter}
      data-crouching={crouching ? "true" : "false"}
      data-interaction-blocked={inputBlocked ? "true" : "false"}
      data-pointer={coarsePointer ? "coarse" : "fine"}
      style={{ background: CHAPTER_SKY[chapter] }}
    >
      <canvas
        ref={canvasRef}
        className="runner-canvas"
        role="img"
        aria-label="小花在花田里拾光，电脑左键或上方向键跳跃、按住可跳得更高，右键或下方向键按住趴下，手机左侧按住趴下、右侧点按跳跃"
      />
      {metrics && !inputBlocked && status === "playing" ? (
        <div
          className="runner-interaction-surface"
          style={interactionStyle}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic or cancelled pointers can disappear before capture; window-level release still resets crouch.
            }
            const action = runnerPointerAction({
              pointerType: event.pointerType,
              button: event.button,
              clientX: event.clientX,
              bounds: event.currentTarget.getBoundingClientRect(),
            });
            if (!action) return;
            markOperated();
            if (action === "jump") jump();
            else {
              if (event.pointerType !== "mouse") touchCrouchPointerRef.current = event.pointerId;
              crouch(true);
            }
          }}
          onPointerUp={(event) => {
            if (event.pointerType === "mouse") {
              if (event.button === 2) crouch(false);
              if (event.button === 0) releaseJump();
              return;
            }
            if (touchCrouchPointerRef.current === event.pointerId) {
              touchCrouchPointerRef.current = null;
              crouch(false);
            }
          }}
          onPointerCancel={(event) => {
            if (touchCrouchPointerRef.current === event.pointerId) {
              touchCrouchPointerRef.current = null;
              crouch(false);
            }
          }}
          onLostPointerCapture={(event) => {
            if (touchCrouchPointerRef.current === event.pointerId) {
              touchCrouchPointerRef.current = null;
              crouch(false);
            }
          }}
          aria-hidden="true"
        />
      ) : null}
      {status === "playing" && showHint ? (
        <p className="runner-input-hint">{coarsePointer ? "左侧按住趴下 · 右侧点按跳跃" : "按住跳跃会更高 · 右键 / ↓ 趴下"}</p>
      ) : null}
      {chapterToast ? <p className="runner-chapter-toast" aria-live="polite">{chapterToast}</p> : null}
      <div className="runner-scoreboard" aria-live="polite">
        <HeartPips lives={status === "idle" ? RUNNER_STARTING_LIVES : lives} />
        <span>本局 {score}</span>
        {combo > 1 ? <span>连击 {combo}</span> : null}
        <span className="runner-chapter-label">{RUNNER_CHAPTER_LABELS[chapter]}</span>
        {leaderboardBest != null ? <span>纪录 {leaderboardBest}</span> : null}
        {status === "playing" || status === "paused" ? <span className="sr-only">已拾 {petals} 片花瓣</span> : null}
      </div>
      <div className="runner-controls">
        <button type="button" className="runner-icon-button focus-ring" onMouseDown={(event) => event.preventDefault()} onClick={() => setHelp(!helpOpen)} aria-label="查看玩法" aria-expanded={helpOpen}>
          <CircleHelp className="h-4 w-4" />
        </button>
        <button type="button" className="runner-icon-button focus-ring" onMouseDown={(event) => event.preventDefault()} onClick={() => void enterLandscape()} aria-label="全屏横屏游玩">
          <Expand className="h-4 w-4" />
        </button>
        {status === "playing" ? (
          <button
            type="button"
            className="runner-icon-button focus-ring"
            onMouseDown={(event) => event.preventDefault()}
            onClick={pause}
            aria-label="暂停游戏"
          >
            <Pause className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {helpOpen ? (
        <aside className="runner-help-popover content-surface" aria-label="花田拾光玩法">
          <button type="button" className="runner-close focus-ring" onClick={() => setHelp(false)} aria-label="关闭玩法"><X className="h-4 w-4" /></button>
          <strong>怎么玩</strong>
          <p>{coarsePointer ? "按住屏幕左侧趴下，松开起身；点按屏幕右侧跳跃。" : "鼠标左键或 ↑ 跳跃，按住会跳得更高；右键或 ↓ 按住趴下。"}</p>
          <p>越过石头和树桩，趴下躲开小鸟。跳起来拾花瓣，连上之后能捡到更高的信封。</p>
          <p>撞到障碍会失去一颗小心心；走得越远，天色会从晨光走到星夜。</p>
        </aside>
      ) : null}
    </div>
  );
});
