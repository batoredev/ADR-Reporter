import type { Metadata } from "next";
import { EscalationsView } from "./escalations-view";

export const metadata: Metadata = { title: "Urgent escalations" };

export default function Page() {
  return <EscalationsView />;
}
