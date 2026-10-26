import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { ReviewQueueView } from "./queue-view";

export const metadata: Metadata = { title: "Review queue" };

export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReviewQueueView />
    </Suspense>
  );
}
