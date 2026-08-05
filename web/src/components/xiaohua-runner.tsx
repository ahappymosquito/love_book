"use client";

// Full-viewport Canvas renderer with high-contrast obstacles, split mobile touch zones, desktop mouse/keyboard input, help, and pause-safe controls.

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp, Expand, Pause, Play, RotateCcw, X } from "lucide-react";
import {
  RUNNER_STEP,
  createRunnerMetrics,
  createRunnerState,
  jumpRunner,
  pauseRunner,
  runnerPointerAction,
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
const OBSTACLE_SOURCE: Record<Exclude<RunnerObstacleKind, "bird">, { x: number; y: number; width: number; height: number }> = {
  rock: { x: 5, y: 90, width: 246, height: 156 },
  stump: { x: 18, y: 38, width: 220, height: 208 },
  log: { x: 5, y: 151, width: 246, height: 95 },
  bramble: { x: 8, y: 110, width: 240, height: 136 },
};
const BIRD_SOURCE = [
  { x: 12, y: 59, width: 167, height: 73 },
  { x: 8, y: 60, width: 176, height: 71 },
  { x: 9, y: 60, width: 173, height: 71 },
  { x: 48, y: 51, width: 96, height: 89 },
  { x: 8, y: 55, width: 175, height: 81 },
  { x: 9, y: 60, width: 174, height: 72 },
] as const;

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
  const drawOutlined = (
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => {
    const outline = Math.max(1.5, metrics.standingHeight * 0.014);
    context.save();
    context.globalAlpha = 0.62;
    context.filter = "brightness(0) saturate(100%)";
    for (const [offsetX, offsetY] of [[-outline, 0], [outline, 0], [0, -outline], [0, outline]] as const) {
      context.drawImage(image, sx, sy, sw, sh, dx + offsetX, dy + offsetY, dw, dh);
    }
    context.restore();
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  };
  if (obstacle.kind === "bird") {
    const frame = Math.floor(state.elapsed * 10) % 6;
    const source = BIRD_SOURCE[frame];
    const width = metrics.bodyUnit * obstacle.width;
    const height = metrics.standingHeight * obstacle.height;
    const bottom = metrics.groundBaseline - obstacle.bottom * metrics.standingHeight;
    drawOutlined(assets.bird, frame * 192 + source.x, source.y, source.width, source.height, x, snap(bottom - height, dpr), width, height);
    return;
  }
  const source = OBSTACLE_SOURCE[obstacle.kind];
  const width = obstacle.width * metrics.bodyUnit;
  const height = obstacle.height * metrics.standingHeight;
  context.save();
  context.fillStyle = "rgba(21, 48, 24, 0.34)";
  context.beginPath();
  context.ellipse(x + width / 2, metrics.groundBaseline + Math.max(2, height * 0.025), width * 0.46, Math.max(3, height * 0.055), 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
  drawOutlined(
    assets.obstacles,
    OBSTACLE_COLUMN[obstacle.kind] * 256 + source.x,
    source.y,
    source.width,
    source.height,
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
  const [crouching, setCrouching] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [assetStatus, setAssetStatus] = useState<AssetStatus>("loading");
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [metrics, setMetrics] = useState<RunnerMetrics | null>(null);
  const [showHint, setShowHint] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const touchCrouchPointerRef = useRef<number | null>(null);
  const inputBlocked = interactionBlocked || helpOpen;

  const syncUi = useCallback((state: RunnerState) => {
    setStatus((value) => (value === state.status ? value : state.status));
    setScore((value) => (value === state.score ? value : state.score));
    setCrouching((value) => (value === state.crouching ? value : state.crouching));
  }, []);

  const play = useCallback(() => {
    if (assetStatus !== "ready" || inputBlocked) return;
    const wasNewRun = stateRef.current.status === "idle" || stateRef.current.status === "gameover";
    stateRef.current = startRunner(stateRef.current);
    gameOverScoreRef.current = null;
    syncUi(stateRef.current);
    if (wasNewRun) {
      setShowHint(true);
      onStart?.();
    }
  }, [assetStatus, inputBlocked, onStart, syncUi]);

  const jump = useCallback(() => {
    if (assetStatus !== "ready" || inputBlocked || stateRef.current.status === "gameover") return;
    const wasNewRun = stateRef.current.status === "idle";
    if (wasNewRun) {
      stateRef.current = startRunner(stateRef.current);
      gameOverScoreRef.current = null;
      onStart?.();
    }
    stateRef.current = jumpRunner(stateRef.current);
    syncUi(stateRef.current);
  }, [assetStatus, inputBlocked, onStart, syncUi]);

  const crouch = useCallback((held: boolean) => {
    if (assetStatus !== "ready") return;
    if (!held) {
      stateRef.current = setRunnerCrouch(stateRef.current, false);
      syncUi(stateRef.current);
      return;
    }
    if (inputBlocked || stateRef.current.status === "gameover") return;
    if (held && stateRef.current.status === "idle") {
      stateRef.current = startRunner(stateRef.current);
      gameOverScoreRef.current = null;
      onStart?.();
    }
    stateRef.current = setRunnerCrouch(stateRef.current, held);
    syncUi(stateRef.current);
  }, [assetStatus, inputBlocked, onStart, syncUi]);

  const markOperated = useCallback(() => setShowHint(false), []);

  useEffect(() => {
    if (status !== "playing" || !showHint) return;
    const timeout = window.setTimeout(() => setShowHint(false), 3_500);
    return () => window.clearTimeout(timeout);
  }, [showHint, status]);

  useEffect(() => {
    const shouldPause = pauseRequested || helpOpen;
    if (shouldPause && stateRef.current.status === "playing") {
      pausedByPanelRef.current = true;
      stateRef.current = pauseRunner(stateRef.current);
      syncUi(stateRef.current);
    } else if (!shouldPause && pausedByPanelRef.current && stateRef.current.status === "paused") {
      pausedByPanelRef.current = false;
      stateRef.current = startRunner(stateRef.current);
      syncUi(stateRef.current);
    }
  }, [helpOpen, pauseRequested, syncUi]);

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
  }, [crouch, inputBlocked, jump, markOperated]);

  useEffect(() => {
    const releaseRightMouse = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button === 2) crouch(false);
    };
    const releaseAll = () => crouch(false);
    window.addEventListener("pointerup", releaseRightMouse);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releaseRightMouse);
      window.removeEventListener("blur", releaseAll);
    };
  }, [crouch]);

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

  const interactionStyle = metrics ? {
    top: metrics.frame.y,
    left: metrics.frame.x,
    width: metrics.frame.width,
    height: metrics.frame.height,
  } : undefined;

  return (
    <div ref={shellRef} className="runner-stage" data-runner-status={status} data-crouching={crouching ? "true" : "false"} data-assets={assetStatus} data-interaction-blocked={inputBlocked ? "true" : "false"} data-pointer={coarsePointer ? "coarse" : "fine"}>
      <canvas ref={canvasRef} className="runner-canvas" role="img" aria-label="小花在青青草原上奔跑，电脑左键或上方向键跳跃、右键或下方向键按住趴下，手机左侧按住趴下、右侧点按跳跃" />
      {metrics && assetStatus === "ready" && !inputBlocked && status !== "gameover" ? (
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
      {assetStatus === "loading" ? <div className="runner-asset-status">正在铺好春日小路…</div> : null}
      {assetStatus === "error" ? (
        <div className="runner-asset-status">
          <span>场景素材没有加载成功</span>
          <button type="button" className="runner-play-button focus-ring" onClick={() => setAssetAttempt((value) => value + 1)}>重新加载</button>
        </div>
      ) : null}
      {status === "playing" && showHint ? <p className="runner-input-hint">{coarsePointer ? "左侧按住趴下 · 右侧点按跳跃" : "左键 / ↑ 跳跃 · 右键 / ↓ 按住趴下"}</p> : null}
      {status === "idle" ? <p className="runner-state-banner"><strong>点击草地，马上开跑</strong><span>{coarsePointer ? "左侧按住趴下，右侧点按跳跃" : "左键或 ↑ 跳跃，右键或 ↓ 按住趴下"}</span></p> : null}
      {status === "paused" ? <p className="runner-state-banner"><strong>已暂停</strong><span>场景会在你继续后恢复</span></p> : null}
      <div className="runner-scoreboard" aria-live="polite">
        <span>本局 {score}</span>
        {leaderboardBest != null ? <span>纪录 {leaderboardBest}</span> : null}
      </div>
      <div className="runner-controls">
        <button type="button" className="runner-icon-button focus-ring" onClick={() => setHelpOpen((value) => !value)} aria-label="查看玩法" aria-expanded={helpOpen}>
          <CircleHelp className="h-4 w-4" />
        </button>
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
          <button type="button" className="runner-play-button focus-ring" onClick={play} disabled={assetStatus !== "ready" || inputBlocked}>
            {status === "gameover" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {status === "gameover" ? "再跑一次" : status === "paused" ? "继续奔跑" : "开始奔跑"}
          </button>
        )}
      </div>
      {helpOpen ? (
        <aside className="runner-help-popover" aria-label="小花跑酷玩法">
          <button type="button" className="runner-close focus-ring" onClick={() => setHelpOpen(false)} aria-label="关闭玩法"><X className="h-4 w-4" /></button>
          <strong>怎么玩</strong>
          <p>{coarsePointer ? "按住屏幕左侧趴下，松开起身；点按屏幕右侧跳跃。" : "鼠标左键或 ↑ 跳跃，鼠标右键或 ↓ 按住趴下；空格和 S 也可以使用。"}</p>
          <p>越过地面障碍，趴下躲开低飞小鸟。</p>
        </aside>
      ) : null}
      {status === "gameover" ? <p className="runner-state-banner runner-gameover"><strong>本局结束 · {score} 分</strong><span>点“再跑一次”开启新一局</span></p> : null}
    </div>
  );
}
