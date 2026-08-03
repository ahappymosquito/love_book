"use client";

// Responsive Canvas renderer and accessible pointer/keyboard controller for the asset-driven Xiaohua runner.

import { useCallback, useEffect, useRef, useState } from "react";
import { Expand, Pause, Play, RotateCcw } from "lucide-react";
import {
  RUNNER_STEP,
  createRunnerMetrics,
  createRunnerState,
  jumpRunner,
  pauseRunner,
  setRunnerCrouch,
  startRunner,
  stepRunner,
  type RunnerMetrics,
  type RunnerObstacleKind,
  type RunnerState,
  type RunnerStatus,
} from "@/lib/xiaohua-runner";

const ASSET_PATHS = {
  dog: "/game/xiaohua-runner-atlas.webp",
  far: "/game/runner-scene-far.webp",
  mid: "/game/runner-scene-mid.webp",
  ground: "/game/runner-scene-ground.webp",
  obstacles: "/game/runner-obstacles.webp",
  bird: "/game/runner-bird.webp",
} as const;
const ACTION_ROW = { idle: 0, run: 1, jump: 2, crouch: 3, stumble: 4, celebrate: 5 } as const;
const ACTION_FRAMES = { idle: 4, run: 8, jump: 8, crouch: 6, stumble: 6, celebrate: 6 } as const;
const OBSTACLE_COLUMN: Record<Exclude<RunnerObstacleKind, "bird">, number> = { rock: 0, stump: 1, log: 2, bramble: 3 };

type RunnerAssets = Record<keyof typeof ASSET_PATHS, HTMLImageElement>;
type AssetStatus = "loading" | "ready" | "error";

export interface XiaohuaRunnerProps {
  leaderboardBest?: number | null;
  pauseRequested?: boolean;
  interactionBlocked?: boolean;
  celebrating?: boolean;
  onStart?: () => void;
  onGameOver?: (score: number) => void;
}

