"use client";

// Transparent bottom-nav create action with a center-symmetric Three.js plus inside an ornate rotating spherical cage.

import Link from "next/link";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import type { Group } from "three";
import { cn } from "@/lib/cn";

type Point3 = [number, number, number];

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

function CageRing({
  rotation,
  color,
  tube = 0.035,
}: {
  rotation: Point3;
  color: string;
  tube?: number;
}) {
  return (
    <mesh rotation={rotation}>
      <torusGeometry args={[1.13, tube, 10, 72]} />
      <meshStandardMaterial color={color} roughness={0.22} metalness={0.72} />
    </mesh>
  );
}

function Jewel({ position, color, scale = 0.105 }: { position: Point3; color: string; scale?: number }) {
  return (
    <mesh position={position} scale={scale}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.34} />
    </mesh>
  );
}

function SymmetricPlus({ active }: { active: boolean }) {
  return (
    <group>
      <RoundedBox args={[1.38, 0.34, 0.34]} radius={0.16} smoothness={10}>
        <meshStandardMaterial color={active ? "#a63f61" : "#c85f7c"} roughness={0.34} metalness={0.18} />
      </RoundedBox>
      <RoundedBox args={[1.38, 0.34, 0.34]} radius={0.16} smoothness={10} rotation={[0, 0, Math.PI / 2]}>
        <meshStandardMaterial color={active ? "#d47e70" : "#efa38f"} roughness={0.34} metalness={0.18} />
      </RoundedBox>
      <RoundedBox args={[1.38, 0.34, 0.34]} radius={0.16} smoothness={10} rotation={[0, Math.PI / 2, 0]}>
        <meshStandardMaterial color={active ? "#5f927b" : "#82b39b"} roughness={0.34} metalness={0.18} />
      </RoundedBox>

      <mesh scale={0.34}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshStandardMaterial color="#f2bb8e" roughness={0.25} metalness={0.3} />
      </mesh>

      <Jewel position={[0.79, 0, 0]} color="#f4b2bd" />
      <Jewel position={[-0.79, 0, 0]} color="#f4b2bd" />
      <Jewel position={[0, 0.79, 0]} color="#f6c18f" />
      <Jewel position={[0, -0.79, 0]} color="#f6c18f" />
      <Jewel position={[0, 0, 0.79]} color="#9ccab4" />
      <Jewel position={[0, 0, -0.79]} color="#9ccab4" />
    </group>
  );
}

function SphericalCage() {
  return (
    <group>
      <CageRing rotation={[0, 0, 0]} color="#d7a76f" tube={0.043} />
      <CageRing rotation={[Math.PI / 2, 0, 0]} color="#d7a76f" tube={0.043} />
      <CageRing rotation={[0, Math.PI / 2, 0]} color="#d7a76f" tube={0.043} />
      <CageRing rotation={[Math.PI / 4, 0, Math.PI / 4]} color="#e8c397" tube={0.022} />
      <CageRing rotation={[-Math.PI / 4, 0, Math.PI / 4]} color="#e8c397" tube={0.022} />
      <CageRing rotation={[0, Math.PI / 4, Math.PI / 4]} color="#e8c397" tube={0.022} />

      <Jewel position={[1.13, 0, 0]} color="#f2bb8e" scale={0.085} />
      <Jewel position={[-1.13, 0, 0]} color="#f2bb8e" scale={0.085} />
      <Jewel position={[0, 1.13, 0]} color="#e78ea3" scale={0.085} />
      <Jewel position={[0, -1.13, 0]} color="#e78ea3" scale={0.085} />
      <Jewel position={[0, 0, 1.13]} color="#8fc0a8" scale={0.085} />
      <Jewel position={[0, 0, -1.13]} color="#8fc0a8" scale={0.085} />
    </group>
  );
}

function CreatePlusModel({ active, reduced }: { active: boolean; reduced: boolean }) {
  const modelRef = useRef<Group>(null);
  const coreRef = useRef<Group>(null);
  const cageRef = useRef<Group>(null);

  useFrame((state, delta) => {
    if (reduced || !modelRef.current || !coreRef.current || !cageRef.current) return;

    modelRef.current.rotation.y += delta * 0.62;
    modelRef.current.rotation.z += delta * 0.38;
    modelRef.current.position.y = Math.sin(state.clock.elapsedTime * 2.35) * 0.12;

    coreRef.current.rotation.x += delta * 0.36;
    coreRef.current.rotation.z += delta * 0.52;
    cageRef.current.rotation.x -= delta * 0.28;
    cageRef.current.rotation.y -= delta * 0.46;

    const scale = 1.04 + Math.sin(state.clock.elapsedTime * 2.1) * 0.025;
    modelRef.current.scale.setScalar(scale);
  });

  return (
    <group
      ref={modelRef}
      rotation={reduced ? [0.5, -0.62, -0.22] : [0.28, 0.24, -0.14]}
      scale={reduced ? 1.02 : 1}
    >
      <group ref={coreRef} scale={active ? 1.06 : 1}>
        <SymmetricPlus active={active} />
      </group>
      <group ref={cageRef}>
        <SphericalCage />
      </group>
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
        className="absolute inset-[-16px]"
        gl={{ alpha: true }}
        camera={{ position: [0, 0, 4.55], fov: 40 }}
        dpr={[1, 1.5]}
        frameloop={reduced ? "demand" : "always"}
      >
        <ambientLight intensity={1.45} />
        <directionalLight position={[2.2, 2.8, 3.6]} intensity={2.15} />
        <pointLight position={[-2, -1.5, 2.4]} intensity={1.2} color="#ffd7c2" />
        <CreatePlusModel active={active} reduced={reduced} />
      </Canvas>
    </Link>
  );
}
