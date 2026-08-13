import { describe, expect, it } from "vitest";

import { parseVerdicts } from "../src/io.js";
import { DOMAINS, planLenses } from "../src/lenses.js";
import { analyse, cohenKappa, effectiveVerifiers, fleissKappa, phi } from "../src/stats.js";
import type { Verdict } from "../src/stats.js";

describe("fleissKappa — against the published worked example", () => {
  // The canonical Fleiss example: 10 subjects, 14 raters, 5 categories.
  // Published values: P̄ = 0.378, P̄e = 0.213, κ = 0.210.
  const CANONICAL = [
    [0, 0, 0, 0, 14],
    [0, 2, 6, 4, 2],
    [0, 0, 3, 5, 6],
    [0, 3, 9, 2, 0],
    [2, 2, 8, 1, 1],
    [7, 7, 0, 0, 0],
    [3, 2, 6, 3, 0],
    [2, 5, 3, 2, 2],
    [6, 5, 2, 1, 0],
    [0, 2, 2, 3, 7],
  ];

  it("reproduces kappa = 0.210", () => {
    const r = fleissKappa(CANONICAL);
    expect(r.kappa).toBeCloseTo(0.21, 2);
  });

  it("reproduces the observed and expected agreement components", () => {
    const r = fleissKappa(CANONICAL);
    expect(r.observedAgreement).toBeCloseTo(0.378, 3);
    expect(r.expectedAgreement).toBeCloseTo(0.213, 3);
  });

  it("reports the panel shape it measured", () => {
    const r = fleissKappa(CANONICAL);
    expect(r.raters).toBe(14);
    expect(r.subjects).toBe(10);
  });

  it("returns kappa = 1 for total agreement", () => {
    // Every rater picks the same category, but not the same one every subject —
    // otherwise expected agreement is 1 and kappa is undefined.
    const total = [
      [3, 0],
      [0, 3],
      [3, 0],
      [0, 3],
    ];
    expect(fleissKappa(total).kappa).toBeCloseTo(1, 10);
  });

  it("returns kappa = 0 when agreement is exactly chance", () => {
    // Two raters, two categories, every combination once: observed agreement
    // equals expected agreement.
    const chance = [
      [2, 0],
      [1, 1],
      [1, 1],
      [0, 2],
    ];
    expect(fleissKappa(chance).kappa).toBeCloseTo(0, 10);
  });

  it("reports 0 rather than NaN when chance agreement is total", () => {
    const degenerate = [
      [3, 0],
      [3, 0],
    ];
    const r = fleissKappa(degenerate);
    expect(r.expectedAgreement).toBe(1);
    expect(r.kappa).toBe(0);
    expect(Number.isNaN(r.kappa)).toBe(false);
  });

  it("rejects an unbalanced panel instead of guessing", () => {
    expect(() =>
      fleissKappa([
        [3, 0],
        [2, 0],
      ]),
    ).toThrow(/fixed number of raters/);
  });

  it("rejects a single rater", () => {
    expect(() => fleissKappa([[1, 0]])).toThrow(/at least 2 raters/);
  });
});

describe("cohenKappa", () => {
  it("is 1 for perfect agreement with real variance", () => {
    expect(cohenKappa(["a", "b", "a", "b"], ["a", "b", "a", "b"])).toBeCloseTo(1, 10);
  });

  it("is 0 at chance", () => {
    // Marginals 50/50 for both raters, agreement 50% -> po = pe = 0.5.
    expect(cohenKappa(["a", "a", "b", "b"], ["a", "b", "a", "b"])).toBeCloseTo(0, 10);
  });

  it("goes negative for systematic disagreement", () => {
    expect(cohenKappa(["a", "b", "a", "b"], ["b", "a", "b", "a"])).toBeLessThan(0);
  });

  it("matches a hand-computed 2x2 case", () => {
    // n11=20 n10=5 n01=10 n00=15, M=50
    // po = 35/50 = 0.7
    // pa(yes)=25/50=0.5, pb(yes)=30/50=0.6
    // pe = 0.5*0.6 + 0.5*0.4 = 0.30 + 0.20 = 0.5
    // kappa = (0.7-0.5)/(1-0.5) = 0.4
    const a = [...Array(20).fill("y"), ...Array(5).fill("y"), ...Array(10).fill("n"), ...Array(15).fill("n")];
    const b = [...Array(20).fill("y"), ...Array(5).fill("n"), ...Array(10).fill("y"), ...Array(15).fill("n")];
    expect(cohenKappa(a, b)).toBeCloseTo(0.4, 10);
  });

  it("rejects mismatched lengths", () => {
    expect(() => cohenKappa(["a"], ["a", "b"])).toThrow(/differ in length/);
  });
});

