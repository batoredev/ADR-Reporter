/** Connected sources stay together: patient, case, original, rendered page and transcription. */
export interface SplitSource {
  id: string;
  caseId: string;
  patientGroup: string;
  originalSha256: string;
  sourceSha256: string;
  transcriptionHash: string;
  train: boolean;
  evaluate: boolean;
}
export type LearningSplit = "TRAIN" | "VALIDATION" | "TEST";
export function groupedSplits(
  sources: SplitSource[],
  seed: string,
): Map<string, { split: LearningSplit; groupKey: string }> {
  const parent = sources.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const seen = new Map<string, number>();
  sources.forEach((s, i) => {
    for (const key of [
      `case:${s.caseId}`,
      `patient:${s.patientGroup}`,
      `original:${s.originalSha256}`,
      `page:${s.sourceSha256}`,
      ...(s.transcriptionHash ? [`text:${s.transcriptionHash}`] : []),
    ]) {
      const old = seen.get(key);
      if (old !== undefined) parent[root(i)] = root(old);
      else seen.set(key, i);
    }
  });
  const groups = new Map<number, SplitSource[]>();
  sources.forEach((s, i) => {
    const key = root(i);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  });
  if (groups.size < 3) throw new Error("At least three independent patient/source groups are required.");
  // A stable seeded ordering; this is a split assignment, not cryptography.
  const rank = (value: string) => {
    let hash = 2166136261;
    for (const char of seed + value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  const rows = [...groups.values()]
    .map((items) => ({
      items,
      key: items.map((s) => s.id).sort()[0],
      train: items.every((s) => s.train),
      evaluate: items.every((s) => s.evaluate),
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  if (rows.some((g) => !g.train && !g.evaluate))
    throw new Error("Connected sources have incompatible document-use permissions.");
  const result = new Map<string, { split: LearningSplit; groupKey: string }>();
  const count = { TRAIN: 0, VALIDATION: 0, TEST: 0 };
  const assign = (row: (typeof rows)[number], split: LearningSplit) => {
    count[split]++;
    row.items.forEach((s) => result.set(s.id, { split, groupKey: row.key }));
  };
  const flexible: typeof rows = [];
  for (const row of rows) {
    if (!row.train) assign(row, "TEST");
    else if (!row.evaluate) assign(row, "TRAIN");
    else flexible.push(row);
  }
  for (const split of ["TEST", "TRAIN", "VALIDATION"] as const) {
    if (!count[split]) {
      const row = flexible.shift();
      if (!row) throw new Error("Permissions must allow at least one independent group in every split.");
      assign(row, split);
    }
  }
  const target = { TRAIN: 0.7, VALIDATION: 0.15, TEST: 0.15 };
  for (const row of flexible) {
    const split = (["TRAIN", "VALIDATION", "TEST"] as const).reduce(
      (best, s) => (count[s] / target[s] < count[best] / target[best] ? s : best),
      "TRAIN",
    );
    assign(row, split);
  }
  return result;
}
