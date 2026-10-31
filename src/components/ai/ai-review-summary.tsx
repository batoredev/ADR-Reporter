import { aiHistory } from "@/lib/domain/ai-history";

/** Saved reporter decisions are also visible to reviewers. */
export function AiReviewSummary({
  events,
}: {
  events: { id: string; action: string; details: unknown; createdAt: Date | string }[];
}) {
  const { check } = aiHistory(events);
  const narrative = [...events]
    .filter((e) => e.action === "AI_NARRATIVE_USED")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!check && !narrative) return null;
  const used = narrative?.details as
    { provider?: string; model?: string; edited?: boolean; original?: string; finalText?: string } | undefined;
  const unresolved =
    check?.findings.filter((_, i) => !check.decisions[i] || check.decisions[i].decision === "UNSURE").length ?? 0;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Report checks and decisions">
      <h2 className="font-semibold">Report checks and decisions</h2>
      {used ? (
        <details className="text-sm">
          <summary>
            Suggested description used
            {used.edited ? ", edited by the reporter" : ""}
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Verified and saved by the reporter. Later manual changes may differ from this record.
          </p>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <div>
              <h3 className="font-medium">Original suggestion</h3>
              <p className="whitespace-pre-wrap">{used.original}</p>
            </div>
            <div>
              <h3 className="font-medium">Saved text</h3>
              <p className="whitespace-pre-wrap">{used.finalText}</p>
            </div>
          </div>
        </details>
      ) : null}
      {check ? (
        <div className="space-y-2 text-sm">
          <p>
            {unresolved} unresolved finding{unresolved === 1 ? "" : "s"}. These are suggestions for human review.
          </p>
          <ul className="space-y-2">
            {check.findings.map((f, i) => {
              const d = check.decisions[i];
              return (
                <li key={i} className="rounded border p-2">
                  <p>{f.message}</p>
                  {f.evidence ? <p className="text-xs text-muted-foreground">Evidence: {f.evidence}</p> : null}
                  <p className="text-xs font-medium">
                    {!d
                      ? "Unresolved"
                      : d.decision === "UNSURE"
                        ? "Reporter unsure"
                        : d.decision === "CORRECTED"
                          ? "Reporter marked corrected; verify the current fields"
                          : "Kept with explanation"}
                    {d?.reason ? `: ${d.reason}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            The check applies to the saved report at the time of checking.
          </p>
        </div>
      ) : null}
    </section>
  );
}
