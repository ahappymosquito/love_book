"use client";

// Direct-link creation page reusing the shared three-type chooser and forms inside a readable solid surface.

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AuthGate } from "@/components/auth-gate";
import { CreateFlow } from "@/components/create-flow";
import { TimelineHeader } from "@/components/timeline-header";

export default function CreatePage() {
  return (
    <AuthGate>
      <CreateInner />
    </AuthGate>
  );
}

function CreateInner() {
  const router = useRouter();

  return (
    <div className="viewport-guard min-h-dvh w-full">
      <TimelineHeader back={{ href: "/timeline" }} title="记一笔" />
      <div className="mx-auto w-full max-w-2xl min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+9rem)] pt-6 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="content-surface p-5 sm:p-6"
        >
          <CreateFlow onCreated={(event) => router.replace(`/timeline/${event.id}`)} />
        </motion.div>
      </div>
    </div>
  );
}
