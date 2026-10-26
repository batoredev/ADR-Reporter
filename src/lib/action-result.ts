/** The outcome of an action the user started: data, or a refusal they should see. */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
