import type { Metadata } from "next";
import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Access denied" };

export default async function AccessDeniedPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-xl space-y-4 py-8 text-center">
      <ShieldX className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>
      <p className="text-muted-foreground">
        Your account does not have permission to open that page. Permissions are assigned explicitly by the institution.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
