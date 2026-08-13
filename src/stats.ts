/**
 * The statistics. Kept in one file with no I/O so it can be tested against
 * published worked examples — every function here has a test with a number
 * somebody else computed.
 *
 * The question this module answers: given N verifiers that each voted on M
 * findings, how many *independent* checks did you actually buy?
 */

// --- agreement ---------------------------------------------------------------

/**
 * Fleiss' kappa — chance-corrected agreement among a fixed number of raters
 * over M subjects and k categories.
 *
 * Input is a count matrix: `counts[i][j]` = how many raters assigned subject i
 * to category j. Every row must sum to the same n (the number of raters).
 *
 * Returns kappa plus the two components, because the components are what make
 * a surprising kappa interpretable: high observed agreement with high expected
 * agreement means "everyone says yes to everything", not "everyone is right".
 */
export function fleissKappa(counts: number[][]): {
  kappa: number;
  observedAgreement: number;
  expectedAgreement: number;
  raters: number;
  subjects: number;
} {
  const N = counts.length;
  if (N === 0) throw new Error("fleissKappa: no subjects");
  const k = counts[0]!.length;
  const n = counts[0]!.reduce((a, b) => a + b, 0);
  if (n < 2) throw new Error("fleissKappa: needs at least 2 raters per subject");

  for (const [i, row] of counts.entries()) {
    if (row.length !== k) throw new Error(`fleissKappa: subject ${i} has ${row.length} categories, expected ${k}`);
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum !== n) {
      throw new Error(
        `fleissKappa: subject ${i} has ${sum} ratings, expected ${n} — Fleiss requires a fixed number of raters per subject`,
      );
    }
  }

  // P_i: proportion of agreeing rater pairs on subject i.
  let sumPi = 0;
  for (const row of counts) {
    let sq = 0;
    for (const c of row) sq += c * c;
    sumPi += (sq - n) / (n * (n - 1));
  }
  const observedAgreement = sumPi / N;

  // p_j: overall proportion of ratings in category j.
  const pj: number[] = [];
  for (let j = 0; j < k; j++) {
    let total = 0;
    for (const row of counts) total += row[j]!;
    pj.push(total / (N * n));
  }
  const expectedAgreement = pj.reduce((a, p) => a + p * p, 0);

  const denom = 1 - expectedAgreement;
  // When chance agreement is total, kappa is undefined. Report 0 rather than
  // NaN, and let the caller see expectedAgreement === 1 and draw the conclusion.
  const kappa = denom === 0 ? 0 : (observedAgreement - expectedAgreement) / denom;

  return { kappa, observedAgreement, expectedAgreement, raters: n, subjects: N };
}

/**
 * Cohen's kappa for two raters over the same M subjects, categorical labels.
 * Unlike Fleiss this is pairwise, which is what you want for "which two of my
 * verifiers are the redundant pair".
 */
export function cohenKappa(a: string[], b: string[]): number {
  if (a.length !== b.length) throw new Error("cohenKappa: rater vectors differ in length");
  const M = a.length;
  if (M === 0) throw new Error("cohenKappa: no subjects");

  const labels = [...new Set([...a, ...b])];
  let observed = 0;
  for (let i = 0; i < M; i++) if (a[i] === b[i]) observed++;
  const po = observed / M;

  let pe = 0;
  for (const l of labels) {
    const pa = a.filter((x) => x === l).length / M;
    const pb = b.filter((x) => x === l).length / M;
    pe += pa * pb;
  }

  return pe === 1 ? 0 : (po - pe) / (1 - pe);
}

/**
 * Phi coefficient (Pearson correlation for two binary vectors). This is the
 * quantity that feeds the design effect below — kappa is chance-corrected
 * agreement, phi is correlation, and it is correlation that inflates variance.
 */
export function phi(a: boolean[], b: boolean[]): number {
  if (a.length !== b.length) throw new Error("phi: vectors differ in length");
  const M = a.length;
  if (M === 0) throw new Error("phi: no observations");

  let n11 = 0;
  let n10 = 0;
  let n01 = 0;
  let n00 = 0;
  for (let i = 0; i < M; i++) {
    if (a[i] && b[i]) n11++;
    else if (a[i] && !b[i]) n10++;
    else if (!a[i] && b[i]) n01++;
    else n00++;
  }

  const denom = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  // A rater with zero variance (voted the same way every time) has no defined
  // correlation with anything. Treat as 0 and let the caller report degeneracy.
  return denom === 0 ? 0 : (n11 * n00 - n10 * n01) / denom;
}

