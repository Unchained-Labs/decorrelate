<div align="center">
  <img src="docs/assets/lockup-horizontal.svg" width="260" alt="Unchained Labs">
  <h1>decorrelate</h1>
  <p><strong>Measures whether your verifiers are actually independent.</strong><br>
  <sub>Three skeptics that share a model and a prompt are one check at 3× the price. This puts a number on it.</sub></p>
  <p><a href="https://unchained-labs.github.io/decorrelate/">Docs</a> · <a href="#the-number">The number</a> · <a href="#the-fix">The fix</a></p>
</div>

---

**Status: alpha.** The statistics are verified against published worked examples
and the API is small, but field names and the JSON report shape may still change.

```
$ decorrelate report runs.jsonl

  verifier independence

  verifiers          3  skeptic-1, skeptic-2, skeptic-3
  findings           40
  contested          6  findings where the panel split

  mean pairwise φ     0.803  redundant
  Fleiss κ           0.800  observed 0.900 · chance 0.501

  N_eff              1.15 of 3
                     █████████░░░░░░░░░░░░░░░

  → You are paying for 3 checks and getting 1.15. That is 2.6× the cost of the confidence you have.
    spent $0.48 on verification · roughly $0.30 of it bought no additional independence

  pairs, worst first

  pair                    φ      κ      agree  shared
  skeptic-1 ↔ skeptic-2    0.80   0.80    90%      40  ← same model, same lens
  skeptic-2 ↔ skeptic-3    0.80   0.80    90%      40  ← same model, same lens
  skeptic-1 ↔ skeptic-3    0.80   0.80    90%      40  ← same model, same lens
```

## The problem

Adding verifiers feels like buying confidence. It usually is not.

Three skeptics with the same model, the same temperature and the same prompt
scaffold are not three checks. They share priors and fail in the same direction,
so **"3 of 3 agree" can be one error counted three times** — and you paid triple
for it. Eval harnesses measure whether findings are *correct*. Nothing measures
whether the verifiers were *independent*, which is the assumption the whole
majority-vote design rests on.

## The number

**`N_eff` — the effective number of independent verifiers.**

This is Kish's design effect, borrowed from survey sampling. If N raters were
independent, the variance of their mean vote would be `p(1-p)/N`. When raters
correlate with average intra-class correlation ρ, the variance is
`p(1-p)/N · (1 + (N-1)ρ)`. That bracketed term is the factor by which
correlation inflates your uncertainty, so dividing it out gives the number of
*independent* raters that would have produced the same precision:

```
N_eff = N / (1 + (N - 1) · ρ)
```

| ρ | 3 verifiers give you | Reading |
| ---: | ---: | :--- |
| 0.00 | 3.00 | genuinely independent |
| 0.40 | 1.67 | overlapping |
| 0.75 | 1.20 | one verifier wearing three hats |
| 1.00 | 1.00 | you have one verifier |

ρ is estimated as the mean pairwise phi coefficient across your verifiers.
Negative ρ is clamped to zero — anti-correlated verifiers are not *more* than
independent in any useful sense, and reporting `N_eff > N` would be sampling
noise dressed as a finding.

Alongside it you get **Fleiss' κ** (chance-corrected panel agreement, with its
observed and expected components separated, because high agreement plus high
chance agreement means "everyone says yes to everything" rather than "everyone is
right") and **per-pair φ and Cohen's κ**, sorted worst first, flagged when a pair
shares a model or a lens.

### The statistics are verified, not asserted

`test/stats.test.ts` reproduces the canonical Fleiss worked example — 10
subjects, 14 raters, 5 categories — to three decimal places on all three
published figures (κ = 0.210, observed = 0.378, chance = 0.213), plus
hand-computed 2×2 cases for Cohen's κ and φ, and the degenerate cases (a rater
with no variance, a fully-agreeing panel, an unbalanced panel). 49 tests.

## The fix

