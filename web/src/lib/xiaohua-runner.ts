// Device-independent fixed-step engine, responsive metrics, inputs, collisions, and fair obstacle generation for Xiaohua Runner.

export const RUNNER_STEP = 1 / 60;
export const RUNNER_BASE_SPEED = 3;
export const RUNNER_MAX_SPEED = 4.2;
export const RUNNER_SPEED_INTERVAL = 15;
export const RUNNER_SPEED_INCREMENT = 0.15;
export const RUNNER_STANDING_HEIGHT = 1;
export const RUNNER_AIRTIME = 0.88;
export const RUNNER_JUMP_APEX = 1.45;
export const RUNNER_GRAVITY = (8 * RUNNER_JUMP_APEX) / (RUNNER_AIRTIME * RUNNER_AIRTIME);
export const RUNNER_JUMP_VELOCITY = (4 * RUNNER_JUMP_APEX) / RUNNER_AIRTIME;
export const RUNNER_PLAYER_X = 0.78;

export type RunnerStatus = "idle" | "playing" | "paused" | "gameover";
export type RunnerObstacleKind = "rock" | "stump" | "log" | "puddle" | "bird";
export type RunnerActionRequirement = "jump" | "crouch";

export interface RunnerViewport {
  width: number;
  height: number;
}

export interface RunnerMetrics {
  orientation: "portrait" | "landscape";
  frame: { x: number; y: number; width: number; height: number };
  groundBaseline: number;
  standingHeight: number;
  bodyUnit: number;
  spriteSize: number;
  worldWidth: number;
  playerScreenX: number;
}

export interface RunnerObstacle {
  id: number;
  groupId: number;
  x: number;
  width: number;
  height: number;
  bottom: number;
  kind: RunnerObstacleKind;
  requirement: RunnerActionRequirement;
}

export interface RunnerState {
  status: RunnerStatus;
  elapsed: number;
  distance: number;
  score: number;
  speed: number;
  y: number;
  velocityY: number;
  crouchHeld: boolean;
  crouching: boolean;
  obstacles: RunnerObstacle[];
  nextObstacleId: number;
  nextGroupId: number;
  nextSpawnIn: number;
}

const OBSTACLE_SPECS: Record<RunnerObstacleKind, Omit<RunnerObstacle, "id" | "groupId" | "x" | "kind">> = {
  rock: { width: 0.62, height: 0.47, bottom: 0, requirement: "jump" },
  stump: { width: 0.58, height: 0.61, bottom: 0, requirement: "jump" },
  log: { width: 0.9, height: 0.4, bottom: 0, requirement: "jump" },
  puddle: { width: 1.05, height: 0.15, bottom: 0, requirement: "jump" },
  bird: { width: 0.92, height: 0.43, bottom: 0.53, requirement: "crouch" },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createRunnerMetrics(viewport: RunnerViewport): RunnerMetrics {
  const safeWidth = Math.max(1, viewport.width);
  const safeHeight = Math.max(1, viewport.height);
  const portrait = safeHeight > safeWidth;
  const ratio = portrait ? 3 / 4 : 16 / 9;
  const availableWidth = portrait ? Math.max(1, safeWidth - 16) : Math.min(1440, safeWidth);
  const availableHeight = portrait ? safeHeight : Math.min(810, safeHeight);
  let width = Math.min(availableWidth, availableHeight * ratio);
  let height = width / ratio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }
  width = Math.floor(width);
  height = Math.floor(height);
  const x = Math.floor((safeWidth - width) / 2);
  const y = Math.floor((safeHeight - height) / 2);
  const shortSide = Math.min(width, height);
  const standingHeight = portrait
    ? clamp(shortSide * 0.28, 112, 128)
    : clamp(shortSide * 0.198, 96, 168);
  const bodyUnit = standingHeight * 0.96;
  // The generated standing silhouette occupies 146px of a 192px cell.
  const spriteSize = standingHeight * (192 / 146);
  const worldWidth = width / bodyUnit;
  return {
    orientation: portrait ? "portrait" : "landscape",
    frame: { x, y, width, height },
    groundBaseline: Math.round(y + height * 0.705),
    standingHeight,
    bodyUnit,
    spriteSize,
    worldWidth,
    playerScreenX: x + RUNNER_PLAYER_X * bodyUnit,
  };
}

export function createRunnerState(): RunnerState {
  return {
    status: "idle",
    elapsed: 0,
    distance: 0,
    score: 0,
    speed: RUNNER_BASE_SPEED,
    y: 0,
    velocityY: 0,
    crouchHeld: false,
    crouching: false,
    obstacles: [],
    nextObstacleId: 1,
    nextGroupId: 1,
    nextSpawnIn: 0,
  };
}

export function startRunner(state: RunnerState): RunnerState {
  if (state.status === "paused") return { ...state, status: "playing" };
  if (state.status === "playing") return state;
  return { ...createRunnerState(), status: "playing" };
}

export function pauseRunner(state: RunnerState): RunnerState {
  return state.status === "playing" ? { ...state, status: "paused", crouching: false } : state;
}

export function jumpRunner(state: RunnerState): RunnerState {
  if (state.status !== "playing" || state.y > 0.001) return state;
  return { ...state, crouching: false, velocityY: RUNNER_JUMP_VELOCITY };
}

export function setRunnerCrouch(state: RunnerState, held: boolean): RunnerState {
  return {
    ...state,
    crouchHeld: held,
    crouching: held && state.status === "playing" && state.y <= 0.001,
  };
}

