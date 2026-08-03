"use client";

// Full-screen Canvas 2D grassland runner with fixed-step physics, pixel rendering, and accessible controls.

import { useCallback, useEffect, useRef, useState } from "react";
import { Expand, Pause, Play, RotateCcw } from "lucide-react";
import {
  RUNNER_STEP,
  createRunnerState,
  jumpRunner,
  pauseRunner,
  startRunner,
  stepRunner,
  type RunnerState,
  type RunnerStatus,
} from "@/lib/xiaohua-runner";

const ATLAS_PATH = "/game/xiaohua-runner-atlas.webp";
const ACTION_ROW = { idle: 0, run: 1, jump: 2, stumble: 3, celebrate: 4 } as const;
const ACTION_FRAMES = { idle: 4, run: 8, jump: 6, stumble: 6, celebrate: 6 } as const;

export interface XiaohuaRunnerProps {
  leaderboardBest?: number | null;
  pauseRequested?: boolean;
  celebrating?: boolean;
  onStart?: () => void;
  onGameOver?: (score: number) => void;
}

function drawPixelDog(context: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  context.fillStyle = "#d79447";
  context.fillRect(x + 22 * scale, y + 18 * scale, 42 * scale, 42 * scale);
  context.fillRect(x + 14 * scale, y + 48 * scale, 58 * scale, 31 * scale);
  context.fillStyle = "#fff4d9";
  context.fillRect(x + 34 * scale, y + 18 * scale, 16 * scale, 34 * scale);
  context.fillRect(x + 26 * scale, y + 56 * scale, 36 * scale, 18 * scale);
  context.fillStyle = "#382b28";
  context.fillRect(x + 28 * scale, y + 35 * scale, 5 * scale, 5 * scale);
  context.fillRect(x + 54 * scale, y + 35 * scale, 5 * scale, 5 * scale);
  context.fillStyle = "#4d8a58";
  context.fillRect(x + 36 * scale, y + 72 * scale, 18 * scale, 6 * scale);
  context.fillStyle = "#f4a0ae";
  context.fillRect(x + 18 * scale, y + 13 * scale, 8 * scale, 8 * scale);
  context.fillRect(x + 34 * scale, y + 9 * scale, 8 * scale, 8 * scale);
  context.fillRect(x + 50 * scale, y + 13 * scale, 8 * scale, 8 * scale);
}

function drawScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RunnerState,
  atlas: HTMLImageElement | null,
  reducedMotion: boolean,
  celebrating: boolean,
  renderTime: number,
) {
  context.imageSmoothingEnabled = false;
  const horizon = Math.floor(height * 0.58);
  context.fillStyle = "#9ed8df";
  context.fillRect(0, 0, width, horizon);
  context.fillStyle = "#d9eff0";
  context.fillRect(0, horizon - 34, width, 34);

  const farOffset = Math.floor((state.distance * 0.08) % 160);
  context.fillStyle = "#83b977";
  for (let x = -farOffset - 160; x < width + 160; x += 160) {
    context.fillRect(x, horizon - 28, 112, 28);
    context.fillRect(x + 24, horizon - 44, 64, 16);
  }

  context.fillStyle = "#5e9e58";
  context.fillRect(0, horizon, width, height - horizon);
  context.fillStyle = "#75b96b";
  context.fillRect(0, horizon, width, 12);
  const groundOffset = Math.floor(state.distance % 48);
  for (let x = -groundOffset; x < width + 48; x += 48) {
    context.fillStyle = "#3d7d43";
    context.fillRect(x + 6, horizon + 26, 4, 10);
    context.fillRect(x + 14, horizon + 22, 4, 14);
    context.fillStyle = x % 96 === 0 ? "#f7d4db" : "#fff1bf";
    context.fillRect(x + 10, horizon + 18, 8, 6);
  }

  const unit = Math.max(0.72, Math.min(1.1, height / 620));
  const groundY = horizon + 44;
  for (const obstacle of state.obstacles) {
    const x = obstacle.x;
    if (obstacle.kind === "puddle") {
      context.fillStyle = "#4f99a6";
      context.fillRect(x, groundY + 52, obstacle.width, 9);
      context.fillStyle = "#8fd0d2";
      context.fillRect(x + 12, groundY + 54, obstacle.width - 26, 3);
    } else if (obstacle.kind === "stump") {
      context.fillStyle = "#734a31";
      context.fillRect(x + 8, groundY + 60 - obstacle.height, obstacle.width - 16, obstacle.height);
      context.fillStyle = "#aa7144";
      context.fillRect(x, groundY + 60 - obstacle.height, obstacle.width, 12);
    } else {
      context.fillStyle = "#65776d";
      context.fillRect(x + 7, groundY + 60 - obstacle.height, obstacle.width - 12, obstacle.height);
      context.fillStyle = "#91a498";
      context.fillRect(x + 15, groundY + 67 - obstacle.height, obstacle.width - 26, 8);
    }
  }

  const action: keyof typeof ACTION_ROW =
    state.status === "gameover" ? (celebrating ? "celebrate" : "stumble") : state.y < -1 ? "jump" : state.status === "playing" ? "run" : "idle";
  const actionTime = action === "celebrate" ? renderTime : state.elapsed;
  const frame = reducedMotion && (action === "idle" || action === "celebrate")
    ? 0
    : Math.floor(actionTime * (action === "run" ? 12 : 8)) % ACTION_FRAMES[action];
  const dogX = 54;
  const dogY = groundY - 72 * unit + state.y * unit;
  if (atlas?.complete && atlas.naturalWidth > 0) {
    context.drawImage(atlas, frame * 128, ACTION_ROW[action] * 128, 128, 128, dogX, dogY - 42 * unit, 128 * unit, 128 * unit);
  } else {
    drawPixelDog(context, dogX, dogY, unit);
  }
}

