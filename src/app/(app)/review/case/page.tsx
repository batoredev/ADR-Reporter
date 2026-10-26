import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { ReviewWorkspaceView } from "./workspace-view";

export const metadata: Metadata = { title: "Review workspace" };

export default function ReviewWorkspacePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReviewWorkspaceView />
    </Suspense>
  );
}
