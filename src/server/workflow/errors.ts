import "server-only";

/** A refusal the user should see, such as a missing permission or a stale screen. */
export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID" = "INVALID",
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Runs a server-action body, turning WorkflowErrors into a result the form can show. */
export async function asResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error: error.message };
    throw error;
  }
}