// --- the money metric --------------------------------------------------------

/**
 * Effective number of independent verifiers.
 *
 * This is Kish's design effect, borrowed from survey sampling. If N raters were
 * independent, the variance of their mean vote would be p(1-p)/N. When raters
 * are correlated with average intra-class correlation rho, the variance is
 *
 *     p(1-p)/N * (1 + (N-1) * rho)
 *
 * The bracketed term is the design effect: the factor by which correlation
 * inflates your uncertainty. Dividing N by it gives the number of *independent*
 * raters that would have produced the same precision:
 *
 *     N_eff = N / (1 + (N-1) * rho)
 *
 * rho = 0 gives N_eff = N (fully independent). rho = 1 gives N_eff = 1 (they are
 * one rater wearing three hats). Negative rho is clamped to 0 — verifiers that
 * anti-correlate are not *more* than independent in any useful sense, and
 * reporting N_eff > N would be an artefact of sampling noise rather than a
 * finding.
 */
export function effectiveVerifiers(n: number, rho: number): number {
  if (n <= 1) return Math.max(n, 0);
  const r = Math.min(Math.max(rho, 0), 1);
  return n / (1 + (n - 1) * r);
}

// --- the report --------------------------------------------------------------

export interface Verdict {
  /** What was judged. Verdicts sharing a findingId are the same subject. */
  findingId: string;
  /** Which verifier judged it. */
  verifierId: string;
  /** The judgment. `true` = real / keep / pass. */
  verdict: boolean;
  /** Optional: the lens this verifier was given. Used to spot lens collisions. */
  lens?: string;
  /** Optional: the model that ran it. Used to spot single-family panels. */
  model?: string;
  /** Optional: what this verdict cost, in USD. */
  costUsd?: number;
}

export interface PairCorrelation {
  a: string;
  b: string;
  phi: number;
  cohenKappa: number;
  /** How often they agreed, uncorrected. */
  rawAgreement: number;
  /** Subjects both of them judged. */
  overlap: number;
  sameModel: boolean;
  sameLens: boolean;
}

export interface Report {
  verifiers: string[];
  findings: number;
  /** Findings judged by every verifier — the balanced subset the stats use. */
  completeFindings: number;
  /** Mean pairwise phi across all verifier pairs. */
  meanPhi: number;
  fleiss: ReturnType<typeof fleissKappa> | null;
  effectiveVerifiers: number;
  /** N / N_eff. "You are paying this multiple for the confidence you got." */
  wasteMultiple: number;
  pairs: PairCorrelation[];
  /** Verifiers that voted the same way on everything — no signal at all. */
  degenerate: { verifierId: string; alwaysVoted: boolean }[];
  /** Findings where the panel split. The only ones the votes changed. */
  contested: number;
  /** Verdict cost, when the input carried it. */
  costUsd: number | null;
  /** Estimated cost of the redundant portion. */
  wastedUsd: number | null;
  warnings: string[];
}

/**
 * Build the full correlation report from a flat list of verdicts.
 *
 * Statistics are computed over the *balanced* subset — findings that every
 * verifier judged. An unbalanced panel makes pairwise numbers incomparable
 * (two verifiers agreeing on the 3 findings they both saw is not evidence
 * about the other 97), and Fleiss requires a fixed rater count outright. The
 * count that got dropped is reported rather than silently absorbed.
 */
