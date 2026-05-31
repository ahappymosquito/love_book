"use client";

// Lightweight Three.js lottery animation for the todo restaurant draw, with reduced-motion fallback.

import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import type { Group } from "three";

function LotteryOrb({ spinning }: { spinning: boolean }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!group.current || !spinning) return;
    group.current.rotation.y += delta * 1.7;
    group.current.rotation.x += delta * 0.55;
  });
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[1.25, 2]} />
        <meshStandardMaterial color="#df8f9d" roughness={0.42} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0, 0]} scale={1.08}>
        <icosahedronGeometry args={[1.25, 1]} />
        <meshStandardMaterial color="#f5c6b8" transparent opacity={0.22} roughness={0.2} />
      </mesh>
      <Sparkles count={32} scale={3.2} size={2.8} speed={spinning ? 0.55 : 0.15} color="#fff6ef" />
    </group>
  );
}

export function TodoLotteryScene({ spinning }: { spinning: boolean }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const active = spinning && !reducedMotion;
  return (
    <div className="h-40 w-full overflow-hidden rounded-2xl bg-surface-raised/70 hairline" aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 4], fov: 42 }} dpr={[1, 1.6]}>
        <ambientLight intensity={1.8} />
        <pointLight position={[3, 3, 4]} intensity={2.8} />
        <LotteryOrb spinning={active} />
      </Canvas>
    </div>
  );
}
