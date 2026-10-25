"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import {
  createDraft,
  escalateCase,
  saveDraft,
  submitCase,
  updateProfile,
  type SaveResult,
} from "@/server/workflow/cases";
import { asResult, type ActionResult } from "@/server/workflow/errors";

export async function createDraftAction(): Promise<void> {
  const user = await requireUser();
  const { id } = await createDraft(user);
  redirect(`/reports/${id}/edit`);
}

export async function saveDraftAction(
  caseId: string,
  lockVersion: number,
  values: unknown,
): Promise<ActionResult<SaveResult>> {
  const user = await requireUser();
  return asResult(() => saveDraft(user, caseId, lockVersion, values));
}

export interface SubmitState {
  error?: string;
}

export async function submitAction(caseId: string, _previous: SubmitState, formData: FormData): Promise<SubmitState> {
  const user = await requireUser();
  const result = await asResult(() =>
    submitCase(user, caseId, {
      lockVersion: Number(formData.get("lockVersion")),
      declaration: formData.get("declaration") === "on",
      responseNote: String(formData.get("responseNote") ?? ""),
    }),
  );
  if (!result.ok) return { error: result.error };
  redirect(`/reports/${caseId}?submitted=${result.data.versionNo}`);
}

export async function escalateAction(caseId: string, note: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  return asResult(() => escalateCase(user, caseId, note));
}

export interface ProfileState {
  error?: string;
  saved?: boolean;
}

export async function updateProfileAction(_previous: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const field = (k: string) => String(formData.get(k) ?? "");
  const result = await asResult(() =>
    updateProfile(user, {
      name: field("name"),
      occupation: field("occupation"),
      address: field("address"),
      pin: field("pin"),
      phone: field("phone"),
    }),
  );
  return result.ok ? { saved: true } : { error: result.error };
}
