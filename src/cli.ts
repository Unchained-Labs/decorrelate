#!/usr/bin/env node
/** decorrelate CLI: report, lenses. */
import { readFileSync } from "node:fs";

import { parseVerdicts } from "./io.js";
import { DOMAINS, planLenses } from "./lenses.js";
import type { Domain } from "./lenses.js";
import { analyse } from "./stats.js";
import type { Report } from "./stats.js";

const VERSION = "0.1.0";

const HELP = `decorrelate ${VERSION} — measure whether your verifiers are actually independent

USAGE
  decorrelate report <verdicts.jsonl>    correlation, Fleiss kappa, N_eff
  decorrelate lenses <domain>            generate a diverse-lens plan

OPTIONS
  --format text|json     output format (default: text)
  --count N              lenses to plan (default: 3)
  --same-family          route every lens to one model family (not advised)
  --fail-below N         exit 1 if N_eff is below N — for CI
  --no-color             disable colour (or set NO_COLOR)
  --version, --help

DOMAINS
  ${DOMAINS.join(", ")}

INPUT
  JSONL, one verdict per line. Required: a finding id, a verifier id, a verdict.
  Field names are flexible — findingId | finding_id | subject, verifierId |
  verifier | rater, verdict | real | pass | keep | vote. Optional: lens, model,
  costUsd.

    {"findingId":"f1","verifierId":"authz","verdict":true,"model":"claude-sonnet-5","costUsd":0.004}

EXAMPLE
  decorrelate report runs.jsonl --fail-below 2
`;

const colour = process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);
const c = (code: string) => (s: string) => (colour ? `[${code}m${s}[0m` : s);
const bold = c("1");
const dim = c("2");
const red = c("31");
const yellow = c("33");
const green = c("32");
const cyan = c("36");
const grey = c("90");

/** Traffic-light a correlation. Status always carries a word, never colour alone. */
function verdictOnRho(rho: number): { word: string; paint: (s: string) => string } {
  if (rho >= 0.7) return { word: "redundant", paint: red };
  if (rho >= 0.4) return { word: "overlapping", paint: yellow };
  return { word: "independent", paint: green };
}

function bar(value: number, max: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(filled) + grey("░".repeat(width - filled));
}

function renderReport(r: Report): string {
  const n = r.verifiers.length;
  const out: string[] = [];
  const v = verdictOnRho(r.meanPhi);

  out.push("");
  out.push(bold("  verifier independence"));
  out.push("");
  out.push(`  ${dim("verifiers")}          ${n}  ${grey(r.verifiers.join(", "))}`);
  out.push(`  ${dim("findings")}           ${r.findings}${
    r.completeFindings !== r.findings ? grey(`  (${r.completeFindings} judged by all)`) : ""
  }`);
  out.push(`  ${dim("contested")}          ${r.contested}  ${grey("findings where the panel split")}`);
  out.push("");

  out.push(`  ${dim("mean pairwise φ")}     ${r.meanPhi.toFixed(3)}  ${v.paint(v.word)}`);
  if (r.fleiss) {
    out.push(
      `  ${dim("Fleiss κ")}           ${r.fleiss.kappa.toFixed(3)}  ${grey(
        `observed ${r.fleiss.observedAgreement.toFixed(3)} · chance ${r.fleiss.expectedAgreement.toFixed(3)}`,
      )}`,
    );
  }
  out.push("");

  // The headline.
  const effStr = r.effectiveVerifiers.toFixed(2);
  out.push(`  ${bold("N_eff")}              ${v.paint(effStr)} ${grey(`of ${n}`)}`);
  out.push(`                     ${bar(r.effectiveVerifiers, n)}`);
  out.push("");
  if (r.wasteMultiple > 1.15) {
    out.push(
      `  ${v.paint("→")} You are paying for ${n} checks and getting ${effStr}. ` +
        `That is ${bold(`${r.wasteMultiple.toFixed(1)}×`)} the cost of the confidence you have.`,
    );
  } else {
    out.push(`  ${green("→")} This panel is close to genuinely independent. Nothing to fix.`);
  }
  if (r.costUsd !== null && r.wastedUsd !== null && r.wastedUsd > 0) {
    out.push(
      `    ${grey(`spent $${r.costUsd.toFixed(2)} on verification · roughly $${r.wastedUsd.toFixed(2)} of it bought no additional independence`)}`,
    );
  }
  out.push("");

  if (r.pairs.length) {
    out.push(bold("  pairs, worst first"));
    out.push("");
    const w = Math.max(...r.pairs.map((p) => `${p.a} ↔ ${p.b}`.length));
    out.push(
      `  ${grey("pair".padEnd(w))}   ${grey("φ")}      ${grey("κ")}      ${grey("agree")}  ${grey("shared")}`,
    );
    for (const p of r.pairs) {
      const pv = verdictOnRho(p.phi);
      const flags: string[] = [];
      if (p.sameModel) flags.push("same model");
      if (p.sameLens) flags.push("same lens");
      out.push(
        `  ${`${p.a} ↔ ${p.b}`.padEnd(w)}   ${pv.paint(p.phi.toFixed(2).padStart(5))}  ${p.cohenKappa
          .toFixed(2)
          .padStart(5)}  ${`${Math.round(p.rawAgreement * 100)}%`.padStart(5)}  ${String(p.overlap).padStart(6)}` +
          (flags.length ? `  ${yellow(`← ${flags.join(", ")}`)}` : ""),
      );
    }
    out.push("");
  }

  if (r.degenerate.length) {
    for (const d of r.degenerate) {
      out.push(
        `  ${red("✗")} ${d.verifierId} voted ${d.alwaysVoted ? "yes" : "no"} every time — it is not a verifier, it is a constant.`,
      );
    }
    out.push("");
  }

  if (r.warnings.length) {
    for (const w of r.warnings) out.push(`  ${yellow("!")} ${dim(w)}`);
    out.push("");
  }

  // What to do about it.
  if (r.wasteMultiple > 1.15) {
    out.push(bold("  what to change"));
    out.push("");
    const sameModelPairs = r.pairs.filter((p) => p.sameModel && p.phi >= 0.4);
    const sameLensPairs = r.pairs.filter((p) => p.sameLens && p.phi >= 0.4);
    if (sameLensPairs.length) {
      out.push(`  1. ${sameLensPairs.length} correlated pair(s) share a lens. Give each a different question — free.`);
    }
    if (sameModelPairs.length) {
      out.push(`  2. ${sameModelPairs.length} correlated pair(s) share a model family. Route one cross-family.`);
    }
    out.push(
      `  3. Where a finding has a runnable check — a test, a compiler, a linter — replace a model lens with it. Zero tokens, no shared priors.`,
    );
    out.push(`  4. Make the threshold asymmetric: unanimity for destructive findings, one vote for nits.`);
    out.push("");
    out.push(`  ${cyan("decorrelate lenses <domain>")} ${grey("generates a plan for 1, 2 and 4.")}`);
    out.push("");
  }

  return out.join("\n");
}

