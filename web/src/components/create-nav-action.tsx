"use client";

// Animated bottom-nav create action with a cute rotating Three.js plus model and reduced-motion static fallback.

import Link from "next/link";
import { Plus } from "lucide-react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { Shape } from "three";
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

function CreatePlusModel({ active, reduced }: { active: boolean; reduced: boolean }) {
  const groupRef = useRef<Group>(null);
  const heartShape = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0.18);
    shape.bezierCurveTo(0, 0.36, -0.34, 0.36, -0.34, 0.1);
    shape.bezierCurveTo(-0.34, -0.12, -0.1, -0.26, 0, -0.42);
    shape.bezierCurveTo(0.1, -0.26, 0.34, -0.12, 0.34, 0.1);
    shape.bezierCurveTo(0.34, 0.36, 0, 0.36, 0, 0.18);
    return shape;
  }, []);

  useFrame((state, delta) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.z += delta * 0.72;
    groupRef.current.rotation.y += delta * 0.38;
    const scale = 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.025;
    groupRef.current.scale.setScalar(scale);
  });

  return (
    <group ref={groupRef} rotation={reduced ? [0.18, -0.32, -0.16] : [0.18, 0, 0]}>
      <group scale={active ? 1.06 : 1}>
        <RoundedBox args={[1.35, 0.42, 0.38]} radius={0.18} smoothness={8}>
          <meshStandardMaterial color={active ? "#9f3f5c" : "#c45d77"} roughness={0.45} metalness={0.05} />
        </RoundedBox>
        <RoundedBox args={[0.42, 1.35, 0.38]} radius={0.18} smoothness={8}>
          <meshStandardMaterial color={active ? "#b65370" : "#df8f9d"} roughness={0.48} metalness={0.04} />
        </RoundedBox>
        <RoundedBox args={[0.48, 0.48, 0.45]} radius={0.18} smoothness={8} position={[0, 0, 0.04]}>
          <meshStandardMaterial color="#efb48b" roughness={0.42} metalness={0.08} />
        </RoundedBox>
      </group>

      <mesh position={[0.82, 0.72, 0.02]} scale={0.28} rotation={[0, 0, -0.18]}>
        <extrudeGeometry args={[heartShape, { depth: 0.08, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.025, bevelThickness: 0.02 }]} />
        <meshStandardMaterial color="#efb48b" roughness={0.5} />
      </mesh>
      <mesh position={[-0.84, -0.68, 0.02]} scale={0.16}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#74aa91" roughness={0.44} />
      </mesh>
      <mesh position={[-0.82, 0.74, -0.02]} scale={0.12}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#f5c6b8" roughness={0.42} />
      </mesh>
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
        <ambientLight intensity={1.65} />
        <directionalLight position={[1.5, 2.2, 3]} intensity={2.25} />
        <CreatePlusModel active={active} reduced={reduced} />
      </Canvas>
      <span className="absolute inset-[9px] rounded-full bg-white/12 ring-1 ring-white/30" aria-hidden="true" />
      <Plus className="relative z-10 h-7 w-7 drop-shadow-sm transition duration-200 group-hover:scale-105" />
    </Link>
  );
}