describe("phi", () => {
  it("is 1 for identical binary vectors with variance", () => {
    expect(phi([true, false, true, false], [true, false, true, false])).toBeCloseTo(1, 10);
  });

  it("is -1 for exactly inverted vectors", () => {
    expect(phi([true, false, true, false], [false, true, false, true])).toBeCloseTo(-1, 10);
  });

  it("is 0 for independent vectors", () => {
    expect(phi([true, true, false, false], [true, false, true, false])).toBeCloseTo(0, 10);
  });

  it("is 0 when one vector has no variance", () => {
    // Undefined mathematically; we report 0 and flag degeneracy elsewhere.
    expect(phi([true, true, true], [true, false, true])).toBe(0);
  });

  it("matches a hand-computed 2x2 case", () => {
    // n11=2 n10=1 n01=1 n00=2
    // phi = (2*2 - 1*1) / sqrt(3*3*3*3) = 3/9 = 0.3333
    const a = [true, true, true, false, false, false];
    const b = [true, true, false, true, false, false];
    expect(phi(a, b)).toBeCloseTo(1 / 3, 10);
  });
});

describe("effectiveVerifiers — Kish's design effect", () => {
  it("N_eff = N when verifiers are independent", () => {
    expect(effectiveVerifiers(3, 0)).toBeCloseTo(3, 10);
    expect(effectiveVerifiers(5, 0)).toBeCloseTo(5, 10);
  });

  it("N_eff = 1 when verifiers are perfectly correlated", () => {
    expect(effectiveVerifiers(3, 1)).toBeCloseTo(1, 10);
    expect(effectiveVerifiers(10, 1)).toBeCloseTo(1, 10);
  });

  it("reproduces the reference case: 3 verifiers at rho = 0.75 give N_eff = 1.2", () => {
    // 3 / (1 + 2*0.75) = 3 / 2.5 = 1.2
    expect(effectiveVerifiers(3, 0.75)).toBeCloseTo(1.2, 10);
  });

  it("clamps negative correlation to 0 rather than reporting N_eff > N", () => {
    // Anti-correlated verifiers are not more than independent in any useful
    // sense; reporting 4 effective verifiers out of 3 would be an artefact.
    expect(effectiveVerifiers(3, -0.5)).toBeCloseTo(3, 10);
  });

  it("is monotonically decreasing in rho", () => {
    const points = [0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => effectiveVerifiers(4, r));
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!).toBeLessThanOrEqual(points[i - 1]!);
    }
  });

  it("handles degenerate panel sizes", () => {
    expect(effectiveVerifiers(1, 0.5)).toBe(1);
    expect(effectiveVerifiers(0, 0.5)).toBe(0);
  });
});

// --- end-to-end -------------------------------------------------------------

/** Build a verdict set where every verifier votes identically. */
function identicalPanel(n: number, m: number): Verdict[] {
  const out: Verdict[] = [];
  for (let f = 0; f < m; f++) {
    const truth = f % 3 !== 0; // some variance, so phi is defined
    for (let v = 0; v < n; v++) {
      out.push({
        findingId: `f${f}`,
        verifierId: `v${v}`,
        verdict: truth,
        model: "claude-sonnet-5",
        costUsd: 0.01,
      });
    }
  }
  return out;
}

/** Build a verdict set where verifiers are independent coin flips (seeded). */
function independentPanel(n: number, m: number): Verdict[] {
  const out: Verdict[] = [];
  // A fixed pattern rather than a random one, so the test is deterministic.
  for (let f = 0; f < m; f++) {
    for (let v = 0; v < n; v++) {
      out.push({
        findingId: `f${f}`,
        verifierId: `v${v}`,
        // Different period per verifier -> near-zero pairwise correlation.
        verdict: (f + v * (v + 3)) % (v + 2) === 0,
        model: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"][v % 3],
      });
    }
  }
  return out;
}

