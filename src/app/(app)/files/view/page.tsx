import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { FileView } from "./file-view";

export const metadata: Metadata = { title: "Document" };

export default function FilePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <FileView />
    </Suspense>
  );
}
