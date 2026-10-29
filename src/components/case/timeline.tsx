import { AUDIT_ACTION_LABELS } from "@/lib/domain/labels";
import { formatDateTime } from "@/lib/format";

export interface TimelineEntry {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
  details: unknown;
}

function detail(entry: TimelineEntry): string | null {
  const d = entry.details as Record<string, unknown> | null;
  if (!d) return null;
  if (typeof d.versionNo === "number") return `version ${d.versionNo}`;
  if (Array.isArray(d.changed) && d.changed.length)
    return `${d.changed.length} field${d.changed.length === 1 ? "" : "s"} changed`;
  if (typeof d.to === "string") return `to ${d.to}`;
  if (entry.action === "AI_NARRATIVE_USED") return d.edited ? "edited by the reporter first" : "used as drafted";
  if (entry.action === "AI_CHECK_KEPT" && typeof d.finding === "string")
    return `${d.finding}${typeof d.reason === "string" ? ` (reason: ${d.reason})` : ""}`;
  if (entry.action === "AI_FINDING_DECIDED") return `${d.decision}: ${d.finding}${d.reason ? ` (${d.reason})` : ""}`;
  if (entry.action === "GUIDED_STEP_SAVED") return String(d.stepId ?? "");
  const model = typeof d.provider === "string" && typeof d.model === "string" ? `${d.provider} / ${d.model}` : null;
  if (entry.action === "AI_CHECK_RUN" && Array.isArray(d.findings))
    return `${d.findings.length} point${d.findings.length === 1 ? "" : "s"} to check${model ? ` · ${model}` : ""}`;
  return model;
}

/** The case's audit trail, newest first. Entries cannot be edited or deleted. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">No activity recorded.</p>;
  return (
    <ol className="space-y-2.5">
      {entries.map((e) => (
        <li key={e.id} className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
          <span className="mt-1.5 size-2 rounded-full bg-primary/70" aria-hidden />
          <div className="min-w-0">
            <p>
              <span className="font-medium">{AUDIT_ACTION_LABELS[e.action] ?? e.action}</span>
              {detail(e) ? <span className="text-muted-foreground"> · {detail(e)}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {e.actorName ?? "System"} · {formatDateTime(e.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
