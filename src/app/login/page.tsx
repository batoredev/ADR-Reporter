import type { Metadata } from "next";
import { ClipboardCheck, FileText, Files } from "lucide-react";
import { FictionalDataBanner } from "@/components/fictional-data-banner";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-card">
      <main className="grid min-h-dvh flex-1 lg:grid-cols-2">
        <section className="flex flex-col justify-center bg-sidebar px-6 py-10 sm:px-12 lg:px-16">
          <div className="mb-8 flex items-center gap-3">
            <FileText className="size-10 text-primary" aria-hidden />
            <p className="text-2xl font-semibold tracking-tight">ADR Reporter</p>
          </div>
          <h1 className="max-w-lg text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Better reports.
            <br />
            Clearer review.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
            Adverse drug reaction reporting and institutional verification.
          </p>
          <div className="mt-10 hidden max-w-lg space-y-7 lg:block">
            {[
              {
                Icon: FileText,
                title: "Create a report",
                text: "Enter the details with structured or guided reporting.",
              },
              {
                Icon: ClipboardCheck,
                title: "Review with evidence",
                text: "Keep source documents and verification together.",
              },
              { Icon: Files, title: "Export the official form", text: "Download the filled PvPI form for review." },
            ].map(({ Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full border bg-card/60">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h2 className="font-semibold">{title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-md space-y-7">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Welcome back</h2>
              <p className="mt-2 text-muted-foreground">Sign in to your reporting workspace.</p>
            </div>
            <LoginForm />
            <FictionalDataBanner />
          </div>
        </section>
      </main>
    </div>
  );
}
