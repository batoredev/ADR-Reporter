// Fictional demonstration accounts, shared by the seed script and the login page.
import type { Role } from "@/generated/prisma/enums";

export const DEMO_PASSWORD = "AdrDemo#2026";

export interface DemoAccount {
  email: string;
  name: string;
  roles: Role[];
  designation: string;
  occupation: string;
  isUrgentContact?: boolean;
  canReassign?: boolean;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "pharmacist@demo.test",
    name: "Demo Clinical Pharmacist",
    roles: ["REPORTER"],
    designation: "Clinical Pharmacist",
    occupation: "Clinical Pharmacist",
  },
  {
    email: "physician@demo.test",
    name: "Demo Resident Physician",
    roles: ["REPORTER"],
    designation: "Resident Physician, Internal Medicine",
    occupation: "Physician",
  },
  {
    email: "hod@demo.test",
    name: "Demo HoD, Pharmacy Practice",
    roles: ["REVIEWER"],
    designation: "Head of Department, Pharmacy Practice",
    occupation: "Pharmacist",
    isUrgentContact: true,
    canReassign: true,
  },
  {
    email: "chief.pharmacist@demo.test",
    name: "Demo Chief Pharmacist",
    roles: ["REVIEWER"],
    designation: "Chief Pharmacist",
    occupation: "Pharmacist",
    isUrgentContact: true,
  },
  {
    email: "amc.coordinator@demo.test",
    name: "Demo AMC Coordinator",
    roles: ["REVIEWER", "COORDINATOR"],
    designation: "AMC Coordinator",
    occupation: "Pharmacist",
    isUrgentContact: true,
  },
  {
    email: "pharmacologist@demo.test",
    name: "Demo Clinical Pharmacologist",
    roles: ["REVIEWER"],
    designation: "Clinical Pharmacologist",
    occupation: "Physician",
  },
  {
    email: "senior.pharmacist@demo.test",
    name: "Demo Senior Clinical Pharmacist",
    roles: ["REVIEWER"],
    designation: "Senior Clinical Pharmacist",
    occupation: "Pharmacist",
  },
  {
    email: "consultant@demo.test",
    name: "Demo Consultant Physician",
    roles: ["REVIEWER"],
    designation: "Consultant Physician, Internal Medicine",
    occupation: "Physician",
  },
  {
    email: "pv.officer@demo.test",
    name: "Demo Pharmacovigilance Officer",
    roles: ["REVIEWER", "COORDINATOR"],
    designation: "Pharmacovigilance Officer",
    occupation: "Pharmacist",
  },
];

/** The login page lists demo accounts unless DEMO_MODE is explicitly "false". */
export const isDemoMode = () => process.env.DEMO_MODE !== "false";
