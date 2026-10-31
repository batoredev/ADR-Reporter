import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/data/page-state";
import { ChatReportView } from "./chat-view";

export const metadata: Metadata = { title: "Report assistant" };
export default function ChatReportPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ChatReportView />
    </Suspense>
  );
}
