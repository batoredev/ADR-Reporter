import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { CasePageView } from "./case-view";

export const metadata: Metadata = { title: "Case" };

export default function CasePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CasePageView />
    </Suspense>
  );
}
