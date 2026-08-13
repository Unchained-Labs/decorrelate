/**
 * The fix half of the tool.
 *
 * Measuring correlation tells you the panel is redundant; it does not tell you
 * what to replace it with. These are the four interventions from the reference
 * architecture, in order of return:
 *
 *   1. Vary the lens.   Three different questions beat three identical ones. Free.
 *   2. Vary the model.  Cross-family verification breaks shared priors best.
 *   3. Prefer an oracle. A test, a compiler, a linter — deterministic, zero tokens.
 *   4. Asymmetric thresholds. Cheap-to-fix passes on one vote; destructive needs
 *      unanimity plus an oracle.
 *
 * This module implements 1, 2 and 4, and tells you where 3 applies — because a
 * generator cannot know whether your finding has a runnable reproduction.
 */

export type Domain = "security" | "correctness" | "performance" | "migration" | "research" | "generic";

export interface Lens {
  key: string;
  /** The question this verifier is asked. Deliberately narrow. */
  question: string;
  /** What a *different* failure mode this catches that the others do not. */
  catches: string;
  /** True when this lens can usually be replaced by something deterministic. */
  oracleAvailable: boolean;
  oracleHint?: string;
}

/**
 * Lens banks per domain. The design constraint on every set: no two lenses in a
 * bank may be answerable by the same reasoning. If two questions would be
 * answered by reading the same three lines the same way, they are one lens.
 */
const BANKS: Record<Domain, Lens[]> = {
  security: [
    {
      key: "authz",
      question: "Can a caller who should not reach this code path reach it? Name the caller and the path.",
      catches: "missing or wrong authorization, not input handling",
      oracleAvailable: true,
      oracleHint: "grep for the auth middleware/decorator on this route before asking a model",
    },
    {
      key: "input",
      question: "Is any attacker-controlled value used here without validation or escaping? Quote the value and its sink.",
      catches: "injection and deserialization, independent of who is calling",
      oracleAvailable: true,
      oracleHint: "a taint-analysis pass or a targeted fuzz case",
    },
    {
      key: "session",
      question: "Is session or identity state read, trusted, or mutated without a freshness check?",
      catches: "stale-token and confused-deputy bugs the other two lenses do not look for",
      oracleAvailable: false,
    },
    {
      key: "repro",
      question: "Write the smallest concrete request that demonstrates this. If you cannot, say so plainly.",
      catches: "findings that are theoretically true and practically unreachable",
      oracleAvailable: true,
      oracleHint: "run the request — this lens is a script, not a model call",
    },
  ],
  correctness: [
    {
      key: "counterexample",
      question: "Give concrete inputs and state for which this produces the wrong output. Exact values.",
      catches: "claims with no reachable failing case",
      oracleAvailable: true,
      oracleHint: "turn the counterexample into a failing test and run it",
    },
    {
      key: "invariant",
      question: "Which stated invariant or contract does this break, and where is it documented?",
      catches: "code that works by accident against code that is specified wrongly",
      oracleAvailable: false,
    },
    {
      key: "boundary",
      question: "What happens at empty, zero, one, maximum, and null? Answer each.",
      catches: "edge cases the happy-path reasoning skips",
      oracleAvailable: true,
      oracleHint: "property-based testing covers this better than a model does",
    },
    {
      key: "concurrency",
      question: "Is there an interleaving of two callers that produces a state neither intended?",
      catches: "races, which sequential reasoning cannot see",
      oracleAvailable: false,
    },
  ],
  performance: [
    {
      key: "complexity",
      question: "What is the asymptotic cost here, and at what input size does it stop being acceptable?",
      catches: "algorithmic problems rather than constant factors",
      oracleAvailable: true,
      oracleHint: "a benchmark at two input sizes settles this without a model",
    },
    {
      key: "allocation",
      question: "What is allocated per call or per item, and does it survive the call?",
      catches: "memory growth, invisible to a complexity reading",
      oracleAvailable: true,
      oracleHint: "a heap profile",
    },
    {
      key: "io",
      question: "How many round trips does this make, and are any of them in a loop?",
      catches: "N+1 patterns, which look fine locally",
      oracleAvailable: true,
      oracleHint: "count queries in a request trace",
    },
  ],
  migration: [
    {
      key: "parity",
      question: "Name one input for which the ported code behaves differently from the original.",
      catches: "silent semantic drift — the failure mode that still compiles",
      oracleAvailable: true,
      oracleHint: "run both against a golden test set; this is the strongest oracle available",
    },
    {
      key: "idiom",
      question: "Is this a transliteration that ignores how the target language does it?",
      catches: "code that is correct and unmaintainable",
      oracleAvailable: false,
    },
    {
      key: "surface",
      question: "Did any public signature, error type, or default value change?",
      catches: "breaking changes hidden inside a refactor",
      oracleAvailable: true,
      oracleHint: "diff the exported API surface",
    },
  ],
  research: [
    {
      key: "source",
      question: "Is this claim supported by a fetched source? Quote the sentence that supports it, or reject.",
      catches: "unsourced assertions",
      oracleAvailable: true,
      oracleHint: "string-match the quote against the fetched document",
    },
    {
      key: "contradiction",
      question: "Does any other source contradict this? Name it.",
      catches: "claims true in one source and disputed elsewhere",
      oracleAvailable: false,
    },
    {
      key: "counter",
      question: "Construct the strongest plausible counter-example to this claim.",
      catches: "overgeneralisation from a single case",
      oracleAvailable: false,
    },
    {
      key: "recency",
      question: "When was this true? Is it still?",
      catches: "stale facts, which the other lenses accept happily",
      oracleAvailable: true,
      oracleHint: "check the source's publication date against the claim's tense",
    },
  ],
  generic: [
    {
      key: "refute",
      question: "Try to refute this. Default to refuted if you are uncertain.",
      catches: "plausible-but-wrong findings",
      oracleAvailable: false,
    },
    {
      key: "evidence",
      question: "Quote the exact span that supports this. Paraphrase is a rejection.",
      catches: "hallucinated specifics",
      oracleAvailable: true,
      oracleHint: "string-match the quoted span against the source file",
    },
    {
      key: "impact",
      question: "If this is real, what breaks, for whom, and how would they notice?",
      catches: "true findings that do not matter",
      oracleAvailable: false,
    },
  ],
};

