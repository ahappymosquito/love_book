// Compatibility redirect for the retired love-receipt list; received gifts now live in Timeline.

import { redirect } from "next/navigation";

export default function LegacyLoveReceiptsPage() {
  redirect("/timeline");
}
