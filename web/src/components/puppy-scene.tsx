"use client";

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Float, Stars } from "@react-three/drei";
import { useRef, useState, useMemo, useEffect } from "react";
import * as THREE from "three";

const COLOR = {
  bodyLight: new THREE.Color("#fff7f1"),
  bodyShade: new THREE.Color("#f0d9c8"),
  earBrown: new THREE.Color("#bf8a6b"),
  pawShade: new THREE.Color("#e6c2ad"),
  blackEye: new THREE.Color("#2a1f1c"),
  noseDark: new THREE.Color("#3a2a26"),
  cheekPink: new THREE.Color("#f5a6a6"),
  tongue: new THREE.Color("#ff6f87"),
};

interface PuppyProps {
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  reduced: boolean;
  onClick: () => void;
  jumpUntil: number;
  wagBoost: number;
}

function Puppy({ pointer, reduced, onClick, jumpUntil, wagBoost }: PuppyProps) {
  const root = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const tail = useRef<THREE.Group>(null!);
  const earL = useRef<THREE.Mesh>(null!);
  const earR = useRef<THREE.Mesh>(null!);
  const eyeL = useRef<THREE.Mesh>(null!);
  const eyeR = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);

  const idleSeed = useRef(Math.random() * 100);

  useFrame((state, delta) => {
    if (reduced) return;
    const t = state.clock.getElapsedTime();
    const root3 = root.current;
    const headRef = head.current;
    const tailRef = tail.current;

    if (root3) {
      const breathe = Math.sin(t * 1.6 + idleSeed.current) * 0.06;
      const isJumping = state.clock.getElapsedTime() * 1000 < jumpUntil;
      const jumpProgress = isJumping
        ? Math.max(0, (jumpUntil - state.clock.getElapsedTime() * 1000) / 480)
        : 0;
      const jumpY = isJumping ? Math.sin(jumpProgress * Math.PI) * 0.55 : 0;
      root3.position.y = THREE.MathUtils.lerp(root3.position.y, breathe + jumpY - 0.05, 0.18);
      root3.rotation.z = THREE.MathUtils.lerp(
        root3.rotation.z,
        Math.sin(t * 0.9) * 0.02,
        0.1,
      );
    }

    if (headRef) {
      const px = pointer.current.x;
      const py = pointer.current.y;
      const targetY = THREE.MathUtils.clamp(px * 0.7, -0.85, 0.85);
      const targetX = THREE.MathUtils.clamp(-py * 0.45, -0.55, 0.55);
      headRef.rotation.y = THREE.MathUtils.lerp(headRef.rotation.y, targetY, 0.08);
      headRef.rotation.x = THREE.MathUtils.lerp(headRef.rotation.x, targetX, 0.08);
      const tilt = Math.sin(t * 1.2) * 0.04;
      headRef.rotation.z = THREE.MathUtils.lerp(headRef.rotation.z, tilt, 0.06);
    }

    if (tailRef) {
      const wagSpeed = wagBoost > t * 1000 ? 22 : 4;
      const wagAmp = wagBoost > t * 1000 ? 1.0 : 0.35;
      tailRef.rotation.z = Math.sin(t * wagSpeed) * wagAmp + 0.6;
    }

    if (earL.current && earR.current) {
      const swing = Math.sin(t * 2.4) * 0.08;
      earL.current.rotation.z = -0.45 + swing;
      earR.current.rotation.z = 0.45 - swing;
    }

    // Blink occasionally
    if (eyeL.current && eyeR.current) {
      const cycle = (t + idleSeed.current) % 4.5;
      const blink = cycle > 4.2 ? Math.max(0.05, 1 - (cycle - 4.2) * 6) : 1;
      const sy = THREE.MathUtils.clamp(blink, 0.05, 1);
      eyeL.current.scale.y = sy;
      eyeR.current.scale.y = sy;
    }
  });

  return (
    <group
      ref={root}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      scale={hovered ? 1.04 : 1}
      position={[0, -0.05, 0]}
    >
      {/* Body */}
      <mesh castShadow receiveShadow position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.95, 48, 36]} />
        <meshStandardMaterial color={COLOR.bodyLight} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* Belly accent */}
      <mesh position={[0, -0.15, 0.55]}>
        <sphereGeometry args={[0.55, 32, 24]} />
        <meshStandardMaterial color={COLOR.bodyShade} roughness={0.7} />
      </mesh>

      {/* Tail */}
      <group ref={tail} position={[0, 0.25, -0.85]}>
        <mesh position={[0, 0.25, -0.05]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.12, 0.55, 16]} />
          <meshStandardMaterial color={COLOR.bodyLight} roughness={0.65} />
        </mesh>
        <mesh position={[0, 0.55, -0.1]}>
          <sphereGeometry args={[0.13, 24, 18]} />
          <meshStandardMaterial color={COLOR.earBrown} roughness={0.55} />
        </mesh>
      </group>

      {/* Legs */}
      {[
        [-0.45, -0.6, 0.55],
        [0.45, -0.6, 0.55],
        [-0.45, -0.6, -0.45],
        [0.45, -0.6, -0.45],
      ].map((p, i) => (
        <group key={i} position={p as [number, number, number]}>
          <mesh>
            <cylinderGeometry args={[0.16, 0.18, 0.42, 18]} />
            <meshStandardMaterial color={COLOR.bodyLight} roughness={0.6} />
          </mesh>
          <mesh position={[0, -0.21, 0.05]}>
            <sphereGeometry args={[0.18, 24, 20]} />
            <meshStandardMaterial color={COLOR.pawShade} roughness={0.7} />
          </mesh>
        </group>
      ))}

      {/* Head group */}
      <group ref={head} position={[0, 0.85, 0.45]}>
        <mesh>
          <sphereGeometry args={[0.78, 48, 36]} />
          <meshStandardMaterial color={COLOR.bodyLight} roughness={0.55} />
        </mesh>

        {/* Snout */}
        <mesh position={[0, -0.18, 0.62]}>
          <sphereGeometry args={[0.34, 32, 24]} />
          <meshStandardMaterial color={COLOR.bodyShade} roughness={0.7} />
        </mesh>

        {/* Nose */}
        <mesh position={[0, -0.05, 0.92]}>
          <sphereGeometry args={[0.1, 24, 20]} />
          <meshStandardMaterial color={COLOR.noseDark} roughness={0.35} metalness={0.1} />
        </mesh>

        {/* Mouth highlight */}
        <mesh position={[0, -0.27, 0.88]} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.06, 0.018, 16, 24, Math.PI]} />
          <meshStandardMaterial color={COLOR.noseDark} roughness={0.5} />
        </mesh>

        {/* Tongue */}
        <mesh position={[0, -0.32, 0.88]}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshStandardMaterial color={COLOR.tongue} roughness={0.4} />
        </mesh>

        {/* Cheeks */}
        <mesh position={[-0.36, -0.12, 0.6]}>
          <sphereGeometry args={[0.11, 18, 14]} />
          <meshStandardMaterial color={COLOR.cheekPink} roughness={0.85} transparent opacity={0.55} />
        </mesh>
        <mesh position={[0.36, -0.12, 0.6]}>
          <sphereGeometry args={[0.11, 18, 14]} />
          <meshStandardMaterial color={COLOR.cheekPink} roughness={0.85} transparent opacity={0.55} />
        </mesh>

        {/* Eyes */}
        <mesh ref={eyeL} position={[-0.27, 0.12, 0.66]}>
          <sphereGeometry args={[0.085, 24, 20]} />
          <meshStandardMaterial color={COLOR.blackEye} roughness={0.2} />
        </mesh>
        <mesh ref={eyeR} position={[0.27, 0.12, 0.66]}>
          <sphereGeometry args={[0.085, 24, 20]} />
          <meshStandardMaterial color={COLOR.blackEye} roughness={0.2} />
        </mesh>
        {/* Eye highlights */}
        <mesh position={[-0.245, 0.16, 0.74]}>
          <sphereGeometry args={[0.025, 12, 10]} />
          <meshStandardMaterial color="#ffffff" roughness={0.05} />
        </mesh>
        <mesh position={[0.295, 0.16, 0.74]}>
          <sphereGeometry args={[0.025, 12, 10]} />
          <meshStandardMaterial color="#ffffff" roughness={0.05} />
        </mesh>

        {/* Ears */}
        <mesh ref={earL} position={[-0.62, 0.4, 0.05]} rotation={[0.2, 0, -0.45]}>
          <coneGeometry args={[0.32, 0.7, 24]} />
          <meshStandardMaterial color={COLOR.earBrown} roughness={0.6} />
        </mesh>
        <mesh ref={earR} position={[0.62, 0.4, 0.05]} rotation={[0.2, 0, 0.45]}>
          <coneGeometry args={[0.32, 0.7, 24]} />
          <meshStandardMaterial color={COLOR.earBrown} roughness={0.6} />
        </mesh>

        {/* Top tuft */}
        <mesh position={[0, 0.66, 0.05]}>
          <sphereGeometry args={[0.18, 24, 18]} />
          <meshStandardMaterial color={COLOR.earBrown} roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

