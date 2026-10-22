// Role-based access rules shared by navigation, page guards and tests.
// Authority comes only from explicitly assigned roles and flags.
import type { Role } from "@/generated/prisma/enums";

export interface AccessSubject {
  roles: readonly Role[];
  isUrgentContact: boolean;
  canReassign: boolean;
}

export type NavIcon = "dashboard" | "new-report" | "my-reports" | "review" | "escalations" | "submissions" | "profile";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export const hasRole = (user: AccessSubject, role: Role) => user.roles.includes(role);

export const canReport = (user: AccessSubject) => hasRole(user, "REPORTER");
export const canReview = (user: AccessSubject) => hasRole(user, "REVIEWER");
export const canCoordinate = (user: AccessSubject) => hasRole(user, "COORDINATOR");
export const canHandleEscalations = (user: AccessSubject) => user.isUrgentContact;
/** Reviewers see the submissions list read-only; coordinators can record on it. */
export const canViewSubmissions = (user: AccessSubject) => canReview(user) || canCoordinate(user);

export function navigationFor(user: AccessSubject): NavItem[] {
  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }];
  if (canReport(user)) {
    items.push(
      { href: "/reports/new", label: "New ADR report", icon: "new-report" },
      { href: "/my-reports", label: "My reports", icon: "my-reports" },
    );
  }
  if (canReview(user)) {
    items.push({ href: "/review", label: "Review queue", icon: "review" });
  }
  if (canHandleEscalations(user)) {
    items.push({ href: "/escalations", label: "Urgent escalations", icon: "escalations" });
  }
  if (canViewSubmissions(user)) {
    items.push({ href: "/submissions", label: "External submissions", icon: "submissions" });
  }
  items.push({ href: "/profile", label: "Profile", icon: "profile" });
  return items;
}

/** Short description of a user's authority for the top bar, e.g. "Reviewer · Urgent contact". */
export function describeAccess(user: AccessSubject): string {
  const parts: string[] = [];
  if (canReport(user)) parts.push("Reporter");
  if (canReview(user)) parts.push("Reviewer");
  if (canCoordinate(user)) parts.push("Coordinator");
  if (user.canReassign) parts.push("Queue lead");
  if (user.isUrgentContact) parts.push("Urgent contact");
  return parts.join(" · ");
}
