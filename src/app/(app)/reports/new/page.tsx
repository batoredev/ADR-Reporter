import type { Metadata } from "next";
import { NewReportView } from "./new-report-view";

export const metadata: Metadata = { title: "New ADR report" };

export default function NewReportPage() {
  return <NewReportView />;
}