function snap(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = sourceHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawLoopingLayer(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  metrics: RunnerMetrics,
  distancePixels: number,
) {
  const tileHeight = metrics.frame.height;
  const tileWidth = Math.round(tileHeight * (image.naturalWidth / image.naturalHeight));
  const offset = Math.round(((distancePixels % tileWidth) + tileWidth) % tileWidth);
  let index = -1;
  for (let x = metrics.frame.x - offset; x < metrics.frame.x + metrics.frame.width + tileWidth; x += tileWidth) {
    context.save();
    if (index % 2 !== 0) {
      context.translate(x * 2 + tileWidth, 0);
      context.scale(-1, 1);
    }
    context.drawImage(image, x, metrics.frame.y, tileWidth, tileHeight);
    context.restore();
    index += 1;
  }
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  obstacle: RunnerState["obstacles"][number],
  metrics: RunnerMetrics,
  assets: RunnerAssets,
  dpr: number,
) {
  const x = snap(metrics.frame.x + obstacle.x * metrics.bodyUnit, dpr);
  if (obstacle.kind === "bird") {
    const frame = Math.floor(state.elapsed * 10) % 6;
    const width = metrics.bodyUnit * obstacle.width * 1.08;
    const height = metrics.standingHeight * obstacle.height * 1.22;
    const bottom = metrics.groundBaseline - obstacle.bottom * metrics.standingHeight;
    context.drawImage(assets.bird, frame * 192, 0, 192, 192, x, snap(bottom - height, dpr), width, height);
    return;
  }
  const width = obstacle.width * metrics.bodyUnit * 1.04;
  const height = obstacle.height * metrics.standingHeight * 1.08;
  context.drawImage(
    assets.obstacles,
    OBSTACLE_COLUMN[obstacle.kind] * 256,
    0,
    256,
    256,
    x,
    snap(metrics.groundBaseline - height, dpr),
    width,
    height,
  );
}

function drawScene(
  context: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  state: RunnerState,
  metrics: RunnerMetrics,
  assets: RunnerAssets,
  reducedMotion: boolean,
  celebrating: boolean,
  renderTime: number,
  dpr: number,
) {
  context.clearRect(0, 0, viewportWidth, viewportHeight);
  context.imageSmoothingEnabled = true;
  context.globalAlpha = 0.5;
  drawCover(context, assets.far, 0, 0, viewportWidth, viewportHeight);
  context.globalAlpha = 1;
  context.save();
  context.beginPath();
  context.rect(metrics.frame.x, metrics.frame.y, metrics.frame.width, metrics.frame.height);
  context.clip();
  context.imageSmoothingEnabled = false;
  drawLoopingLayer(context, assets.far, metrics, state.distance * metrics.bodyUnit * 0.035);
  drawLoopingLayer(context, assets.mid, metrics, state.distance * metrics.bodyUnit * 0.16);
  drawLoopingLayer(context, assets.ground, metrics, state.distance * metrics.bodyUnit * 0.78);
  for (const obstacle of state.obstacles) drawObstacle(context, state, obstacle, metrics, assets, dpr);

  const action: keyof typeof ACTION_ROW = state.status === "gameover"
    ? (celebrating ? "celebrate" : "stumble")
    : state.y > 0.001
      ? "jump"
      : state.crouching
        ? "crouch"
        : state.status === "playing"
          ? "run"
          : "idle";
  const actionTime = action === "celebrate" ? renderTime : state.elapsed;
  const frame = reducedMotion && (action === "idle" || action === "celebrate")
    ? 0
    : Math.floor(actionTime * (action === "run" ? 11 : 8)) % ACTION_FRAMES[action];
  const dogX = snap(metrics.playerScreenX - metrics.bodyUnit * 0.08, dpr);
  const dogY = snap(
    metrics.groundBaseline - metrics.spriteSize - state.y * metrics.standingHeight + metrics.spriteSize * (8 / 192),
    dpr,
  );
  context.drawImage(
    assets.dog,
    frame * 192,
    ACTION_ROW[action] * 192,
    192,
    192,
    dogX,
    dogY,
    metrics.spriteSize,
    metrics.spriteSize,
  );
  context.restore();
}

export function XiaohuaRunner({ leaderboardBest, pauseRequested = false, interactionBlocked = false, celebrating = false, onStart, onGameOver }: XiaohuaRunnerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createRunnerState());
  const assetsRef = useRef<RunnerAssets | null>(null);
  const gameOverScoreRef = useRef<number | null>(null);
  const pausedByPanelRef = useRef(false);
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [score, setScore] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [assetStatus, setAssetStatus] = useState<AssetStatus>("loading");
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [metrics, setMetrics] = useState<RunnerMetrics | null>(null);
  const [showHint, setShowHint] = useState(true);

  const syncUi = useCallback((state: RunnerState) => {
    setStatus((value) => (value === state.status ? value : state.status));
    setScore((value) => (value === state.score ? value : state.score));
  }, []);

  const play = useCallback(() => {
    if (assetStatus !== "ready" || interactionBlocked) return;
    const wasNewRun = stateRef.current.status === "idle" || stateRef.current.status === "gameover";
    stateRef.current = startRunner(stateRef.current);
    gameOverScoreRef.current = null;
    syncUi(stateRef.current);
    if (wasNewRun) {
      setShowHint(true);
      onStart?.();
    }
  }, [assetStatus, interactionBlocked, onStart, syncUi]);

  const jump = useCallback(() => {
    if (assetStatus !== "ready" || interactionBlocked || stateRef.current.status === "gameover") return;
    const wasNewRun = stateRef.current.status === "idle";
    if (wasNewRun) {
      stateRef.current = startRunner(stateRef.current);
      gameOverScoreRef.current = null;
      onStart?.();
    }
    stateRef.current = jumpRunner(stateRef.current);
    syncUi(stateRef.current);
  }, [assetStatus, interactionBlocked, onStart, syncUi]);

  const crouch = useCallback((held: boolean) => {
    if (assetStatus !== "ready" || interactionBlocked || stateRef.current.status === "gameover") return;
    if (held && stateRef.current.status === "idle") {
      stateRef.current = startRunner(stateRef.current);
      gameOverScoreRef.current = null;
      onStart?.();
    }
    stateRef.current = setRunnerCrouch(stateRef.current, held);
    syncUi(stateRef.current);
  }, [assetStatus, interactionBlocked, onStart, syncUi]);

  const markOperated = useCallback(() => setShowHint(false), []);

  useEffect(() => {
    if (status !== "playing" || !showHint) return;
    const timeout = window.setTimeout(() => setShowHint(false), 3_500);
    return () => window.clearTimeout(timeout);
  }, [showHint, status]);

  useEffect(() => {
    if (pauseRequested && stateRef.current.status === "playing") {
      pausedByPanelRef.current = true;
      stateRef.current = pauseRunner(stateRef.current);
      syncUi(stateRef.current);
    } else if (!pauseRequested && pausedByPanelRef.current && stateRef.current.status === "paused") {
      pausedByPanelRef.current = false;
      stateRef.current = startRunner(stateRef.current);
      syncUi(stateRef.current);
    }
  }, [pauseRequested, syncUi]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAssetStatus("loading");
    Promise.all(Object.entries(ASSET_PATHS).map(([key, source]) => new Promise<[keyof RunnerAssets, HTMLImageElement]>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([key as keyof RunnerAssets, image]);
      image.onerror = reject;
      image.src = `${source}?v=3`;
    }))).then((entries) => {
      if (cancelled) return;
      assetsRef.current = Object.fromEntries(entries) as RunnerAssets;
      setAssetStatus("ready");
    }).catch(() => {
      if (!cancelled) setAssetStatus("error");
    });
    return () => {
      cancelled = true;
      assetsRef.current = null;
    };
  }, [assetAttempt]);

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
      if (interactionBlocked || ignoresGameKeys(event.target)) return;
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
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ArrowDown" || event.code === "KeyS") crouch(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [crouch, interactionBlocked, jump, markOperated]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    const render = (now: number) => {
      const canvas = canvasRef.current;
      const shell = shellRef.current;
      const assets = assetsRef.current;
      if (canvas && shell && assets) {
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
          drawScene(context, rect.width, rect.height, stateRef.current, currentMetrics, assets, reducedMotion, celebrating, now / 1000, dpr);
        }
        syncUi(stateRef.current);
        if (stateRef.current.status === "gameover" && gameOverScoreRef.current !== stateRef.current.score) {
          gameOverScoreRef.current = stateRef.current.score;
          onGameOver?.(stateRef.current.score);
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

  const touchStyle = metrics ? {
    top: metrics.frame.y,
    left: metrics.frame.x,
    width: metrics.frame.width / 2,
    height: metrics.frame.height,
  } : undefined;

  return (
    <div ref={shellRef} className="runner-stage" data-runner-status={status} data-assets={assetStatus} data-interaction-blocked={interactionBlocked ? "true" : "false"}>
      <canvas ref={canvasRef} className="runner-canvas" role="img" aria-label="小花在春日草地上奔跑，左侧按住趴下，右侧点按跳跃" />
      {metrics ? <div className="runner-frame-blend" style={{ top: metrics.frame.y, left: metrics.frame.x, width: metrics.frame.width, height: metrics.frame.height }} aria-hidden="true" /> : null}
      {metrics && assetStatus === "ready" && !interactionBlocked && status !== "gameover" ? (
        <>
          <div
            className="runner-touch-zone runner-touch-zone-left"
            style={touchStyle}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              markOperated();
              crouch(true);
            }}
            onPointerUp={() => crouch(false)}
            onPointerCancel={() => crouch(false)}
            onLostPointerCapture={() => crouch(false)}
            aria-hidden="true"
          />
          <div
            className="runner-touch-zone runner-touch-zone-right"
            style={{ ...touchStyle, left: metrics.frame.x + metrics.frame.width / 2 }}
            onPointerDown={(event) => {
              event.preventDefault();
              markOperated();
              jump();
            }}
            aria-hidden="true"
          />
        </>
      ) : null}
      {assetStatus === "loading" ? <div className="runner-asset-status">正在铺好春日小路…</div> : null}
      {assetStatus === "error" ? (
        <div className="runner-asset-status">
          <span>场景素材没有加载成功</span>
          <button type="button" className="runner-play-button focus-ring" onClick={() => setAssetAttempt((value) => value + 1)}>重新加载</button>
        </div>
      ) : null}
      {status === "playing" && showHint ? <p className="runner-input-hint">左侧按住趴下 · 右侧点按跳跃</p> : null}
      {status === "idle" ? <p className="runner-state-banner"><strong>准备出发</strong><span>点“开始奔跑”，或按空格起跑</span></p> : null}
      {status === "paused" ? <p className="runner-state-banner"><strong>已暂停</strong><span>场景会在你继续后恢复</span></p> : null}
      <div className="runner-scoreboard" aria-live="polite">
        <span>本局 {score}</span>
        {leaderboardBest != null ? <span>纪录 {leaderboardBest}</span> : null}
      </div>
      <div className="runner-controls">
        <button type="button" className="runner-icon-button focus-ring" onClick={() => void enterLandscape()} aria-label="全屏横屏游玩">
          <Expand className="h-4 w-4" />
        </button>
        {status === "playing" ? (
          <button
            type="button"
            className="runner-icon-button focus-ring"
            onClick={() => {
              stateRef.current = pauseRunner(stateRef.current);
              syncUi(stateRef.current);
            }}
            aria-label="暂停游戏"
          >
            <Pause className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" className="runner-play-button focus-ring" onClick={play} disabled={assetStatus !== "ready"}>
            {status === "gameover" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {status === "gameover" ? "再跑一次" : status === "paused" ? "继续奔跑" : "开始奔跑"}
          </button>
        )}
      </div>
      {status === "gameover" ? <p className="runner-state-banner runner-gameover"><strong>本局结束 · {score} 分</strong><span>点“再跑一次”开启新一局</span></p> : null}
    </div>
  );
}
