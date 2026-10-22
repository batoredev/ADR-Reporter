import type { SeriousAnswer, SeriousnessCriterion } from "@/generated/prisma/enums";

/**
 * A case is "potentially serious" when the reporter answered "Serious: Yes"
 * or ticked any seriousness criterion. The flag comes only from what the
 * reporter recorded; nothing is inferred from free text.
 */
export function isPotentiallySerious(
  answer: SeriousAnswer | null | undefined,
  criteria: readonly SeriousnessCriterion[] | null | undefined,
): boolean {
  return answer === "YES" || (criteria?.length ?? 0) > 0;
}