/** Model families, so an assignment can be genuinely cross-family. */
const FAMILIES = [
  ["claude-opus-5", "claude-opus-4-8"],
  ["claude-sonnet-5", "claude-sonnet-4-6"],
  ["claude-haiku-4-5"],
];

export interface LensPlan {
  domain: Domain;
  lenses: (Lens & { model: string })[];
  /** Lenses that a deterministic check should replace. */
  oracles: { key: string; hint: string }[];
  /** Recommended pass rule per severity. */
  thresholds: { severity: string; rule: string; why: string }[];
  notes: string[];
}

/**
 * Build a diverse-lens plan.
 *
 * `count` lenses are drawn from the domain bank in order — the banks are ordered
 * so the first two are the most independent pair, because two independent
 * lenses is where precision saturates and the third often buys very little.
 *
 * Models are assigned round-robin across *families*, not across ids: routing
 * two lenses to `claude-opus-5` and `claude-opus-4-8` shares far more prior
 * than routing one to Opus and one to Sonnet.
 */
export function planLenses(
  domain: Domain,
  count = 3,
  opts: { models?: string[]; crossFamily?: boolean } = {},
): LensPlan {
  const bank = BANKS[domain];
  const notes: string[] = [];

  if (count > bank.length) {
    notes.push(
      `asked for ${count} lenses but the ${domain} bank has ${bank.length} genuinely independent ones — returning ${bank.length}. Adding a fourth by duplicating a question is exactly the problem this tool measures.`,
    );
    count = bank.length;
  }
  if (count > 3) {
    notes.push(
      "verification precision saturates fast — the fourth lens usually costs full price for a marginal gain. Measure before keeping it.",
    );
  }

  const chosen = bank.slice(0, count);

  const pool =
    opts.models ??
    (opts.crossFamily === false
      ? ["claude-sonnet-5"]
      : FAMILIES.map((f) => f[0]!));

  const lenses = chosen.map((l, i) => ({ ...l, model: pool[i % pool.length]! }));

  const distinctFamilies = new Set(
    lenses.map((l) => FAMILIES.findIndex((f) => f.includes(l.model))),
  ).size;
  if (distinctFamilies === 1 && lenses.length > 1) {
    notes.push(
      "every lens is routed to the same model family. The lenses are independent but the priors are not — expect a measurable phi above 0.",
    );
  }

  const oracles = chosen
    .filter((l) => l.oracleAvailable)
    .map((l) => ({ key: l.key, hint: l.oracleHint! }));
  if (oracles.length) {
    notes.push(
      `${oracles.length} of these ${chosen.length} lenses have a deterministic equivalent. An oracle costs zero tokens and never hallucinates — use a model verifier only where no oracle exists.`,
    );
  }

  return {
    domain,
    lenses,
    oracles,
    thresholds: [
      {
        severity: "high / destructive",
        rule: `unanimous (${count} of ${count}) plus an oracle where one exists`,
        why: "a false positive here costs someone a rollback, and a false negative costs more",
      },
      {
        severity: "medium",
        rule: `majority (${Math.floor(count / 2) + 1} of ${count})`,
        why: "the default; balances both error directions",
      },
      {
        severity: "low / cheap to fix",
        rule: "1 of " + count + ", or skip verification entirely",
        why: "verifying a nit as hard as an auth bypass spends most of the budget on things nobody will fix",
      },
    ],
    notes,
  };
}

export const DOMAINS = Object.keys(BANKS) as Domain[];
export { BANKS as LENS_BANKS };
