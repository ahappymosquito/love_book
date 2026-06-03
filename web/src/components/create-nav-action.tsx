"use client";

// Transparent bottom-nav create action exposing a full XYZ-axis floating and rotating Three.js plus model with reduced-motion fallback.

import Link from "next/link";
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
    groupRef.current.rotation.z += delta * 1.18;
    groupRef.current.rotation.y += delta * 0.64;
    groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 2.4) * 0.14;
    const scale = 1.14 + Math.sin(state.clock.elapsedTime * 2.2) * 0.035;
    groupRef.current.scale.setScalar(scale);
  });

  return (
    <group ref={groupRef} rotation={reduced ? [0.42, -0.58, -0.24] : [0.26, 0.18, 0]} scale={reduced ? 1.08 : 1}>
      <group scale={active ? 1.06 : 1}>
        <RoundedBox args={[1.42, 0.46, 0.58]} radius={0.2} smoothness={10}>
          <meshStandardMaterial color={active ? "#9f3f5c" : "#c45d77"} roughness={0.45} metalness={0.05} />
        </RoundedBox>
        <RoundedBox args={[0.46, 1.42, 0.58]} radius={0.2} smoothness={10}>
          <meshStandardMaterial color={active ? "#b65370" : "#df8f9d"} roughness={0.48} metalness={0.04} />
        </RoundedBox>
        <RoundedBox args={[0.48, 0.48, 1.28]} radius={0.19} smoothness={10}>
          <meshStandardMaterial color="#74aa91" roughness={0.5} metalness={0.04} />
        </RoundedBox>
        <RoundedBox args={[0.62, 0.62, 0.72]} radius={0.22} smoothness={10} position={[0, 0, 0.1]}>
          <meshStandardMaterial color="#efb48b" roughness={0.42} metalness={0.08} />
        </RoundedBox>
      </group>

      <mesh position={[1.02, 0.05, 0.02]} scale={0.24} rotation={[0, 0, -0.18]}>
        <extrudeGeometry args={[heartShape, { depth: 0.08, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.025, bevelThickness: 0.02 }]} />
        <meshStandardMaterial color="#efb48b" roughness={0.5} />
      </mesh>
      <mesh position={[-1.04, -0.04, 0.02]} scale={0.14}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#f5c6b8" roughness={0.42} />
      </mesh>
      <mesh position={[0.02, -1.02, 0.04]} scale={0.18}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#74aa91" roughness={0.44} />
      </mesh>
      <mesh position={[0.04, 1.02, -0.04]} scale={0.13} rotation={[0.2, 0.4, 0]}>
        <tetrahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#efb48b" roughness={0.46} />
      </mesh>
      <mesh position={[0.08, 0.04, 0.94]} scale={0.18}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#f5c6b8" roughness={0.42} />
      </mesh>
      <mesh position={[-0.08, -0.02, -0.94]} scale={0.18} rotation={[0, Math.PI, 0.2]}>
        <extrudeGeometry args={[heartShape, { depth: 0.08, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.02, bevelThickness: 0.018 }]} />
        <meshStandardMaterial color="#74aa91" roughness={0.52} />
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
        "group relative mx-auto -mt-12 grid h-[84px] w-[84px] place-items-center rounded-2xl bg-transparent text-white transition duration-200 focus-ring active:translate-y-0.5",
        active ? "scale-105" : "hover:scale-[1.03]",
      )}
      aria-label="记一笔"
      aria-current={active ? "page" : undefined}
    >
      <Canvas
        aria-hidden="true"
        className="absolute inset-[-14px]"
        gl={{ alpha: true }}
        camera={{ position: [0, 0, 4.1], fov: 40 }}
        dpr={[1, 1.5]}
        frameloop={reduced ? "demand" : "always"}
      >
        <ambientLight intensity={1.65} />
        <directionalLight position={[1.5, 2.2, 3]} intensity={2.25} />
        <CreatePlusModel active={active} reduced={reduced} />
      </Canvas>
    </Link>
  );
}