function renderPlan(plan: ReturnType<typeof planLenses>): string {
  const out: string[] = [];
  out.push("");
  out.push(bold(`  diverse-lens plan · ${plan.domain}`));
  out.push("");
  for (const [i, l] of plan.lenses.entries()) {
    out.push(`  ${cyan(`${i + 1}. ${l.key}`)}  ${grey(l.model)}`);
    out.push(`     ${l.question}`);
    out.push(`     ${dim(`catches: ${l.catches}`)}`);
    if (l.oracleAvailable) out.push(`     ${green("oracle")} ${dim(l.oracleHint!)}`);
    out.push("");
  }
  out.push(bold("  pass thresholds"));
  out.push("");
  for (const t of plan.thresholds) {
    out.push(`  ${t.severity.padEnd(22)} ${t.rule}`);
    out.push(`  ${" ".repeat(22)} ${dim(t.why)}`);
  }
  out.push("");
  if (plan.notes.length) {
    for (const n of plan.notes) out.push(`  ${yellow("!")} ${dim(n)}`);
    out.push("");
  }
  return out.join("\n");
}

function main(): number {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return argv.length ? 0 : 2;
  }
  if (argv.includes("--version")) {
    console.log(VERSION);
    return 0;
  }
  if (argv.includes("--no-color")) process.env.NO_COLOR = "1";

  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const format = flag("--format") ?? "text";
  const cmd = argv[0];
  const positional = argv.slice(1).filter((a) => !a.startsWith("-"));

  if (cmd === "lenses") {
    const domain = (positional[0] ?? "generic") as Domain;
    if (!DOMAINS.includes(domain)) {
      console.error(`decorrelate: unknown domain "${domain}". Known: ${DOMAINS.join(", ")}`);
      return 2;
    }
    const count = Number(flag("--count") ?? 3);
    const plan = planLenses(domain, count, { crossFamily: !argv.includes("--same-family") });
    process.stdout.write(format === "json" ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan));
    return 0;
  }

  if (cmd === "report") {
    const file = positional[0];
    if (!file) {
      console.error("usage: decorrelate report <verdicts.jsonl>");
      return 2;
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      console.error(`decorrelate: cannot read ${file}: ${(e as Error).message}`);
      return 2;
    }

    const { verdicts, errors, skipped } = parseVerdicts(text);
    for (const e of errors) console.error(`${yellow("!")} ${e}`);
    if (!verdicts.length) {
      console.error(
        `decorrelate: no verdicts parsed from ${file}${skipped ? ` (${skipped} unrelated records skipped)` : ""}`,
      );
      return 2;
    }

    let report: Report;
    try {
      report = analyse(verdicts);
    } catch (e) {
      console.error(`decorrelate: ${(e as Error).message}`);
      return 2;
    }

    process.stdout.write(
      format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report),
    );

    const floor = flag("--fail-below");
    if (floor !== undefined && report.effectiveVerifiers < Number(floor)) {
      console.error(
        `decorrelate: N_eff ${report.effectiveVerifiers.toFixed(2)} is below --fail-below ${floor}`,
      );
      return 1;
    }
    return 0;
  }

  console.error(`decorrelate: unknown command "${cmd}"`);
  console.log(HELP);
  return 2;
}

process.exitCode = main();