export function runnerSpeed(elapsed: number): number {
  return Math.min(
    RUNNER_MAX_SPEED,
    RUNNER_BASE_SPEED + Math.floor(elapsed / RUNNER_SPEED_INTERVAL) * RUNNER_SPEED_INCREMENT,
  );
}

export function runnerScore(distance: number): number {
  return Math.max(0, Math.floor((distance * 10) / RUNNER_BASE_SPEED));
}

function chooseGroundKind(random: () => number): RunnerObstacleKind {
  const kinds: RunnerObstacleKind[] = ["rock", "stump", "log", "puddle"];
  return kinds[Math.min(kinds.length - 1, Math.floor(random() * kinds.length))];
}

function makeObstacle(kind: RunnerObstacleKind, x: number, id: number, groupId: number): RunnerObstacle {
  return { id, groupId, x, kind, ...OBSTACLE_SPECS[kind] };
}

export interface GeneratedObstacleGroup {
  obstacles: RunnerObstacle[];
  nextObstacleId: number;
  nextGroupId: number;
  nextSpawnIn: number;
}

export function generateObstacleGroup(
  elapsed: number,
  speed: number,
  nextObstacleId: number,
  nextGroupId: number,
  random: () => number = Math.random,
): GeneratedObstacleGroup {
  const spawnX = RUNNER_PLAYER_X + speed * 2.05;
  const intervalRange = elapsed < 20 ? [1.55, 2.2] : [1.35, 1.95];
  const interval = intervalRange[0] + random() * (intervalRange[1] - intervalRange[0]);
  const obstacles: RunnerObstacle[] = [];
  if (elapsed < 20) {
    obstacles.push(makeObstacle(chooseGroundKind(random), spawnX, nextObstacleId, nextGroupId));
  } else if (elapsed < 45 || random() >= 0.36) {
    const kind = random() < 0.38 ? "bird" : chooseGroundKind(random);
    obstacles.push(makeObstacle(kind, spawnX, nextObstacleId, nextGroupId));
  } else {
    const firstIsBird = random() < 0.5;
    const separationTime = 1.18;
    const firstKind = firstIsBird ? "bird" : chooseGroundKind(random);
    const secondKind = firstIsBird ? chooseGroundKind(random) : "bird";
    obstacles.push(makeObstacle(firstKind, spawnX, nextObstacleId, nextGroupId));
    obstacles.push(makeObstacle(secondKind, spawnX + speed * separationTime, nextObstacleId + 1, nextGroupId));
  }
  const groupSpan = obstacles.length === 2 ? obstacles[1].x - obstacles[0].x : 0;
  return {
    obstacles,
    nextObstacleId: nextObstacleId + obstacles.length,
    nextGroupId: nextGroupId + 1,
    nextSpawnIn: groupSpan + speed * interval,
  };
}

function horizontalOverlap(obstacle: RunnerObstacle): boolean {
  const playerLeft = RUNNER_PLAYER_X + 0.12;
  const playerRight = RUNNER_PLAYER_X + 0.82;
  return playerRight > obstacle.x + 0.06 && playerLeft < obstacle.x + obstacle.width - 0.06;
}

export function runnerCollides(state: RunnerState, obstacle: RunnerObstacle): boolean {
  if (!horizontalOverlap(obstacle)) return false;
  if (obstacle.requirement === "crouch") return !state.crouching;
  const playerBottom = state.y + 0.03;
  const playerTop = state.y + (state.crouching ? 0.44 : 0.88);
  return playerTop > obstacle.bottom && playerBottom < obstacle.bottom + obstacle.height;
}

export function stepRunner(
  state: RunnerState,
  delta: number,
  _worldWidth: number,
  random: () => number = Math.random,
): RunnerState {
  if (state.status !== "playing" || delta <= 0) return state;
  const dt = Math.min(delta, 0.05);
  const elapsed = state.elapsed + dt;
  const speed = runnerSpeed(elapsed);
  const distance = state.distance + speed * dt;
  let velocityY = state.velocityY;
  let y = state.y;
  if (y > 0 || velocityY > 0) {
    y += velocityY * dt - 0.5 * RUNNER_GRAVITY * dt * dt;
    velocityY -= RUNNER_GRAVITY * dt;
    if (y <= 0 && velocityY < 0) {
      y = 0;
      velocityY = 0;
    }
  }
  let obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * dt }))
    .filter((obstacle) => obstacle.x + obstacle.width > -0.5);
  let nextSpawnIn = state.nextSpawnIn - speed * dt;
  let nextObstacleId = state.nextObstacleId;
  let nextGroupId = state.nextGroupId;
  if (nextSpawnIn <= 0) {
    const generated = generateObstacleGroup(elapsed, speed, nextObstacleId, nextGroupId, random);
    obstacles = [...obstacles, ...generated.obstacles];
    nextSpawnIn += generated.nextSpawnIn;
    nextObstacleId = generated.nextObstacleId;
    nextGroupId = generated.nextGroupId;
  }
  const crouching = state.crouchHeld && y <= 0.001;
  const nextState: RunnerState = {
    ...state,
    elapsed,
    distance,
    score: runnerScore(distance),
    speed,
    y,
    velocityY,
    crouching,
    obstacles,
    nextObstacleId,
    nextGroupId,
    nextSpawnIn,
  };
  return {
    ...nextState,
    status: obstacles.some((obstacle) => runnerCollides(nextState, obstacle)) ? "gameover" : "playing",
  };
}