export function analyse(verdicts: Verdict[]): Report {
  const warnings: string[] = [];
  if (verdicts.length === 0) {
    throw new Error("analyse: no verdicts. Expected JSONL with findingId, verifierId, verdict.");
  }

  const verifiers = [...new Set(verdicts.map((v) => v.verifierId))].sort();
  const findingIds = [...new Set(verdicts.map((v) => v.findingId))];

  // findingId -> verifierId -> verdict
  const grid = new Map<string, Map<string, boolean>>();
  for (const v of verdicts) {
    if (!grid.has(v.findingId)) grid.set(v.findingId, new Map());
    const row = grid.get(v.findingId)!;
    if (row.has(v.verifierId)) {
      warnings.push(
        `duplicate verdict: ${v.verifierId} judged ${v.findingId} more than once — kept the first`,
      );
      continue;
    }
    row.set(v.verifierId, v.verdict);
  }

  const complete = findingIds.filter((f) => grid.get(f)!.size === verifiers.length);
  if (complete.length < findingIds.length) {
    warnings.push(
      `${findingIds.length - complete.length} of ${findingIds.length} findings were not judged by every verifier and are excluded from the statistics`,
    );
  }
  if (complete.length === 0) {
    warnings.push(
      "no finding was judged by every verifier — cannot compute panel-level statistics. Report covers pairwise overlap only.",
    );
  }

  const lensOf = new Map<string, string | undefined>();
  const modelOf = new Map<string, string | undefined>();
  const costByVerifier = new Map<string, number>();
  for (const v of verdicts) {
    if (!lensOf.has(v.verifierId)) lensOf.set(v.verifierId, v.lens);
    if (!modelOf.has(v.verifierId)) modelOf.set(v.verifierId, v.model);
    if (v.costUsd !== undefined) {
      costByVerifier.set(v.verifierId, (costByVerifier.get(v.verifierId) ?? 0) + v.costUsd);
    }
  }

  // --- degenerate verifiers -------------------------------------------------
  const degenerate: Report["degenerate"] = [];
  for (const id of verifiers) {
    const votes = verdicts.filter((v) => v.verifierId === id).map((v) => v.verdict);
    if (votes.length > 1 && new Set(votes).size === 1) {
      degenerate.push({ verifierId: id, alwaysVoted: votes[0]! });
      warnings.push(
        `${id} voted ${votes[0] ? "yes" : "no"} on all ${votes.length} findings — it carries no information, and its correlation with any other verifier is undefined`,
      );
    }
  }

  // --- pairwise --------------------------------------------------------------
  const pairs: PairCorrelation[] = [];
  for (let i = 0; i < verifiers.length; i++) {
    for (let j = i + 1; j < verifiers.length; j++) {
      const a = verifiers[i]!;
      const b = verifiers[j]!;
      const shared = findingIds.filter((f) => grid.get(f)!.has(a) && grid.get(f)!.has(b));
      if (shared.length === 0) continue;
      const va = shared.map((f) => grid.get(f)!.get(a)!);
      const vb = shared.map((f) => grid.get(f)!.get(b)!);
      const agree = va.filter((x, idx) => x === vb[idx]).length / shared.length;
      pairs.push({
        a,
        b,
        phi: phi(va, vb),
        cohenKappa: cohenKappa(va.map(String), vb.map(String)),
        rawAgreement: agree,
        overlap: shared.length,
        sameModel: modelOf.get(a) !== undefined && modelOf.get(a) === modelOf.get(b),
        sameLens: lensOf.get(a) !== undefined && lensOf.get(a) === lensOf.get(b),
      });
    }
  }

  const meanPhi = pairs.length ? pairs.reduce((s, p) => s + p.phi, 0) / pairs.length : 0;

  // --- Fleiss over the balanced subset --------------------------------------
  let fleiss: Report["fleiss"] = null;
  if (complete.length > 0 && verifiers.length >= 2) {
    const counts = complete.map((f) => {
      const row = grid.get(f)!;
      let yes = 0;
      for (const id of verifiers) if (row.get(id)) yes++;
      return [yes, verifiers.length - yes];
    });
    fleiss = fleissKappa(counts);
  }

  const nEff = effectiveVerifiers(verifiers.length, meanPhi);
  const wasteMultiple = nEff > 0 ? verifiers.length / nEff : verifiers.length;

  const contested = complete.filter((f) => {
    const row = grid.get(f)!;
    const votes = verifiers.map((id) => row.get(id));
    return new Set(votes).size > 1;
  }).length;

  const totalCost = costByVerifier.size ? [...costByVerifier.values()].reduce((a, b) => a + b, 0) : null;
  // The redundant share: what you spent minus what an independent panel of
  // N_eff verifiers would have cost.
  const wastedUsd =
    totalCost !== null && verifiers.length > 0
      ? totalCost * (1 - nEff / verifiers.length)
      : null;

  return {
    verifiers,
    findings: findingIds.length,
    completeFindings: complete.length,
    meanPhi,
    fleiss,
    effectiveVerifiers: nEff,
    wasteMultiple,
    pairs: pairs.sort((x, y) => y.phi - x.phi),
    degenerate,
    contested,
    costUsd: totalCost,
    wastedUsd,
    warnings,
  };
}
