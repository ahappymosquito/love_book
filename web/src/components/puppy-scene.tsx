"use client";

// Shared procedural puppy scene with a high-detail layered sunset-meadow hero, lightweight inline variant, interruptible direct interaction, adaptive rendering, and accessible motion fallbacks.

import { PerformanceMonitor, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type MutableRefObject,
  type ReactNode,
} from "react";
import * as THREE from "three";

export type PuppySceneMood = "idle" | "focused" | "submitting" | "success" | "error";

export interface PuppySceneProps {
  variant?: "hero" | "inline";
  interactive?: boolean;
  reducedMotionFallback?: "soft" | "still";
  mood?: PuppySceneMood;
  onReady?: () => void;
  className?: string;
}

interface ScenePalette {
  paper: THREE.Color;
  paperShade: THREE.Color;
  cover: THREE.Color;
  coverDeep: THREE.Color;
  fur: THREE.Color;
  furShade: THREE.Color;
  ear: THREE.Color;
  ink: THREE.Color;
  cheek: THREE.Color;
  rose: THREE.Color;
  peach: THREE.Color;
  sage: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  grass: THREE.Color;
  grassTip: THREE.Color;
  sun: THREE.Color;
  glow: THREE.Color;
  shadow: THREE.Color;
}

interface MeadowTarget {
  x: number;
  z: number;
  id: number;
  source: "grass" | "puppy" | "submit" | "success";
}

const SCENE_TOKEN_FALLBACKS = {
  paper: "0.985 0.014 48",
  paperShade: "0.93 0.028 42",
  cover: "0.63 0.13 12",
  coverDeep: "0.48 0.13 9",
  fur: "0.97 0.018 52",
  furShade: "0.87 0.045 44",
  ear: "0.63 0.09 42",
  ink: "0.28 0.035 20",
  cheek: "0.77 0.1 12",
  rose: "0.62 0.14 12",
  peach: "0.79 0.1 48",
  sage: "0.68 0.085 153",
  skyTop: "0.7 0.09 292",
  skyHorizon: "0.9 0.105 64",
  grass: "0.43 0.075 150",
  grassTip: "0.57 0.085 136",
  sun: "0.9 0.14 72",
  glow: "0.78 0.16 28",
  shadow: "0.24 0.045 150",
} as const;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function oklchChannelsToColor(channels: string, fallback: string) {
  const values = channels.trim().split(/\s+/).map(Number);
  const fallbackValues = fallback.split(/\s+/).map(Number);
  const [lightness, chroma, hue] = values.length >= 3 && values.every(Number.isFinite) ? values : fallbackValues;
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  const linearR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linearG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linearB = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const toSrgb = (value: number) =>
    value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;

  return new THREE.Color().setRGB(
    clamp01(toSrgb(linearR)),
    clamp01(toSrgb(linearG)),
    clamp01(toSrgb(linearB)),
    THREE.SRGBColorSpace,
  );
}

function readScenePalette(): ScenePalette {
  const styles = typeof window === "undefined" ? null : getComputedStyle(document.documentElement);
  const read = (name: keyof typeof SCENE_TOKEN_FALLBACKS) =>
    oklchChannelsToColor(styles?.getPropertyValue(`--lb-scene-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`) ?? "", SCENE_TOKEN_FALLBACKS[name]);

  return {
    paper: read("paper"),
    paperShade: read("paperShade"),
    cover: read("cover"),
    coverDeep: read("coverDeep"),
    fur: read("fur"),
    furShade: read("furShade"),
    ear: read("ear"),
    ink: read("ink"),
    cheek: read("cheek"),
    rose: read("rose"),
    peach: read("peach"),
    sage: read("sage"),
    skyTop: read("skyTop"),
    skyHorizon: read("skyHorizon"),
    grass: read("grass"),
    grassTip: read("grassTip"),
    sun: read("sun"),
    glow: read("glow"),
    shadow: read("shadow"),
  };
}

function useScenePalette() {
  const [palette, setPalette] = useState<ScenePalette>(() => readScenePalette());

  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setPalette(readScenePalette());
    update();
    colorScheme.addEventListener?.("change", update);
    return () => colorScheme.removeEventListener?.("change", update);
  }, []);

  return palette;
}

function createHeartGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.34);
  shape.bezierCurveTo(-0.68, -0.02, -0.76, 0.48, -0.38, 0.58);
  shape.bezierCurveTo(-0.12, 0.66, 0, 0.46, 0, 0.3);
  shape.bezierCurveTo(0, 0.46, 0.12, 0.66, 0.38, 0.58);
  shape.bezierCurveTo(0.76, 0.48, 0.68, -0.02, 0, -0.34);
  const geometry = new THREE.ShapeGeometry(shape, 12);
  geometry.center();
  return geometry;
}

function createGrassGeometry() {
  const geometry = new THREE.BufferGeometry();
  const levels = [
    { y: 0, width: 0.024, bend: 0, depth: 0 },
    { y: 0.1, width: 0.021, bend: 0.004, depth: 0.002 },
    { y: 0.21, width: 0.016, bend: 0.014, depth: 0.006 },
    { y: 0.31, width: 0.01, bend: 0.034, depth: 0.011 },
    { y: 0.4, width: 0.001, bend: 0.067, depth: 0.016 },
  ];
  const positions = levels.flatMap(({ y, width, bend, depth }) => [bend - width, y, depth, bend + width, y, depth]);
  const uvs = levels.flatMap((_, index) => [0, index / (levels.length - 1), 1, index / (levels.length - 1)]);
  const indices: number[] = [];
  for (let index = 0; index < levels.length - 1; index += 1) {
    const start = index * 2;
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function damp(current: number, target: number, smoothing: number, delta: number) {
  return THREE.MathUtils.damp(current, target, smoothing, delta);
}

function dampAngle(current: number, target: number, smoothing: number, delta: number) {
  const angleDelta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + angleDelta * (1 - Math.exp(-smoothing * delta));
}

function HeroCamera({
  variant,
  isMobile,
  pointer,
  reduced,
  mood,
}: {
  variant: "hero" | "inline";
  isMobile: boolean;
  pointer: MutableRefObject<{ x: number; y: number }>;
  reduced: boolean;
  mood: PuppySceneMood;
}) {
  const { camera } = useThree();
  const lookAt = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const perspective = camera as THREE.PerspectiveCamera;
    const isFocused = mood === "focused" || mood === "submitting" || mood === "success";
    const pointerAmount = reduced || isFocused || variant === "inline" ? 0 : 1;
    const base =
      variant === "inline"
        ? { x: 0, y: 0.4, z: isMobile ? 5.8 : 5.35, fov: isMobile ? 49 : 45, lookY: 0.25 }
        : isMobile
          ? { x: 0, y: 1.48, z: 8.9, fov: 43, lookY: 0.62 }
          : { x: 0.1, y: 1.82, z: 8.65, fov: 39, lookY: 0.42 };
    const focusDistance = variant === "hero" && isFocused ? -0.28 : 0;
    const targetX = base.x + pointer.current.x * 0.18 * pointerAmount;
    const targetY = base.y - pointer.current.y * 0.1 * pointerAmount;

    perspective.position.x = damp(perspective.position.x, targetX, 5.5, delta);
    perspective.position.y = damp(perspective.position.y, targetY, 5.5, delta);
    perspective.position.z = damp(perspective.position.z, base.z + focusDistance, 5.5, delta);
    perspective.fov = damp(perspective.fov, base.fov, 6, delta);
    perspective.updateProjectionMatrix();

    const stageLookX = variant === "hero" && !isMobile ? -0.54 : 0;
    lookAt.current.x = damp(lookAt.current.x, stageLookX + pointer.current.x * 0.1 * pointerAmount, 5, delta);
    lookAt.current.y = damp(lookAt.current.y, base.lookY - pointer.current.y * 0.04 * pointerAmount, 5, delta);
    perspective.lookAt(lookAt.current);
  });

  return null;
}

