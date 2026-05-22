"use client";

// Authenticated route entry for the shared CycleCalendarDashboard page.

import { AuthGate } from "@/components/auth-gate";
import { CycleCalendarDashboard } from "@/components/cycle-calendar-dashboard";

export default function CyclePage() {
  return (
    <AuthGate>
      <CycleCalendarDashboard />
    </AuthGate>
  );
}
