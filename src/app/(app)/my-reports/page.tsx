import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { MyReportsView } from "./my-reports-view";

export const metadata: Metadata = { title: "My reports" };

export default function MyReportsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MyReportsView />
    </Suspense>
  );
}
