import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { SubmitReportView } from "./submit-view";

export const metadata: Metadata = { title: "Review and submit" };

export default function SubmitPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SubmitReportView />
    </Suspense>
  );
}
