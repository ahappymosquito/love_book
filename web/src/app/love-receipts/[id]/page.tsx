"use client";

// Compatibility redirect from a legacy love-receipt detail to its migrated received-gift event.

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { LoadingScreen } from "@/components/loading-screen";
import { api } from "@/lib/api";

export default function LegacyLoveReceiptDetailPage() {
  return <AuthGate><LegacyRedirect /></AuthGate>;
}

function LegacyRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    const receiptId = Number(params.id);
    if (!Number.isFinite(receiptId)) {
      router.replace("/timeline");
      return;
    }
    void api.getLoveReceipt(receiptId)
      .then((receipt) => router.replace(receipt.timeline_event_id ? `/timeline/${receipt.timeline_event_id}` : "/timeline"))
      .catch(() => router.replace("/timeline"));
  }, [params.id, router]);

  return <LoadingScreen />;
}