```
$ decorrelate lenses security

  1. authz  claude-opus-5
     Can a caller who should not reach this code path reach it? Name the caller and the path.
     catches: missing or wrong authorization, not input handling
     oracle grep for the auth middleware/decorator on this route before asking a model

  2. input  claude-sonnet-5
     Is any attacker-controlled value used here without validation or escaping? Quote the value and its sink.
     catches: injection and deserialization, independent of who is calling
     oracle a taint-analysis pass or a targeted fuzz case

  3. session  claude-haiku-4-5
     Is session or identity state read, trusted, or mutated without a freshness check?
     catches: stale-token and confused-deputy bugs the other two lenses do not look for
```

Four interventions, in order of return:

1. **Vary the lens.** Three different questions beat three identical ones, and it
   is free. The lens banks are built to a constraint: no two lenses in a bank may
   be answerable by the same reasoning over the same lines.
2. **Vary the model.** Cross-family beats cross-version — routing two lenses to
   two Opus versions shares far more prior than routing one to Opus and one to
   Sonnet. Assignment is round-robin across *families*, not ids.
3. **Prefer an oracle.** A test, a compiler, a linter, a reproduction script:
   deterministic, zero tokens, no shared priors. The planner marks which lenses
   have a deterministic equivalent — usually more than half of them.
4. **Asymmetric thresholds.** Unanimity plus an oracle for destructive findings;
   one vote for cheap-to-fix nits. Uniform verification is the most common way
   these systems get expensive without getting more correct.

Domains: `security`, `correctness`, `performance`, `migration`, `research`,
`generic`. The planner **refuses to pad past the bank size** rather than
duplicating a question — inventing a fourth lens by rewording the third is the
exact thing the report measures.

## Install

```sh
npm i -g decorrelate      # or npx decorrelate
```

## Usage

```sh
decorrelate report <verdicts.jsonl>   # correlation, Fleiss κ, N_eff
decorrelate lenses <domain>           # a diverse-lens plan
```

| Flag | Effect |
| :--- | :--- |
| `--format text\|json` | Output format. |
| `--fail-below N` | Exit 1 if `N_eff` is below N. For CI. |
| `--count N` | Lenses to plan (default 3). |
| `--same-family` | Route every lens to one family — reported as a warning. |

### Input

JSONL, one verdict per line. Field names are flexible because these logs are
hand-rolled more often than not:

```json
{"findingId":"f1","verifierId":"authz","verdict":true,"model":"claude-sonnet-5","costUsd":0.004}
```

Required: a finding id (`findingId` | `finding_id` | `subject`), a verifier id
(`verifierId` | `verifier` | `rater`), a verdict (`verdict` | `real` | `pass` |
`keep` | `vote`). Optional: `lens`, `model`, `costUsd` — supply `costUsd` and the
report prices the redundant share.

Blank lines, comments and unrelated records are skipped and counted. A line that
*looks* like a verdict but is malformed is an error rather than a silent skip,
because dropping it would understate correlation.

### CI

```yaml
- run: decorrelate report verdicts.jsonl --fail-below 2
```

## What it does not do

- **It does not judge whether your findings are correct.** It measures verifier
  *independence*. A panel can be perfectly independent and uniformly wrong.
- **It needs recorded verdicts.** It cannot infer correlation from a spec — for
  the static version (N structurally identical verifiers in the source) use
  [graphlint](https://github.com/Unchained-Labs/graphlint).
- **ρ is estimated from your sample.** With 5 findings the number is noise. The
  report tells you how many findings every verifier actually judged; treat fewer
  than ~20 as directional.
- **It cannot tell you the ground truth.** `N_eff` is about the shape of your
  panel, not its accuracy.

## Development

```sh
pnpm install && pnpm build && pnpm test
node dist/cli.js report test/fixtures/correlated.jsonl
node dist/cli.js report test/fixtures/diverse.jsonl
```

The two fixtures are the same size and cost and differ only in panel design —
`correlated.jsonl` reports `N_eff` 1.15, `diverse.jsonl` reports 1.61.

## Licence

MIT. Part of [Unchained Labs](https://unchained-labs.github.io/) — see also
[graphlint](https://github.com/Unchained-Labs/graphlint) (lint the spec) and
[preflight](https://github.com/Unchained-Labs/preflight) (price the spec).