function HeartParticles({ reduced }: { reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null!);
  const positions = useMemo(() => {
    const arr: { x: number; y: number; z: number; phase: number; speed: number }[] = [];
    for (let i = 0; i < 14; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 7,
        y: (Math.random() - 0.5) * 4 - 1,
        z: -1.5 - Math.random() * 3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.25 + Math.random() * 0.4,
      });
    }
    return arr;
  }, []);

  useFrame((state) => {
    if (reduced || !groupRef.current) return;
    const t = state.clock.getElapsedTime();
    groupRef.current.children.forEach((child, i) => {
      const def = positions[i];
      child.position.y = def.y + Math.sin(t * def.speed + def.phase) * 0.55;
      child.position.x = def.x + Math.cos(t * def.speed * 0.6 + def.phase) * 0.35;
      child.rotation.z = Math.sin(t * 0.5 + def.phase) * 0.4;
    });
  });

  return (
    <group ref={groupRef}>
      {positions.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} scale={0.08 + Math.random() * 0.08}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? "#f4c7b8" : i % 3 === 1 ? "#e7c8c0" : "#ffd9d9"}
            transparent
            opacity={0.55}
            roughness={0.5}
          />
        </mesh>
      ))}
    </group>
  );
}

export function PuppyScene() {
  const pointer = useRef({ x: 0, y: 0 });
  const [jumpUntil, setJumpUntil] = useState(0);
  const [wagUntil, setWagUntil] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: PointerEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      pointer.current.x = x;
      pointer.current.y = y;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const onPuppyClick = () => {
    const now = performance.now();
    setJumpUntil(now + 480);
    setWagUntil(now + 1500);
  };

  return (
    <div className="absolute inset-0 -z-0 pointer-events-none">
      <Canvas
        camera={{ position: [0, 0.6, 4.6], fov: 38 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true }}
        className="!pointer-events-auto"
        style={{ touchAction: "auto" }}
      >
        <color attach="background" args={["transparent"]} />
        <ambientLight intensity={0.65} />
        <directionalLight
          position={[3, 5, 3]}
          intensity={1.05}
          color="#ffe2ce"
          castShadow
        />
        <directionalLight position={[-3, 2, -2]} intensity={0.55} color="#e7c8c0" />
        <hemisphereLight args={["#fff1e8", "#b76e79", 0.4]} />

        <Stars
          radius={26}
          depth={36}
          count={420}
          factor={2.4}
          saturation={0.4}
          fade
          speed={reduced ? 0 : 0.6}
        />
        <HeartParticles reduced={reduced} />

        <Float
          enabled={!reduced}
          speed={1.4}
          rotationIntensity={0.18}
          floatIntensity={0.45}
        >
          <Puppy
            pointer={pointer}
            reduced={reduced}
            onClick={onPuppyClick}
            jumpUntil={jumpUntil}
            wagBoost={wagUntil}
          />
        </Float>
      </Canvas>
    </div>
  );
}
