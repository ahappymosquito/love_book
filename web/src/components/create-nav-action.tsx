"use client";

// Animated bottom-nav create action with a lightweight Three.js scene and a reduced-motion static fallback.

import Link from "next/link";
import { Plus } from "lucide-react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { cn } from "@/lib/cn";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function CreateOrb({ active, reduced }: { active: boolean; reduced: boolean }) {
  const groupRef = useRef<Group>(null);
  const petals = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 6;
        return {
          x: Math.cos(angle) * 0.58,
          y: Math.sin(angle) * 0.58,
          rotation: angle,
        };
      }),
    [],
  );

  useFrame((state, delta) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.z += delta * (active ? 0.32 : 0.22);
    const scale = 1 + Math.sin(state.clock.elapsedTime * 1.8) * 0.035;
    groupRef.current.scale.setScalar(scale);
  });

  return (
    <group ref={groupRef}>
      <mesh scale={active ? 1.08 : 1}>
        <sphereGeometry args={[0.72, 32, 24]} />
        <meshStandardMaterial color={active ? "#9f3f5c" : "#c45d77"} roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh scale={1.18}>
        <sphereGeometry args={[0.72, 32, 16]} />
        <meshStandardMaterial color="#efb48b" transparent opacity={0.24} roughness={0.45} />
      </mesh>
      {petals.map((petal, index) => (
        <mesh key={index} position={[petal.x, petal.y, -0.08]} rotation={[0, 0, petal.rotation]} scale={[0.26, 0.12, 0.08]}>
          <sphereGeometry args={[1, 18, 12]} />
          <meshStandardMaterial color={index % 2 === 0 ? "#efb48b" : "#74aa91"} roughness={0.64} />
        </mesh>
      ))}
    </group>
  );
}

export function CreateNavAction({ active }: { active: boolean }) {
  const reduced = useReducedMotion();

  return (
    <Link
      href="/create"
      className={cn(
        "group relative mx-auto -mt-9 grid h-[68px] w-[68px] place-items-center overflow-hidden rounded-full text-white shadow-glow transition duration-200 focus-ring active:translate-y-0.5",
        active ? "bg-rose-deep" : "bg-rose hover:brightness-[1.03]",
      )}
      aria-label="记一笔"
      aria-current={active ? "page" : undefined}
    >
      <Canvas
        aria-hidden="true"
        className="absolute inset-0"
        camera={{ position: [0, 0, 4.2], fov: 38 }}
        dpr={[1, 1.5]}
        frameloop={reduced ? "demand" : "always"}
      >
        <ambientLight intensity={1.8} />
        <directionalLight position={[1.5, 2.2, 3]} intensity={2.1} />
        <CreateOrb active={active} reduced={reduced} />
      </Canvas>
      <span className="absolute inset-[9px] rounded-full bg-white/12 ring-1 ring-white/30" aria-hidden="true" />
      <Plus className="relative z-10 h-7 w-7 drop-shadow-sm transition duration-200 group-hover:scale-105" />
    </Link>
  );
}
