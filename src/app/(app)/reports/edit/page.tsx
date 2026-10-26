import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { EditReportView } from "./edit-view";

export const metadata: Metadata = { title: "Edit report" };

export default function EditReportPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditReportView />
    </Suspense>
  );
}