describe("analyse", () => {
  it("reports N_eff ≈ 1 for a panel that votes identically", () => {
    const r = analyse(identicalPanel(3, 30));
    expect(r.meanPhi).toBeCloseTo(1, 6);
    expect(r.effectiveVerifiers).toBeCloseTo(1, 4);
    expect(r.wasteMultiple).toBeCloseTo(3, 4);
    expect(r.contested).toBe(0);
  });

  it("reports N_eff close to N for an uncorrelated panel", () => {
    const r = analyse(independentPanel(3, 60));
    expect(Math.abs(r.meanPhi)).toBeLessThan(0.35);
    expect(r.effectiveVerifiers).toBeGreaterThan(1.6);
  });

  it("prices the redundant share when costs are present", () => {
    const r = analyse(identicalPanel(3, 20));
    expect(r.costUsd).toBeCloseTo(0.6, 6); // 3 * 20 * 0.01
    // N_eff = 1 of 3 -> two thirds of the spend bought nothing.
    expect(r.wastedUsd!).toBeCloseTo(0.4, 2);
  });

  it("leaves cost null when the log carries none", () => {
    const r = analyse(independentPanel(2, 10));
    expect(r.costUsd).toBeNull();
    expect(r.wastedUsd).toBeNull();
  });

  it("flags a verifier that voted the same way on everything", () => {
    const v: Verdict[] = [];
    for (let f = 0; f < 10; f++) {
      v.push({ findingId: `f${f}`, verifierId: "yes-man", verdict: true });
      v.push({ findingId: `f${f}`, verifierId: "real", verdict: f % 2 === 0 });
    }
    const r = analyse(v);
    expect(r.degenerate).toHaveLength(1);
    expect(r.degenerate[0]!.verifierId).toBe("yes-man");
    expect(r.warnings.join(" ")).toMatch(/carries no information/);
  });

  it("excludes unbalanced findings from the statistics and says so", () => {
    const v: Verdict[] = [
      { findingId: "a", verifierId: "v1", verdict: true },
      { findingId: "a", verifierId: "v2", verdict: true },
      { findingId: "b", verifierId: "v1", verdict: false },
      // v2 never judged b
    ];
    const r = analyse(v);
    expect(r.findings).toBe(2);
    expect(r.completeFindings).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/not judged by every verifier/);
  });

  it("keeps the first of a duplicated verdict and warns", () => {
    const v: Verdict[] = [
      { findingId: "a", verifierId: "v1", verdict: true },
      { findingId: "a", verifierId: "v1", verdict: false },
      { findingId: "a", verifierId: "v2", verdict: true },
    ];
    const r = analyse(v);
    expect(r.warnings.join(" ")).toMatch(/duplicate verdict/);
  });

  it("marks same-model and same-lens pairs", () => {
    const v: Verdict[] = [];
    for (let f = 0; f < 8; f++) {
      v.push({ findingId: `f${f}`, verifierId: "a", verdict: f % 2 === 0, model: "claude-sonnet-5", lens: "authz" });
      v.push({ findingId: `f${f}`, verifierId: "b", verdict: f % 3 === 0, model: "claude-sonnet-5", lens: "authz" });
      v.push({ findingId: `f${f}`, verifierId: "c", verdict: f % 4 === 0, model: "claude-opus-5", lens: "input" });
    }
    const r = analyse(v);
    const ab = r.pairs.find((p) => p.a === "a" && p.b === "b")!;
    const ac = r.pairs.find((p) => p.a === "a" && p.b === "c")!;
    expect(ab.sameModel).toBe(true);
    expect(ab.sameLens).toBe(true);
    expect(ac.sameModel).toBe(false);
    expect(ac.sameLens).toBe(false);
  });

  it("sorts pairs by correlation, worst first", () => {
    const r = analyse(independentPanel(4, 40));
    for (let i = 1; i < r.pairs.length; i++) {
      expect(r.pairs[i]!.phi).toBeLessThanOrEqual(r.pairs[i - 1]!.phi);
    }
  });

  it("throws on an empty verdict set rather than reporting zeros", () => {
    expect(() => analyse([])).toThrow(/no verdicts/);
  });

  it("counts contested findings — the only ones the votes changed", () => {
    const v: Verdict[] = [
      { findingId: "unanimous", verifierId: "a", verdict: true },
      { findingId: "unanimous", verifierId: "b", verdict: true },
      { findingId: "split", verifierId: "a", verdict: true },
      { findingId: "split", verifierId: "b", verdict: false },
    ];
    expect(analyse(v).contested).toBe(1);
  });
});

