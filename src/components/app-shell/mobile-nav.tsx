"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "@/lib/domain/access";
import { NavLinks } from "./nav-links";

export function MobileNav({ items, institutionName }: { items: NavItem[]; institutionName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-left text-sm">ADR Reporter</SheetTitle>
          <p className="text-left text-[13px] text-muted-foreground">{institutionName}</p>
        </SheetHeader>
        <nav aria-label="Main" className="px-3">
          <NavLinks items={items} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
