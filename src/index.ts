/** decorrelate as a library. */
export { analyse, cohenKappa, effectiveVerifiers, fleissKappa, phi } from "./stats.js";
export type { PairCorrelation, Report, Verdict } from "./stats.js";
export { DOMAINS, LENS_BANKS, planLenses } from "./lenses.js";
export type { Domain, Lens, LensPlan } from "./lenses.js";
export { parseVerdicts } from "./io.js";