export function XiaohuaRunner({ leaderboardBest, pauseRequested = false, celebrating = false, onStart, onGameOver }: XiaohuaRunnerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createRunnerState());
  const atlasRef = useRef<HTMLImageElement | null>(null);
  const gameOverScoreRef = useRef<number | null>(null);
  const pausedByPanelRef = useRef(false);
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [score, setScore] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const syncUi = useCallback((state: RunnerState) => {
    setStatus((value) => (value === state.status ? value : state.status));
    setScore((value) => (value === state.score ? value : state.score));
  }, []);

  const play = useCallback(() => {
    const wasNewRun = stateRef.current.status === "idle" || stateRef.current.status === "gameover";
    stateRef.current = startRunner(stateRef.current);
    gameOverScoreRef.current = null;
    syncUi(stateRef.current);
    if (wasNewRun) onStart?.();
  }, [onStart, syncUi]);

  const jump = useCallback(() => {
    if (stateRef.current.status === "idle" || stateRef.current.status === "gameover") {
      play();
      return;
    }
    stateRef.current = jumpRunner(stateRef.current);
  }, [play]);

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
    const image = new Image();
    image.src = ATLAS_PATH;
    atlasRef.current = image;
    return () => {
      atlasRef.current = null;
    };
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "ArrowUp") return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, button")) return;
      event.preventDefault();
      jump();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jump]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    const render = (now: number) => {
      const canvas = canvasRef.current;
      const shell = shellRef.current;
      if (canvas && shell) {
        const rect = shell.getBoundingClientRect();
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
          stateRef.current = stepRunner(stateRef.current, RUNNER_STEP, rect.width);
          accumulator -= RUNNER_STEP;
        }
        const context = canvas.getContext("2d");
        if (context) {
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawScene(context, rect.width, rect.height, stateRef.current, atlasRef.current, reducedMotion, celebrating, now / 1000);
        }
        syncUi(stateRef.current);
        if (stateRef.current.status === "gameover" && gameOverScoreRef.current !== stateRef.current.score) {
          gameOverScoreRef.current = stateRef.current.score;
          onGameOver?.(stateRef.current.score);
        }
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

  return (
    <div ref={shellRef} className="runner-stage" data-runner-status={status}>
      <canvas
        ref={canvasRef}
        className="runner-canvas"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          jump();
        }}
        role="img"
        aria-label="小花在像素草地上奔跑，点击草地或按空格键跳过障碍"
      />
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
          <button type="button" className="runner-play-button focus-ring" onClick={play}>
            {status === "gameover" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {status === "gameover" ? "再跑一次" : status === "paused" ? "继续奔跑" : "开始奔跑"}
          </button>
        )}
      </div>
      {status === "gameover" ? <p className="runner-gameover">撞到啦，本局 {score} 分</p> : null}
    </div>
  );
}