function seededUnit(index: number, salt: number) {
  return Math.abs(Math.sin(index * 91.733 + salt * 47.221) * 43758.5453) % 1;
}

function SunsetBackdrop({ palette, reduced, mood }: { palette: ScenePalette; reduced: boolean; mood: PuppySceneMood }) {
  const uniforms = useMemo(
    () => ({
      uTop: { value: palette.skyTop.clone() },
      uHorizon: { value: palette.skyHorizon.clone() },
      uSun: { value: palette.sun.clone() },
      uTime: { value: 0 },
      uEnergy: { value: 0.8 },
    }),
    [palette.skyHorizon, palette.skyTop, palette.sun],
  );

  useFrame((state, delta) => {
    uniforms.uTime.value = reduced ? 0 : state.clock.elapsedTime;
    const targetEnergy = mood === "submitting" || mood === "success" ? 1.2 : mood === "error" ? 0.58 : 0.82;
    uniforms.uEnergy.value = damp(uniforms.uEnergy.value, targetEnergy, 4.5, delta);
  });

  return (
    <group>
      <mesh position={[0, 3.2, -9]} renderOrder={-20}>
        <planeGeometry args={[44, 24]} />
        <shaderMaterial
          uniforms={uniforms}
          depthWrite={false}
          toneMapped={false}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            precision highp float;
            varying vec2 vUv;
            uniform vec3 uTop;
            uniform vec3 uHorizon;
            uniform vec3 uSun;
            uniform float uTime;
            uniform float uEnergy;
            void main() {
              float horizonMix = smoothstep(0.14, 0.96, vUv.y);
              vec3 color = mix(uHorizon, uTop, horizonMix);
              float sunDistance = distance(vUv, vec2(0.28, 0.52));
              float sunCore = 1.0 - smoothstep(0.0, 0.055, sunDistance);
              float sunHalo = 1.0 - smoothstep(0.02, 0.24, sunDistance);
              float haze = sin(vUv.x * 8.0 + uTime * 0.08) * 0.01;
              color += uSun * (sunCore * 0.75 + sunHalo * 0.2) * uEnergy;
              color += uSun * haze * (1.0 - vUv.y);
              gl_FragColor = vec4(color, 1.0);
            }
          `}
        />
      </mesh>
      <mesh position={[-3.8, -0.32, -5.8]} scale={[4.6, 1.25, 1]} renderOrder={-14}>
        <sphereGeometry args={[1, 36, 18]} />
        <meshStandardMaterial color={palette.grassTip} roughness={1} />
      </mesh>
      <mesh position={[2.7, -0.46, -6.1]} scale={[5.8, 1.5, 1]} renderOrder={-13}>
        <sphereGeometry args={[1, 36, 18]} />
        <meshStandardMaterial color={palette.grass} roughness={1} />
      </mesh>
    </group>
  );
}

function GrassField({ palette, count, reduced, mood }: { palette: ScenePalette; count: number; reduced: boolean; mood: PuppySceneMood }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const grassGeometry = useMemo(() => createGrassGeometry(), []);
  const definitions = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => {
        const x = -4.2 + seededUnit(index, 1) * 8.4;
        const z = -2.45 + seededUnit(index, 2) * 5.15;
        const pathDistance = ((x - 0.15) / 2.75) ** 2 + ((z - 0.18) / 1.42) ** 2;
        const pathClearance = pathDistance < 1 ? 0.16 + pathDistance * 0.48 : 1;
        return {
          x,
          z,
          height: (0.52 + seededUnit(index, 3) * 0.58) * (seededUnit(index, 2) > 0.64 ? 0.68 : 1) * pathClearance,
          yaw: seededUnit(index, 4) * Math.PI,
          phase: seededUnit(index, 5) * Math.PI * 2,
          tint: seededUnit(index, 6),
        };
      }),
    [count],
  );

  useEffect(() => () => grassGeometry.dispose(), [grassGeometry]);

  useEffect(() => {
    if (!mesh.current) return;
    mesh.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    definitions.forEach((definition, index) => {
      const color = palette.grass.clone().lerp(palette.grassTip, 0.46 + definition.tint * 0.46);
      mesh.current.setColorAt(index, color);
    });
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [definitions, palette]);

  useFrame((state) => {
    if (!mesh.current) return;
    const time = state.clock.elapsedTime;
    const quiet = reduced || mood === "focused" ? 0.12 : mood === "submitting" ? 0.56 : 1;
    definitions.forEach((definition, index) => {
      const wave = Math.sin(time * 1.45 + definition.phase + definition.x * 0.35) * 0.13 * quiet;
      dummy.position.set(definition.x, 0.015, definition.z);
      dummy.rotation.set(0, definition.yaw, wave);
      dummy.scale.set(0.82 + definition.tint * 0.5, definition.height, 1);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[grassGeometry, undefined, count]} frustumCulled={false} receiveShadow>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.9} metalness={0} emissive={palette.grassTip} emissiveIntensity={0.26} />
    </instancedMesh>
  );
}

function MeadowFlowers({ palette, count, reduced, mood }: { palette: ScenePalette; count: number; reduced: boolean; mood: PuppySceneMood }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const definitions = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        x: -3.65 + seededUnit(index, 11) * 7.3,
        z: -2.1 + seededUnit(index, 12) * 4.3,
        phase: seededUnit(index, 13) * Math.PI * 2,
        scale: 0.045 + seededUnit(index, 14) * 0.055,
      })),
    [count],
  );

  useEffect(() => {
    if (!mesh.current) return;
    definitions.forEach((definition, index) => {
      const color = index % 5 === 0 ? palette.paper : index % 2 === 0 ? palette.peach : palette.rose;
      mesh.current.setColorAt(index, color);
    });
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [definitions, palette]);

  useFrame((state) => {
    if (!mesh.current) return;
    const time = state.clock.elapsedTime;
    const quiet = reduced || mood === "focused" ? 0.14 : 1;
    definitions.forEach((definition, index) => {
      dummy.position.set(definition.x, 0.11 + Math.sin(time * 1.2 + definition.phase) * 0.018 * quiet, definition.z);
      dummy.rotation.set(time * 0.08 * quiet, definition.phase, Math.sin(time + definition.phase) * 0.08 * quiet);
      dummy.scale.setScalar(definition.scale);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial vertexColors roughness={0.62} />
    </instancedMesh>
  );
}

function Fireflies({ palette, count, reduced, mood }: { palette: ScenePalette; count: number; reduced: boolean; mood: PuppySceneMood }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const definitions = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        x: -4.2 + seededUnit(index, 21) * 8.4,
        y: 0.35 + seededUnit(index, 22) * 2.45,
        z: -2.4 + seededUnit(index, 23) * 4.7,
        phase: seededUnit(index, 24) * Math.PI * 2,
        speed: 0.34 + seededUnit(index, 25) * 0.52,
        scale: 0.018 + seededUnit(index, 26) * 0.028,
      })),
    [count],
  );

  useFrame((state) => {
    if (!mesh.current) return;
    const time = state.clock.elapsedTime;
    const quiet = reduced || mood === "focused" ? 0.08 : mood === "submitting" ? 1.3 : 1;
    definitions.forEach((definition, index) => {
      const orbit = time * definition.speed + definition.phase;
      dummy.position.set(
        definition.x + Math.sin(orbit) * 0.16 * quiet,
        definition.y + Math.sin(orbit * 1.7) * 0.13 * quiet,
        definition.z + Math.cos(orbit * 0.8) * 0.11 * quiet,
      );
      const pulse = 0.58 + Math.sin(orbit * 2.6) * 0.28;
      dummy.scale.setScalar(definition.scale * pulse * (mood === "success" ? 1.8 : 1));
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false} renderOrder={4}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial
        color={palette.sun}
        transparent
        opacity={0.92}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function TargetGlow({ palette, target, mood, reduced }: { palette: ScenePalette; target: MeadowTarget; mood: PuppySceneMood; reduced: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const heartGeometry = useMemo(() => createHeartGeometry(), []);

  useEffect(() => () => heartGeometry.dispose(), [heartGeometry]);

  useFrame((state, delta) => {
    if (!group.current) return;
    const visible = target.id > 0 && mood !== "error";
    group.current.position.x = damp(group.current.position.x, target.x, 13, delta);
    group.current.position.z = damp(group.current.position.z, target.z, 13, delta);
    group.current.position.y = damp(group.current.position.y, visible ? 0.25 : -0.15, 10, delta);
    const pulse = reduced ? 1 : 1 + Math.sin(state.clock.elapsedTime * 5.4) * 0.09;
    group.current.scale.setScalar(damp(group.current.scale.x, visible ? pulse : 0.001, 11, delta));
    group.current.rotation.y += delta * (reduced ? 0 : 0.75);
  });

  return (
    <group ref={group} position={[target.x, -0.15, target.z]} scale={0.001}>
      <mesh geometry={heartGeometry} rotation={[-Math.PI / 2, 0, 0]} scale={0.22}>
        <meshStandardMaterial color={palette.rose} emissive={palette.glow} emissiveIntensity={1.5} side={THREE.DoubleSide} roughness={0.38} />
      </mesh>
      <mesh scale={0.72}>
        <sphereGeometry args={[0.42, 20, 14]} />
        <meshBasicMaterial color={palette.glow} transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight color={palette.glow} intensity={mood === "submitting" ? 2.4 : 1.35} distance={3.1} decay={2} />
    </group>
  );
}

function MeadowPetals({ palette, target, burstId, reduced }: { palette: ScenePalette; target: MeadowTarget; burstId: number; reduced: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const heartGeometry = useMemo(() => createHeartGeometry(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lastBurstId = useRef(burstId);
  const burstStartedAt = useRef(-10);
  const origin = useRef(new THREE.Vector3());
  const definitions = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => ({
        angle: (index / 14) * Math.PI * 2 + seededUnit(index, 31) * 0.4,
        radius: 0.45 + seededUnit(index, 32) * 0.75,
        lift: 0.35 + seededUnit(index, 33) * 0.72,
        scale: 0.025 + seededUnit(index, 34) * 0.035,
      })),
    [],
  );

  useEffect(() => () => heartGeometry.dispose(), [heartGeometry]);

  useFrame((state) => {
    if (!mesh.current) return;
    const time = state.clock.elapsedTime;
    if (lastBurstId.current !== burstId) {
      lastBurstId.current = burstId;
      burstStartedAt.current = time;
      origin.current.set(target.x, 0.18, target.z);
    }
    const age = time - burstStartedAt.current;
    const progress = THREE.MathUtils.clamp(age / 0.95, 0, 1);
    const strength = age >= 0 && age < 1.05 && !reduced ? Math.sin(progress * Math.PI) : 0;
    definitions.forEach((definition, index) => {
      dummy.position.set(
        origin.current.x + Math.cos(definition.angle) * definition.radius * progress,
        origin.current.y + definition.lift * strength,
        origin.current.z + Math.sin(definition.angle) * definition.radius * progress,
      );
      dummy.rotation.set(progress * 2 + definition.angle, definition.angle, progress * 4);
      dummy.scale.setScalar(definition.scale * strength);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
      mesh.current.setColorAt(index, index % 3 === 0 ? palette.sun : index % 2 === 0 ? palette.peach : palette.rose);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[heartGeometry, undefined, 14]} frustumCulled={false} renderOrder={6}>
      <meshBasicMaterial vertexColors transparent opacity={0.92} side={THREE.DoubleSide} depthWrite={false} />
    </instancedMesh>
  );
}

function PicnicKeepsake({ palette }: { palette: ScenePalette }) {
  const heartGeometry = useMemo(() => createHeartGeometry(), []);
  useEffect(() => () => heartGeometry.dispose(), [heartGeometry]);

  return (
    <group position={[-2.65, 0.15, -0.85]} rotation={[-Math.PI / 2, 0, -0.18]} scale={0.72}>
      <RoundedBox args={[1.55, 0.96, 0.08]} radius={0.08} smoothness={3} position={[0, 0, -0.04]} castShadow>
        <meshStandardMaterial color={palette.coverDeep} roughness={0.72} />
      </RoundedBox>
      <RoundedBox args={[0.72, 0.86, 0.055]} radius={0.06} smoothness={3} position={[-0.39, 0.03, 0.02]}>
        <meshStandardMaterial color={palette.paper} roughness={0.92} />
      </RoundedBox>
      <RoundedBox args={[0.72, 0.86, 0.055]} radius={0.06} smoothness={3} position={[0.39, 0.03, 0.02]}>
        <meshStandardMaterial color={palette.paperShade} roughness={0.92} />
      </RoundedBox>
      <mesh geometry={heartGeometry} position={[0.38, -0.08, 0.065]} scale={0.12}>
        <meshStandardMaterial color={palette.rose} side={THREE.DoubleSide} roughness={0.56} />
      </mesh>
    </group>
  );
}

function Puppy({
  palette,
  pointer,
  mood,
  reduced,
  allowSoftMotion,
  interactive,
  interactionId,
  meadowTarget,
  scale,
  position,
  onInteract,
}: {
  palette: ScenePalette;
  pointer: MutableRefObject<{ x: number; y: number }>;
  mood: PuppySceneMood;
  reduced: boolean;
  allowSoftMotion: boolean;
  interactive: boolean;
  interactionId: number;
  meadowTarget?: MeadowTarget;
  scale: number;
  position: [number, number, number];
  onInteract: () => void;
}) {
  const travelRoot = useRef<THREE.Group>(null!);
  const motionRoot = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const tail = useRef<THREE.Group>(null!);
  const earLeft = useRef<THREE.Group>(null!);
  const earRight = useRef<THREE.Group>(null!);
  const eyeLeft = useRef<THREE.Mesh>(null!);
  const eyeRight = useRef<THREE.Mesh>(null!);
  const frontLeft = useRef<THREE.Group>(null!);
  const wavePaw = useRef<THREE.Group>(null!);
  const rearLeft = useRef<THREE.Group>(null!);
  const rearRight = useRef<THREE.Group>(null!);
  const lastInteractionId = useRef(interactionId);
  const interactionStartedAt = useRef(-10);
  const lastTargetId = useRef(meadowTarget?.id ?? 0);
  const arrivalStartedAt = useRef(-10);
  const wasRunning = useRef(false);
  const idleSeed = useRef(1.73);
  const [hovered, setHovered] = useState(false);
  const heartGeometry = useMemo(() => createHeartGeometry(), []);

  useEffect(() => () => heartGeometry.dispose(), [heartGeometry]);

  useFrame((state, delta) => {
    if (!travelRoot.current || !motionRoot.current || !head.current || !tail.current || !wavePaw.current) return;
    const time = state.clock.elapsedTime;
    if (lastInteractionId.current !== interactionId) {
      lastInteractionId.current = interactionId;
      interactionStartedAt.current = time;
    }
    const actionAge = time - interactionStartedAt.current;
    const actionProgress = THREE.MathUtils.clamp(actionAge / 0.72, 0, 1);
    const action = actionAge >= 0 && actionAge < 0.9 && !reduced ? Math.sin(actionProgress * Math.PI) : 0;
    if (meadowTarget && lastTargetId.current !== meadowTarget.id) {
      lastTargetId.current = meadowTarget.id;
    }

    const travelDx = meadowTarget ? meadowTarget.x - travelRoot.current.position.x : 0;
    const travelDz = meadowTarget ? meadowTarget.z - travelRoot.current.position.z : 0;
    const travelDistance = Math.hypot(travelDx, travelDz);
    const travelAllowed = Boolean(meadowTarget) && mood !== "focused" && mood !== "error" && !reduced;
    const running = travelAllowed && travelDistance > 0.13;
    if (running) {
      const speed = meadowTarget?.source === "submit" ? 3.35 : meadowTarget?.source === "success" ? 3.75 : 2.55;
      const step = Math.min(travelDistance, speed * delta);
      travelRoot.current.position.x += (travelDx / Math.max(travelDistance, 0.001)) * step;
      travelRoot.current.position.z += (travelDz / Math.max(travelDistance, 0.001)) * step;
      const targetAngle = Math.atan2(travelDx, travelDz);
      travelRoot.current.rotation.y = dampAngle(travelRoot.current.rotation.y, targetAngle, 9, delta);
    } else if (meadowTarget) {
      travelRoot.current.rotation.y = dampAngle(travelRoot.current.rotation.y, 0, 3.6, delta);
    }
    if (wasRunning.current && !running) arrivalStartedAt.current = time;
    wasRunning.current = running;

    const arrivalAge = time - arrivalStartedAt.current;
    const arrivalProgress = THREE.MathUtils.clamp(arrivalAge / 0.72, 0, 1);
    const arrival = arrivalAge >= 0 && arrivalAge < 0.82 && !reduced ? Math.sin(arrivalProgress * Math.PI) : 0;
    const motionScale = reduced ? (allowSoftMotion ? 0.18 : 0) : mood === "focused" ? 0.35 : mood === "submitting" ? 0.5 : 1;
    const breath = Math.sin(time * 1.55 + idleSeed.current) * 0.035 * motionScale;
    const hoverScale = hovered && interactive && !reduced ? 1.025 : 1;
    const stride = running ? Math.sin(time * 13.5) * 0.58 : 0;
    const runLift = running ? Math.abs(Math.sin(time * 13.5)) * 0.055 : 0;

    motionRoot.current.position.y = damp(motionRoot.current.position.y, breath + action * 0.16 + arrival * 0.22 + runLift, 10, delta);
    motionRoot.current.rotation.z = damp(
      motionRoot.current.rotation.z,
      Math.sin(time * 0.72) * 0.014 * motionScale + (running ? stride * 0.045 : 0) + (mood === "error" ? -0.035 : 0),
      7,
      delta,
    );
    motionRoot.current.scale.setScalar(damp(motionRoot.current.scale.x, hoverScale, 10, delta));

    const tracking = reduced || mood === "focused" || mood === "submitting" || running ? 0 : 1;
    const headTargetY = THREE.MathUtils.clamp(pointer.current.x * 0.32 * tracking, -0.34, 0.34);
    const headTargetX = THREE.MathUtils.clamp(-pointer.current.y * 0.18 * tracking, -0.2, 0.18);
    head.current.rotation.y = damp(head.current.rotation.y, headTargetY, 6, delta);
    head.current.rotation.x = damp(head.current.rotation.x, headTargetX + (mood === "error" ? 0.08 : 0), 6, delta);
    head.current.rotation.z = damp(head.current.rotation.z, mood === "error" ? -0.045 : Math.sin(time) * 0.012 * motionScale, 6, delta);

    tail.current.rotation.z = Math.sin(time * (running ? 15.5 : action > 0 ? 15 : 4.2)) * (running || action > 0 ? 0.58 : 0.22 * motionScale) + 0.7;
    if (frontLeft.current) frontLeft.current.rotation.x = damp(frontLeft.current.rotation.x, stride, 13, delta);
    if (rearLeft.current) rearLeft.current.rotation.x = damp(rearLeft.current.rotation.x, -stride, 13, delta);
    if (rearRight.current) rearRight.current.rotation.x = damp(rearRight.current.rotation.x, stride, 13, delta);
    wavePaw.current.rotation.z = damp(wavePaw.current.rotation.z, action > 0 ? -0.9 - action * 0.45 : -0.18, 10, delta);
    wavePaw.current.rotation.x = damp(wavePaw.current.rotation.x, action > 0 ? -0.35 : -stride, 13, delta);

    const earDroop = mood === "error" ? 0.22 : 0;
    if (earLeft.current && earRight.current) {
      earLeft.current.rotation.z = damp(earLeft.current.rotation.z, -0.5 - earDroop, 8, delta);
      earRight.current.rotation.z = damp(earRight.current.rotation.z, 0.5 + earDroop, 8, delta);
    }

    if (eyeLeft.current && eyeRight.current) {
      const cycle = (time + idleSeed.current) % 4.6;
      const blink = cycle > 4.32 ? Math.max(0.08, 1 - (cycle - 4.32) * 7.2) : 1;
      eyeLeft.current.scale.y = 0.118 * blink;
      eyeRight.current.scale.y = 0.118 * blink;
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive) return;
    event.stopPropagation();
    onInteract();
  };

  return (
    <group
      ref={travelRoot}
      position={position}
      scale={scale}
      onClick={handleClick}
      onPointerOver={() => interactive && setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <mesh position={[0, 0.06, 0.42]} scale={[1.08, 1.5, 0.84]}>
        <sphereGeometry args={[0.92, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      <group ref={motionRoot}>
        <mesh position={[0, -0.04, 0.31]} scale={[0.74, 0.9, 0.58]} castShadow receiveShadow>
          <sphereGeometry args={[0.82, 44, 34]} />
          <meshPhysicalMaterial color={palette.fur} roughness={0.68} clearcoat={0.12} clearcoatRoughness={0.8} />
        </mesh>
        <mesh position={[0, 0.04, 0.78]} scale={[0.46, 0.59, 0.17]} castShadow>
          <sphereGeometry args={[0.72, 34, 26]} />
          <meshStandardMaterial color={palette.paperShade} roughness={0.82} />
        </mesh>
        <mesh position={[0, -0.27, 0.9]} scale={[0.31, 0.28, 0.075]}>
          <sphereGeometry args={[0.72, 28, 20]} />
          <meshStandardMaterial color={palette.furShade} roughness={0.78} />
        </mesh>
        <mesh position={[-0.53, 0.04, 0.38]} scale={[0.2, 0.42, 0.28]} castShadow>
          <sphereGeometry args={[0.72, 28, 20]} />
          <meshStandardMaterial color={palette.fur} roughness={0.76} />
        </mesh>
        <mesh position={[0.53, 0.04, 0.38]} scale={[0.2, 0.42, 0.28]} castShadow>
          <sphereGeometry args={[0.72, 28, 20]} />
          <meshStandardMaterial color={palette.fur} roughness={0.76} />
        </mesh>

        {meadowTarget ? (
          <mesh geometry={heartGeometry} position={[0, 0.03, 0.96]} rotation={[0, 0, Math.PI]} scale={[0.34, 0.38, 0.34]}>
            <meshStandardMaterial color={palette.paperShade} side={THREE.DoubleSide} roughness={0.84} />
          </mesh>
        ) : null}

        <group ref={tail} position={[0.57, 0.05, 0.03]} rotation={[0.18, 0, 0.7]}>
          <mesh position={[0.2, 0.2, 0]} rotation={[0, 0, -0.58]} castShadow>
            <capsuleGeometry args={[0.14, 0.44, 8, 20]} />
            <meshStandardMaterial color={palette.ear} roughness={0.74} />
          </mesh>
          <mesh position={[0.47, 0.42, 0]} rotation={[0, 0, -0.38]} castShadow>
            <capsuleGeometry args={[0.105, 0.25, 8, 18]} />
            <meshStandardMaterial color={palette.paperShade} roughness={0.76} />
          </mesh>
        </group>

        <group ref={frontLeft} position={[-0.43, -0.48, 0.67]}>
          <mesh position={[0, -0.08, 0]} castShadow>
            <capsuleGeometry args={[0.16, 0.32, 8, 20]} />
            <meshStandardMaterial color={palette.furShade} roughness={0.78} />
          </mesh>
          <mesh position={[0, -0.31, 0.12]} scale={[1.1, 0.72, 1.45]} castShadow>
            <sphereGeometry args={[0.18, 26, 18]} />
            <meshStandardMaterial color={palette.paperShade} roughness={0.8} />
          </mesh>
          {meadowTarget ? (
            <group position={[0, -0.34, 0.3]}>
              {[-0.07, 0, 0.07].map((x) => (
                <mesh key={x} position={[x, 0, 0]} scale={[0.024, 0.018, 0.012]}>
                  <sphereGeometry args={[1, 12, 8]} />
                  <meshStandardMaterial color={palette.cheek} roughness={0.86} />
                </mesh>
              ))}
            </group>
          ) : null}
        </group>

        <group ref={wavePaw} position={[0.43, -0.48, 0.67]} rotation={[0, 0, -0.18]}>
          <mesh position={[0, -0.08, 0]} castShadow>
            <capsuleGeometry args={[0.16, 0.32, 8, 20]} />
            <meshStandardMaterial color={palette.furShade} roughness={0.78} />
          </mesh>
          <mesh position={[0, -0.31, 0.12]} scale={[1.1, 0.72, 1.45]} castShadow>
            <sphereGeometry args={[0.18, 26, 18]} />
            <meshStandardMaterial color={palette.paperShade} roughness={0.8} />
          </mesh>
          {meadowTarget ? (
            <group position={[0, -0.34, 0.3]}>
              {[-0.07, 0, 0.07].map((x) => (
                <mesh key={x} position={[x, 0, 0]} scale={[0.024, 0.018, 0.012]}>
                  <sphereGeometry args={[1, 12, 8]} />
                  <meshStandardMaterial color={palette.cheek} roughness={0.86} />
                </mesh>
              ))}
            </group>
          ) : null}
        </group>

        <group ref={rearLeft} position={[-0.43, -0.5, 0.06]}>
          <mesh position={[0, 0.02, 0]} scale={[0.3, 0.36, 0.32]} castShadow>
            <sphereGeometry args={[0.72, 30, 22]} />
            <meshStandardMaterial color={palette.fur} roughness={0.74} />
          </mesh>
          <mesh position={[0, -0.23, 0.22]} scale={[0.29, 0.17, 0.43]} castShadow>
            <sphereGeometry args={[0.72, 28, 20]} />
            <meshStandardMaterial color={palette.furShade} roughness={0.8} />
          </mesh>
        </group>
        <group ref={rearRight} position={[0.43, -0.5, 0.06]}>
          <mesh position={[0, 0.02, 0]} scale={[0.3, 0.36, 0.32]} castShadow>
            <sphereGeometry args={[0.72, 30, 22]} />
            <meshStandardMaterial color={palette.fur} roughness={0.74} />
          </mesh>
          <mesh position={[0, -0.23, 0.22]} scale={[0.29, 0.17, 0.43]} castShadow>
            <sphereGeometry args={[0.72, 28, 20]} />
            <meshStandardMaterial color={palette.furShade} roughness={0.8} />
          </mesh>
        </group>

        <group ref={head} position={[0, 0.65, 0.54]}>
          <mesh scale={[0.77, 0.7, 0.63]} castShadow receiveShadow>
            <sphereGeometry args={[0.86, 48, 38]} />
            <meshPhysicalMaterial color={palette.fur} roughness={0.62} clearcoat={0.1} clearcoatRoughness={0.86} />
          </mesh>
          <mesh position={[-0.47, -0.02, 0.35]} scale={[0.27, 0.34, 0.25]} castShadow>
            <sphereGeometry args={[0.72, 30, 22]} />
            <meshStandardMaterial color={palette.paperShade} roughness={0.76} />
          </mesh>
          <mesh position={[0.47, -0.02, 0.35]} scale={[0.27, 0.34, 0.25]} castShadow>
            <sphereGeometry args={[0.72, 30, 22]} />
            <meshStandardMaterial color={palette.paperShade} roughness={0.76} />
          </mesh>

          <group ref={earLeft} position={[-0.58, 0.2, -0.02]} rotation={[0.1, 0, -0.5]}>
            <mesh scale={[0.28, 0.55, 0.2]} castShadow>
              <sphereGeometry args={[0.78, 30, 22]} />
              <meshStandardMaterial color={palette.ear} roughness={0.75} />
            </mesh>
            <mesh position={[0.025, -0.035, 0.155]} scale={[0.13, 0.36, 0.035]}>
              <sphereGeometry args={[0.78, 24, 18]} />
              <meshStandardMaterial color={palette.cheek} roughness={0.82} />
            </mesh>
            <mesh position={[-0.015, -0.37, 0.015]} scale={[0.2, 0.2, 0.18]} castShadow>
              <sphereGeometry args={[0.7, 24, 18]} />
              <meshStandardMaterial color={palette.ear} roughness={0.76} />
            </mesh>
          </group>
          <group ref={earRight} position={[0.58, 0.2, -0.02]} rotation={[0.1, 0, 0.5]}>
            <mesh scale={[0.28, 0.55, 0.2]} castShadow>
              <sphereGeometry args={[0.78, 30, 22]} />
              <meshStandardMaterial color={palette.ear} roughness={0.75} />
            </mesh>
            <mesh position={[-0.025, -0.035, 0.155]} scale={[0.13, 0.36, 0.035]}>
              <sphereGeometry args={[0.78, 24, 18]} />
              <meshStandardMaterial color={palette.cheek} roughness={0.82} />
            </mesh>
            <mesh position={[0.015, -0.37, 0.015]} scale={[0.2, 0.2, 0.18]} castShadow>
              <sphereGeometry args={[0.7, 24, 18]} />
              <meshStandardMaterial color={palette.ear} roughness={0.76} />
            </mesh>
          </group>

          <mesh position={[0, 0.16, 0.555]} scale={[0.29, 0.4, 0.07]}>
            <sphereGeometry args={[0.72, 30, 22]} />
            <meshStandardMaterial color={palette.paperShade} roughness={0.8} />
          </mesh>
          <mesh position={[-0.26, 0.255, 0.605]} rotation={[0, 0, -0.12]} scale={[0.16, 0.035, 0.025]}>
            <capsuleGeometry args={[0.5, 0.5, 6, 16]} />
            <meshStandardMaterial color={palette.ear} roughness={0.82} />
          </mesh>
          <mesh position={[0.26, 0.255, 0.605]} rotation={[0, 0, 0.12]} scale={[0.16, 0.035, 0.025]}>
            <capsuleGeometry args={[0.5, 0.5, 6, 16]} />
            <meshStandardMaterial color={palette.ear} roughness={0.82} />
          </mesh>

          <mesh ref={eyeLeft} position={[-0.265, 0.115, 0.62]} scale={[0.095, 0.118, 0.075]}>
            <sphereGeometry args={[0.8, 28, 22]} />
            <meshPhysicalMaterial color={palette.ink} roughness={0.08} clearcoat={1} clearcoatRoughness={0.04} />
          </mesh>
          <mesh ref={eyeRight} position={[0.265, 0.115, 0.62]} scale={[0.095, 0.118, 0.075]}>
            <sphereGeometry args={[0.8, 28, 22]} />
            <meshPhysicalMaterial color={palette.ink} roughness={0.08} clearcoat={1} clearcoatRoughness={0.04} />
          </mesh>
          {[-0.265, 0.265].map((x) => (
            <group key={x}>
              <mesh position={[x - 0.022, 0.158, 0.684]} scale={0.03}>
                <sphereGeometry args={[1, 14, 10]} />
                <meshBasicMaterial color={palette.paper} toneMapped={false} />
              </mesh>
              <mesh position={[x + 0.034, 0.092, 0.688]} scale={0.012}>
                <sphereGeometry args={[1, 10, 8]} />
                <meshBasicMaterial color={palette.skyHorizon} toneMapped={false} />
              </mesh>
            </group>
          ))}

          <mesh position={[-0.145, -0.13, 0.6]} scale={[0.25, 0.22, 0.2]} castShadow>
            <sphereGeometry args={[0.76, 32, 24]} />
            <meshStandardMaterial color={palette.furShade} roughness={0.74} />
          </mesh>
          <mesh position={[0.145, -0.13, 0.6]} scale={[0.25, 0.22, 0.2]} castShadow>
            <sphereGeometry args={[0.76, 32, 24]} />
            <meshStandardMaterial color={palette.furShade} roughness={0.74} />
          </mesh>
          <mesh position={[0, -0.245, 0.59]} scale={[0.22, 0.13, 0.12]}>
            <sphereGeometry args={[0.72, 26, 18]} />
            <meshStandardMaterial color={palette.paperShade} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.055, 0.79]} scale={[0.145, 0.105, 0.09]} castShadow>
            <sphereGeometry args={[0.72, 28, 20]} />
            <meshPhysicalMaterial color={palette.ink} roughness={0.18} clearcoat={0.7} clearcoatRoughness={0.12} />
          </mesh>
          <mesh position={[-0.035, -0.025, 0.855]} scale={[0.032, 0.018, 0.01]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshBasicMaterial color={palette.paper} toneMapped={false} />
          </mesh>
          <mesh position={[0, -0.266, 0.735]} rotation={[0, 0, Math.PI]} scale={[1, 0.55, 1]}>
            <torusGeometry args={[0.14, 0.014, 10, 30, Math.PI]} />
            <meshStandardMaterial color={palette.ink} roughness={0.42} />
          </mesh>
          <mesh position={[0, -0.33, 0.73]} scale={[0.075, 0.045, 0.025]}>
            <sphereGeometry args={[1, 20, 14]} />
            <meshStandardMaterial color={palette.cheek} roughness={0.72} />
          </mesh>

          <mesh position={[-0.4, -0.14, 0.49]} scale={[0.13, 0.076, 0.035]}>
            <sphereGeometry args={[0.75, 20, 14]} />
            <meshStandardMaterial color={palette.cheek} transparent opacity={0.5} roughness={0.84} />
          </mesh>
          <mesh position={[0.4, -0.14, 0.49]} scale={[0.13, 0.076, 0.035]}>
            <sphereGeometry args={[0.75, 20, 14]} />
            <meshStandardMaterial color={palette.cheek} transparent opacity={0.5} roughness={0.84} />
          </mesh>

          <group position={[0, 0.6, -0.01]}>
            {[-0.13, 0, 0.13].map((x, index) => (
              <mesh key={x} position={[x, index === 1 ? 0.06 : 0, 0]} rotation={[0, 0, (index - 1) * -0.3]} scale={[0.13, 0.17, 0.1]}>
                <sphereGeometry args={[0.72, 24, 18]} />
                <meshStandardMaterial color={index === 1 ? palette.furShade : palette.ear} roughness={0.78} />
              </mesh>
            ))}
          </group>
        </group>

        <mesh position={[0, 0.27, 0.97]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.42, 0.042, 16, 56]} />
          <meshPhysicalMaterial color={palette.cover} roughness={0.46} clearcoat={0.32} clearcoatRoughness={0.48} />
        </mesh>
        <mesh position={[0, 0.17, 1.035]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.085, 0.085, 0.028, 28]} />
          <meshPhysicalMaterial color={palette.sun} metalness={0.52} roughness={0.34} />
        </mesh>
        <mesh geometry={heartGeometry} position={[0, 0.17, 1.055]} scale={0.075}>
          <meshStandardMaterial color={palette.rose} side={THREE.DoubleSide} roughness={0.54} />
        </mesh>
      </group>
    </group>
  );
}

function SceneLighting({
  palette,
  mood,
  variant,
  qualityLow,
  isMobile,
}: {
  palette: ScenePalette;
  mood: PuppySceneMood;
  variant: "hero" | "inline";
  qualityLow: boolean;
  isMobile: boolean;
}) {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const rim = useRef<THREE.PointLight>(null!);

  useFrame((_, delta) => {
    if (!sun.current || !rim.current) return;
    const hero = variant === "hero";
    const sunTarget = hero ? (mood === "submitting" || mood === "success" ? 4.1 : mood === "error" ? 2.15 : 3.2) : 1.7;
    const rimTarget = hero ? (mood === "submitting" ? 2.2 : mood === "success" ? 2.8 : mood === "error" ? 0.45 : 1.1) : 0.48;
    sun.current.intensity = damp(sun.current.intensity, sunTarget, 5, delta);
    rim.current.intensity = damp(rim.current.intensity, rimTarget, 5, delta);
  });

  const shadowSize = qualityLow || isMobile ? 512 : 1024;

  return (
    <>
      <ambientLight intensity={variant === "hero" ? 0.42 : 1.05} color={palette.paper} />
      <hemisphereLight args={[palette.skyHorizon, palette.shadow, variant === "hero" ? 1.35 : 0.9]} />
      <directionalLight
        ref={sun}
        position={[-4.8, 6.2, 4.5]}
        intensity={variant === "hero" ? 3.2 : 1.7}
        color={palette.sun}
        castShadow={variant === "hero" && !qualityLow}
        shadow-mapSize-width={shadowSize}
        shadow-mapSize-height={shadowSize}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={4}
        shadow-camera-bottom={-3}
        shadow-camera-near={0.5}
        shadow-camera-far={18}
        shadow-bias={-0.00035}
      />
      <pointLight ref={rim} position={[2.8, 2.5, 3.4]} intensity={variant === "hero" ? 1.1 : 0.48} color={palette.rose} distance={8} decay={2} />
    </>
  );
}

function HeroStage({
  palette,
  isMobile,
  pointer,
  mood,
  reduced,
  allowSoftMotion,
  interactive,
  interactionId,
  burstId,
  target,
  grassCount,
  fireflyCount,
  onGroundInteract,
  onPuppyInteract,
}: {
  palette: ScenePalette;
  isMobile: boolean;
  pointer: MutableRefObject<{ x: number; y: number }>;
  mood: PuppySceneMood;
  reduced: boolean;
  allowSoftMotion: boolean;
  interactive: boolean;
  interactionId: number;
  burstId: number;
  target: MeadowTarget;
  grassCount: number;
  fireflyCount: number;
  onGroundInteract: (x: number, z: number) => void;
  onPuppyInteract: () => void;
}) {
  const root = useRef<THREE.Group>(null!);

  useFrame((_, delta) => {
    if (!root.current) return;
    const quiet = reduced || mood === "focused" || mood === "submitting" ? 0.18 : 1;
    root.current.rotation.y = damp(root.current.rotation.y, pointer.current.x * 0.018 * quiet, 4, delta);
    root.current.rotation.x = damp(root.current.rotation.x, pointer.current.y * -0.008 * quiet, 4, delta);
  });

  const handleGroundClick = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive || (event.delta ?? 0) > 8 || !root.current) return;
    event.stopPropagation();
    const localPoint = root.current.worldToLocal(event.point.clone());
    onGroundInteract(THREE.MathUtils.clamp(localPoint.x, -3.25, 2.75), THREE.MathUtils.clamp(localPoint.z, -1.55, 1.7));
  };

  return (
    <group ref={root} position={isMobile ? [0, -0.18, 0] : [-1.08, -0.76, 0]} scale={isMobile ? 0.78 : 1.02}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]} receiveShadow onClick={handleGroundClick}>
        <planeGeometry args={[9.2, 5.8]} />
        <meshStandardMaterial color={palette.grass} roughness={0.98} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.4, -0.02, 1.8]} scale={[1.55, 0.72, 1]} receiveShadow onClick={handleGroundClick}>
        <circleGeometry args={[3.2, 52]} />
        <meshStandardMaterial color={palette.grassTip} roughness={1} />
      </mesh>
      <GrassField palette={palette} count={grassCount} reduced={reduced} mood={mood} />
      <MeadowFlowers palette={palette} count={grassCount > 600 ? 28 : grassCount > 300 ? 20 : 12} reduced={reduced} mood={mood} />
      <PicnicKeepsake palette={palette} />
      <Puppy
        palette={palette}
        pointer={pointer}
        mood={mood}
        reduced={reduced}
        allowSoftMotion={allowSoftMotion}
        interactive={interactive}
        interactionId={interactionId}
        meadowTarget={target}
        scale={isMobile ? 0.75 : 0.84}
        position={[-0.68, 0.58, 0.68]}
        onInteract={onPuppyInteract}
      />
      <TargetGlow palette={palette} target={target} mood={mood} reduced={reduced} />
      <MeadowPetals palette={palette} target={target} burstId={burstId} reduced={reduced} />
      <Fireflies palette={palette} count={fireflyCount} reduced={reduced} mood={mood} />
    </group>
  );
}

function InlineStage({
  palette,
  pointer,
  mood,
  reduced,
  allowSoftMotion,
  interactive,
  interactionId,
  onInteract,
}: {
  palette: ScenePalette;
  pointer: MutableRefObject<{ x: number; y: number }>;
  mood: PuppySceneMood;
  reduced: boolean;
  allowSoftMotion: boolean;
  interactive: boolean;
  interactionId: number;
  onInteract: () => void;
}) {
  return (
    <group position={[0, -0.18, 0]}>
      <Puppy
        palette={palette}
        pointer={pointer}
        mood={mood}
        reduced={reduced}
        allowSoftMotion={allowSoftMotion}
        interactive={interactive}
        interactionId={interactionId}
        scale={0.92}
        position={[0, -0.1, 0]}
        onInteract={onInteract}
      />
    </group>
  );
}

class SceneErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The login form remains fully usable through the static scene fallback.
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function PuppyScene({
  variant = "hero",
  interactive = true,
  reducedMotionFallback = "soft",
  mood = "idle",
  onReady,
  className,
}: PuppySceneProps) {
  const pointer = useRef({ x: 0, y: 0 });
  const [interactionId, setInteractionId] = useState(0);
  const [burstId, setBurstId] = useState(0);
  const [meadowTarget, setMeadowTarget] = useState<MeadowTarget>({ x: 0.55, z: 0.18, id: 1, source: "grass" });
  const [reduced, setReduced] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [pointerFine, setPointerFine] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [qualityLow, setQualityLow] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const previousMood = useRef<PuppySceneMood>("idle");
  const palette = useScenePalette();

  useEffect(() => {
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const pointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => {
      setReduced(reducedQuery.matches);
      setIsMobile(mobileQuery.matches);
      setPointerFine(pointerQuery.matches);
    };
    update();
    setWebglAvailable(supportsWebGL());
    reducedQuery.addEventListener?.("change", update);
    mobileQuery.addEventListener?.("change", update);
    pointerQuery.addEventListener?.("change", update);
    return () => {
      reducedQuery.removeEventListener?.("change", update);
      mobileQuery.removeEventListener?.("change", update);
      pointerQuery.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!pointerFine || reduced || variant !== "hero") {
      pointer.current.x = 0;
      pointer.current.y = 0;
      return;
    }
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [pointerFine, reduced, variant]);

  useEffect(() => {
    if (variant !== "hero" || previousMood.current === mood) return;
    previousMood.current = mood;
    if (mood === "submitting") {
      const mobileNow = window.matchMedia("(max-width: 767px)").matches;
      setMeadowTarget((current) => ({
        x: mobileNow ? 0.72 : 1.78,
        z: mobileNow ? -0.22 : -0.48,
        id: current.id + 1,
        source: "submit",
      }));
      setBurstId((value) => value + 1);
    } else if (mood === "success") {
      setMeadowTarget((current) => ({ x: current.x - 0.28, z: current.z + 0.12, id: current.id + 1, source: "success" }));
      setInteractionId((value) => value + 1);
      setBurstId((value) => value + 1);
    }
  }, [mood, variant]);

  const onPuppyInteract = () => {
    setInteractionId((value) => value + 1);
    setBurstId((value) => value + 1);
    if (variant === "hero") {
      setMeadowTarget((current) => ({ ...current, id: current.id + 1, source: "puppy" }));
    }
  };
  const onGroundInteract = (x: number, z: number) => {
    setMeadowTarget((current) => ({ x, z, id: current.id + 1, source: "grass" }));
    setBurstId((value) => value + 1);
  };
  const allowSoftMotion = reducedMotionFallback === "soft";
  const grassCount = variant === "hero" ? (qualityLow || reduced ? 220 : isMobile ? 500 : 900) : 0;
  const fireflyCount = variant === "hero" ? (qualityLow || reduced ? 10 : isMobile ? 20 : 36) : 0;
  const stageClassName = variant === "hero" ? "puppy-scene-hero" : "puppy-scene-inline";
  const fallback = <div className={`${stageClassName} puppy-scene-fallback ${className ?? ""}`.trim()} aria-hidden="true" />;

  if (!webglAvailable) return fallback;

  return (
    <SceneErrorBoundary fallback={fallback}>
      <div className={`${stageClassName} ${className ?? ""}`.trim()} data-scene-mood={mood} aria-hidden="true">
        <Canvas
          camera={{ position: [0, variant === "hero" ? 1.6 : 0.6, variant === "hero" ? 8.8 : 5.4], fov: variant === "hero" ? 40 : 45 }}
          dpr={qualityLow ? [1, 1.1] : isMobile ? [1, 1.25] : [1, 1.5]}
          frameloop={!pageVisible || (reduced && reducedMotionFallback === "still") ? "demand" : "always"}
          gl={{ antialias: !qualityLow && !isMobile, alpha: true, powerPreference: "high-performance" }}
          shadows={variant === "hero" && !qualityLow}
          performance={{ min: 0.55 }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = variant === "hero" ? 1.04 : 1;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
            onReady?.();
          }}
          className={interactive ? "!pointer-events-auto" : "!pointer-events-none"}
          style={{ touchAction: "pan-y" }}
          tabIndex={-1}
        >
          <PerformanceMonitor flipflops={1} onDecline={() => setQualityLow(true)} />
          <HeroCamera variant={variant} isMobile={isMobile} pointer={pointer} reduced={reduced} mood={mood} />
          {variant === "hero" ? <fog attach="fog" args={[palette.skyTop, 8.5, 23]} /> : null}
          {variant === "hero" ? <SunsetBackdrop palette={palette} reduced={reduced} mood={mood} /> : null}
          <SceneLighting palette={palette} mood={mood} variant={variant} qualityLow={qualityLow} isMobile={isMobile} />

          {variant === "hero" ? (
            <HeroStage
              palette={palette}
              isMobile={isMobile}
              pointer={pointer}
              mood={mood}
              reduced={reduced}
              allowSoftMotion={allowSoftMotion}
              interactive={interactive}
              interactionId={interactionId}
              burstId={burstId}
              target={meadowTarget}
              grassCount={grassCount}
              fireflyCount={fireflyCount}
              onGroundInteract={onGroundInteract}
              onPuppyInteract={onPuppyInteract}
            />
          ) : (
            <InlineStage
              palette={palette}
              pointer={pointer}
              mood={mood}
              reduced={reduced}
              allowSoftMotion={allowSoftMotion}
              interactive={interactive}
              interactionId={interactionId}
              onInteract={onPuppyInteract}
            />
          )}
        </Canvas>
      </div>
    </SceneErrorBoundary>
  );
}
