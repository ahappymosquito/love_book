// Deterministic fixed-step game engine for the login-page Xiaohua grassland runner.

export const RUNNER_STEP = 1 / 60;
export const RUNNER_BASE_SPEED = 240;
export const RUNNER_MAX_SPEED = 480;
export const RUNNER_SPEED_INTERVAL = 15;
export const RUNNER_SPEED_INCREMENT = 20;
export const RUNNER_JUMP_VELOCITY = -720;
export const RUNNER_GRAVITY = 1900;
export const RUNNER_GROUND_Y = 0;

export type RunnerStatus = "idle" | "playing" | "paused" | "gameover";

export interface RunnerObstacle {
  id: number;
  x: number;
  width: number;
  height: number;
  kind: "rock" | "stump" | "puddle";
}

export interface RunnerState {
  status: RunnerStatus;
  elapsed: number;
  distance: number;
  score: number;
  speed: number;
  y: number;
  velocityY: number;
  obstacles: RunnerObstacle[];
  nextObstacleId: number;
}

export function createRunnerState(): RunnerState {
  return {
    status: "idle",
    elapsed: 0,
    distance: 0,
    score: 0,
    speed: RUNNER_BASE_SPEED,
    y: RUNNER_GROUND_Y,
    velocityY: 0,
    obstacles: [],
    nextObstacleId: 1,
  };
}

export function startRunner(state: RunnerState): RunnerState {
  if (state.status === "paused") return { ...state, status: "playing" };
  if (state.status === "playing") return state;
  return { ...createRunnerState(), status: "playing" };
}

export function pauseRunner(state: RunnerState): RunnerState {
  return state.status === "playing" ? { ...state, status: "paused" } : state;
}

export function jumpRunner(state: RunnerState): RunnerState {
  if (state.status !== "playing" || state.y < RUNNER_GROUND_Y - 0.5) return state;
  return { ...state, velocityY: RUNNER_JUMP_VELOCITY };
}

export function runnerSpeed(elapsed: number): number {
  return Math.min(
    RUNNER_MAX_SPEED,
    RUNNER_BASE_SPEED + Math.floor(elapsed / RUNNER_SPEED_INTERVAL) * RUNNER_SPEED_INCREMENT,
  );
}

export function runnerScore(distance: number): number {
  return Math.max(0, Math.floor(distance / 24));
}

function overlapsPlayer(obstacle: RunnerObstacle, playerX: number, y: number): boolean {
  const playerLeft = playerX + 14;
  const playerRight = playerX + 64;
  const playerBottom = y + 78;
  const playerTop = y + 18;
  const obstacleLeft = obstacle.x + 4;
  const obstacleRight = obstacle.x + obstacle.width - 4;
  const obstacleTop = 92 - obstacle.height;
  return playerRight > obstacleLeft && playerLeft < obstacleRight && playerBottom > obstacleTop && playerTop < 92;
}

export function stepRunner(
  state: RunnerState,
  delta: number,
  viewportWidth: number,
  random: () => number = Math.random,
): RunnerState {
  if (state.status !== "playing" || delta <= 0) return state;
  const dt = Math.min(delta, 0.05);
  const elapsed = state.elapsed + dt;
  const speed = runnerSpeed(elapsed);
  const distance = state.distance + speed * dt;
  let velocityY = state.velocityY + RUNNER_GRAVITY * dt;
  let y = state.y + velocityY * dt;
  if (y > RUNNER_GROUND_Y) {
    y = RUNNER_GROUND_Y;
    velocityY = 0;
  }

  let obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * dt }))
    .filter((obstacle) => obstacle.x + obstacle.width > -16);
  let nextObstacleId = state.nextObstacleId;
  const last = obstacles.at(-1);
  if (!last || last.x < viewportWidth - 420) {
    const gap = 420 + random() * 280;
    const kinds: RunnerObstacle["kind"][] = ["rock", "stump", "puddle"];
    const kind = kinds[Math.min(2, Math.floor(random() * 3))];
    obstacles.push({
      id: nextObstacleId,
      x: Math.max(viewportWidth + 32, (last?.x ?? viewportWidth) + gap),
      width: kind === "puddle" ? 72 : kind === "stump" ? 44 : 50,
      height: kind === "puddle" ? 16 : kind === "stump" ? 54 : 38,
      kind,
    });
    nextObstacleId += 1;
  }

  const playerY = 92 - 82 + y;
  const collided = obstacles.some((obstacle) => overlapsPlayer(obstacle, 72, playerY));
  return {
    ...state,
    status: collided ? "gameover" : "playing",
    elapsed,
    distance,
    score: runnerScore(distance),
    speed,
    y,
    velocityY,
    obstacles,
    nextObstacleId,
  };
}
