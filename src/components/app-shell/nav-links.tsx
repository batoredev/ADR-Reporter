"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  FilePlus2,
  Files,
  LayoutDashboard,
  Send,
  Siren,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import type { NavIcon, NavItem } from "@/lib/domain/access";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  "new-report": FilePlus2,
  "my-reports": Files,
  review: ClipboardCheck,
  escalations: Siren,
  submissions: Send,
  profile: UserRound,
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface NavLinksProps {
  items: NavItem[];
  onNavigate?: () => void;
}

export function NavLinks({ items, onNavigate }: NavLinksProps) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active && "bg-sidebar-accent font-semibold text-primary",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
              {item.href === "/dashboard" ? "Overview" : item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