// --- io ---------------------------------------------------------------------

describe("parseVerdicts", () => {
  it("reads canonical JSONL", () => {
    const { verdicts, errors } = parseVerdicts(
      [
        '{"findingId":"f1","verifierId":"authz","verdict":true}',
        '{"findingId":"f1","verifierId":"input","verdict":false}',
      ].join("\n"),
    );
    expect(verdicts).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("accepts snake_case and alternate field names", () => {
    const { verdicts } = parseVerdicts(
      '{"finding_id":"f1","verifier":"lens-a","real":"yes","cost_usd":0.02}',
    );
    expect(verdicts[0]).toMatchObject({ findingId: "f1", verifierId: "lens-a", verdict: true, costUsd: 0.02 });
  });

  it("coerces string verdicts", () => {
    const rows = ["true", "yes", "real", "pass", "keep", "1"].map(
      (v, i) => `{"findingId":"f${i}","verifierId":"a","verdict":"${v}"}`,
    );
    const { verdicts } = parseVerdicts(rows.join("\n"));
    expect(verdicts.every((v) => v.verdict)).toBe(true);
    const no = parseVerdicts('{"findingId":"f","verifierId":"a","verdict":"no"}');
    expect(no.verdicts[0]!.verdict).toBe(false);
  });

  it("skips blanks and comments", () => {
    const { verdicts, errors } = parseVerdicts(
      ['# a comment', '', '{"findingId":"f","verifierId":"a","verdict":true}', '  '].join("\n"),
    );
    expect(verdicts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("skips unrelated records without erroring", () => {
    const { verdicts, skipped } = parseVerdicts('{"event":"run_started","at":"2026-08-13"}');
    expect(verdicts).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("errors on a verdict-shaped line that is missing a field", () => {
    const { errors } = parseVerdicts('{"findingId":"f1","verdict":true}');
    expect(errors[0]).toMatch(/missing verifierId/);
  });

  it("errors on invalid JSON rather than skipping it", () => {
    const { errors } = parseVerdicts("{not json");
    expect(errors[0]).toMatch(/not valid JSON/);
  });
});

// --- lenses -----------------------------------------------------------------

describe("planLenses", () => {
  it("returns distinct lens keys for every domain", () => {
    for (const d of DOMAINS) {
      const plan = planLenses(d, 3);
      const keys = plan.lenses.map((l) => l.key);
      expect(new Set(keys).size, d).toBe(keys.length);
    }
  });

  it("routes lenses across model families by default", () => {
    const plan = planLenses("security", 3);
    expect(new Set(plan.lenses.map((l) => l.model)).size).toBe(3);
  });

  it("warns when every lens lands on one family", () => {
    const plan = planLenses("security", 3, { crossFamily: false });
    expect(plan.notes.join(" ")).toMatch(/same model family/);
  });

  it("refuses to pad beyond the bank rather than duplicating a question", () => {
    const plan = planLenses("performance", 9);
    expect(plan.lenses.length).toBeLessThanOrEqual(3);
    expect(plan.notes.join(" ")).toMatch(/genuinely independent/);
  });

  it("surfaces the lenses that a deterministic oracle should replace", () => {
    const plan = planLenses("migration", 3);
    expect(plan.oracles.length).toBeGreaterThan(0);
    expect(plan.oracles.every((o) => o.hint.length > 10)).toBe(true);
  });

  it("produces asymmetric thresholds, strictest for destructive findings", () => {
    const plan = planLenses("correctness", 3);
    expect(plan.thresholds).toHaveLength(3);
    expect(plan.thresholds[0]!.rule).toMatch(/unanimous/);
    expect(plan.thresholds[2]!.rule).toMatch(/^1 of/);
  });

  it("every lens states what it catches that the others do not", () => {
    for (const d of DOMAINS) {
      for (const l of planLenses(d, 3).lenses) {
        expect(l.catches.length, `${d}/${l.key}`).toBeGreaterThan(15);
      }
    }
  });
});
