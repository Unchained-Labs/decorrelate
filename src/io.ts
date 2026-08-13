/** Reading verdict logs. JSONL, one verdict per line. */
import type { Verdict } from "./stats.js";

/**
 * Parse JSONL verdicts. Tolerant by design: a run log is something you tee out
 * of a real pipeline, so it will have blank lines and the occasional unrelated
 * record. Those are skipped and counted rather than thrown on — but a line that
 * looks like a verdict and is malformed IS an error, because silently dropping
 * it would understate correlation.
 */
export function parseVerdicts(text: string): { verdicts: Verdict[]; skipped: number; errors: string[] } {
  const verdicts: Verdict[] = [];
  const errors: string[] = [];
  let skipped = 0;

  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) return;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      errors.push(`line ${i + 1}: not valid JSON`);
      return;
    }
    if (typeof obj !== "object" || obj === null) {
      skipped++;
      return;
    }

    const o = obj as Record<string, unknown>;
    // Accept a few spellings — these logs are hand-rolled more often than not.
    const findingId = o.findingId ?? o.finding_id ?? o.finding ?? o.subject ?? o.id;
    const verifierId = o.verifierId ?? o.verifier_id ?? o.verifier ?? o.rater ?? o.lens;
    const rawVerdict = o.verdict ?? o.real ?? o.pass ?? o.keep ?? o.vote;

    if (findingId === undefined && verifierId === undefined) {
      skipped++; // an unrelated record in the same log
      return;
    }
    if (findingId === undefined || verifierId === undefined) {
      errors.push(
        `line ${i + 1}: looks like a verdict but is missing ${findingId === undefined ? "findingId" : "verifierId"}`,
      );
      return;
    }
    if (rawVerdict === undefined) {
      errors.push(`line ${i + 1}: no verdict field (verdict | real | pass | keep | vote)`);
      return;
    }

    const verdict =
      typeof rawVerdict === "boolean"
        ? rawVerdict
        : typeof rawVerdict === "string"
          ? ["true", "yes", "real", "pass", "keep", "1"].includes(rawVerdict.toLowerCase())
          : Boolean(rawVerdict);

    verdicts.push({
      findingId: String(findingId),
      verifierId: String(verifierId),
      verdict,
      ...(typeof o.lens === "string" ? { lens: o.lens } : {}),
      ...(typeof o.model === "string" ? { model: o.model } : {}),
      ...(typeof o.costUsd === "number"
        ? { costUsd: o.costUsd }
        : typeof o.cost_usd === "number"
          ? { costUsd: o.cost_usd }
          : {}),
    });
  });

  return { verdicts, skipped, errors };
}
