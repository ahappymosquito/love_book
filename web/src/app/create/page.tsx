"use client";

// Direct-link event creation page reusing the same form as the global bottom-sheet create window.

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AuthGate } from "@/components/auth-gate";
import { CreateEventForm } from "@/components/create-event-form";
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
    <div className="min-h-dvh w-full">
      <TimelineHeader back={{ href: "/timeline" }} title="记一笔" />
      <div className="mx-auto max-w-2xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+9rem)] pt-6 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-3xl p-5 sm:p-6"
        >
          <CreateEventForm onCreated={(event) => router.replace(`/timeline/${event.id}`)} />
        </motion.div>
      </div>
    </div>
  );
}
