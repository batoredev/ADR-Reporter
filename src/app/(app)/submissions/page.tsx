import type { Metadata } from "next";
import { SubmissionsView } from "./submissions-view";

export const metadata: Metadata = { title: "External submissions" };

export default function Page() {
  return <SubmissionsView />;
}
