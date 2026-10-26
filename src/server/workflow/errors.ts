import "server-only";
import type { ActionResult } from "@/lib/action-result";

/** A refusal the user should see, such as a missing permission or a stale screen. */
export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID" = "INVALID",
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export type { ActionResult };

/** Runs an action body, turning WorkflowErrors into a result the form can show. */
export async function asResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error: error.message };
    throw error;
  }
}
