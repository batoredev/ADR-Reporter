import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NavLinks } from "@/components/app-shell/nav-links";
import { UserMenu } from "@/components/app-shell/user-menu";
import { FictionalDataBanner } from "@/components/fictional-data-banner";
import { describeAccess, navigationFor } from "@/lib/domain/access";
import { requireUser } from "@/server/auth/current-user";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const nav = navigationFor(user);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <FictionalDataBanner />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r bg-sidebar lg:block">
          <div className="sticky top-0 flex flex-col gap-4 px-3 py-4">
            <div className="px-2.5">
              <p className="text-sm font-semibold">ADR Reporter</p>
              <p className="text-xs text-muted-foreground">Institutional pharmacovigilance</p>
            </div>
            <nav aria-label="Main">
              <NavLinks items={nav} />
            </nav>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b bg-background px-4 sm:px-6">
            <MobileNav items={nav} institutionName={user.institutionName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.institutionName}</p>
              {user.department ? <p className="truncate text-xs text-muted-foreground">{user.department}</p> : null}
            </div>
            <UserMenu name={user.name} email={user.email} access={describeAccess(user)} />
          </header>
          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
