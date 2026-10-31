"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, FileText } from "lucide-react";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NavLinks } from "@/components/app-shell/nav-links";
import { UserMenu } from "@/components/app-shell/user-menu";
import { SessionGate } from "@/components/data/session";
import { FictionalDataBanner } from "@/components/fictional-data-banner";
import { describeAccess, navigationFor } from "@/lib/domain/access";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = pathname.startsWith("/reports/")
    ? "Reports"
    : pathname.startsWith("/review")
      ? "Review"
      : pathname === "/my-reports"
        ? "My reports"
        : pathname === "/escalations"
          ? "Urgent escalations"
          : pathname === "/submissions"
            ? "External submissions"
            : pathname === "/profile"
              ? "Profile"
              : pathname === "/files/view"
                ? "Documents"
                : "Overview";
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <SessionGate>
        {(user) => {
          const nav = navigationFor(user);
          return (
            <div className="flex min-w-0 flex-1">
              <aside className="hidden w-56 shrink-0 border-r bg-sidebar lg:block">
                <div className="sticky top-0 flex h-dvh flex-col gap-8 px-4 py-7">
                  <Link href="/dashboard" className="flex items-center gap-3 px-2">
                    <FileText className="size-8 text-primary" aria-hidden />
                    <span>
                      <span className="block text-lg font-semibold tracking-tight">ADR Reporter</span>
                      <span
                        className="block max-w-36 truncate text-xs text-muted-foreground"
                        title={user.institutionName}
                      >
                        {user.institutionName}
                      </span>
                    </span>
                  </Link>
                  <nav aria-label="Main">
                    <NavLinks items={nav.filter((item) => item.href !== "/profile")} />
                  </nav>
                  <div className="mt-auto space-y-4">
                    <NavLinks items={nav.filter((item) => item.href === "/profile")} />
                    <div className="border-t px-2 pt-4">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{describeAccess(user)}</p>
                    </div>
                  </div>
                </div>
              </aside>
              <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex min-h-16 min-w-0 items-center gap-3 border-b bg-card px-4 sm:px-7">
                  <MobileNav items={nav} institutionName={user.institutionName} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm text-muted-foreground">
                      <span className="hidden sm:inline">Workspace</span>
                      <ChevronRight className="hidden size-3.5 sm:block" aria-hidden />
                      <span className="truncate text-foreground">{section}</span>
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <FictionalDataBanner compact />
                  </div>
                  <UserMenu name={user.name} email={user.email} access={describeAccess(user)} />
                </header>
                <div className="sm:hidden">
                  <FictionalDataBanner compact />
                </div>
                <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-7 sm:py-8 lg:px-9">
                  {children}
                </main>
              </div>
            </div>
          );
        }}
      </SessionGate>
    </div>
  );
}
