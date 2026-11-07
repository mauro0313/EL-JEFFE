// Roof and supplement arithmetic shared by the browser (draft review) and the
// Netlify function (EL JEFFE's draft validator), so both always agree.

export const CATEGORIES = {
  drip_edge: "Drip edge",
  starter: "Starter",
  ice_water: "Ice & water",
  valleys: "Valleys",
  steep: "Steep charges",
  high: "High / two-story",
  waste: "Waste",
  ridge_cap: "Ridge cap",
  hips: "Hips",
  step_flashing: "Step flashing",
  pipe_jacks_vents: "Pipe jacks & vents",
  underlayment: "Underlayment",
  o_and_p: "Overhead & profit",
  code_upgrades: "Code upgrades",
  permits_debris: "Permit & debris",
  other: "Other",
};

export const CHECKLIST_CATEGORIES = Object.keys(CATEGORIES).filter((c) => c !== "other");

export function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (n) => Math.round(n * 100) / 100;

/** Line math for one supplement item. requested.quantity is the full quantity owed on the line. */
export function itemCalc(item) {
  const r = item.requested, c = item.carrier;
  const rq = toNum(r?.quantity), rp = toNum(r?.unitPrice);
  const reqTotal = isNum(rq) && isNum(rp) ? r2(rq * rp) : null;
  let carTotal = null;
  if (c) {
    const cq = toNum(c.quantity), cp = toNum(c.unitPrice), ct = toNum(c.total);
    carTotal = isNum(cq) && isNum(cp) ? r2(cq * cp) : isNum(ct) ? ct : 0;
  }
  const delta = isNum(reqTotal) ? r2(reqTotal - (carTotal || 0)) : null;
  return { reqTotal, carTotal, delta };
}

export function draftTotals(items = []) {
  const inc = items.filter((i) => i.include);
  let priced = 0, unpriced = 0;
  for (const i of inc) {
    const { delta } = itemCalc(i);
    if (isNum(delta)) priced += delta; else unpriced++;
  }
  return {
    itemCount: inc.length,
    pricedRequestedDelta: r2(priced),
    unpricedCount: unpriced,
    verifyCount: inc.filter((i) => i.support === "needs_verification").length,
    unsupportedCount: inc.filter((i) => i.support === "unsupported").length,
  };
}

export function pitchRise(p) {
  const m = String(p ?? "").match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Ice barrier per IRC R905.2.7.1 practice: from the drip edge to 24 in. inside the
 * exterior wall line, measured up the slope, in 36 in. courses with a 3 in. lap.
 */
export function iceBarrier({ eavesLF, valleysLF, pitch, overhangIn = 12, wallIn = 6 }) {
  const rise = pitchRise(pitch), eaves = toNum(eavesLF);
  if (!isNum(rise) || !isNum(eaves)) return null;
  const run = (toNum(overhangIn) ?? 12) + (toNum(wallIn) ?? 6) + 24;
  const slope = run * Math.sqrt(1 + (rise / 12) ** 2);
  const courses = Math.max(1, Math.ceil(slope / 33));
  const eavesSF = Math.ceil(eaves * courses * 3);
  const valleysSF = Math.ceil((toNum(valleysLF) || 0) * 3);
  return { run, rise, slopeIn: Math.round(slope * 10) / 10, courses, eavesSF, valleysSF, totalSF: eavesSF + valleysSF };
}

export function wasteQty(totalSQ, wastePct) {
  const sq = toNum(totalSQ), pct = toNum(wastePct);
  if (!isNum(sq) || !isNum(pct)) return null;
  return r2(sq * (1 + pct / 100));
}

/**
 * Arithmetic checks a supplement draft must pass. Returns human-readable problems.
 * Used to reject EL JEFFE's draft so it revises, and to show warnings in review.
 */
export function checkDraft(draft, job = {}, settings = {}) {
  const problems = [];
  const m = draft.measurements || {};
  const items = Array.isArray(draft.items) ? draft.items : [];
  if (!items.length) problems.push("The draft has no line items. If the carrier paid everything correctly, add one item explaining that with include false.");
  items.forEach((it, n) => {
    const tag = `Item ${n + 1} (${it.title || it.category || "untitled"})`;
    if (!CATEGORIES[it.category]) problems.push(`${tag}: category "${it.category}" is not one of ${Object.keys(CATEGORIES).join(", ")}.`);
    if (!["supported", "needs_verification", "unsupported"].includes(it.support)) problems.push(`${tag}: support must be supported, needs_verification or unsupported.`);
    if (it.requested && toNum(it.requested.quantity) === null) problems.push(`${tag}: requested.quantity must be a number.`);
    if (it.support !== "unsupported" && !(it.citations || []).length) problems.push(`${tag}: a supported item needs at least one citation.`);
    if (it.support !== "unsupported" && !String(it.letterLine || "").trim()) problems.push(`${tag}: add a letterLine for the adjuster letter.`);
    if (it.carrier && it.requested && toNum(it.carrier.quantity) !== null && toNum(it.requested.quantity) !== null &&
        toNum(it.requested.quantity) <= toNum(it.carrier.quantity) && it.issue === "underpaid")
      problems.push(`${tag}: requested quantity must be the full quantity owed, larger than the ${it.carrier.quantity} the carrier paid.`);
  });

  const ib = iceBarrier({ eavesLF: m.eavesLF, valleysLF: m.valleysLF, pitch: m.predominantPitch, overhangIn: job.overhangIn ?? settings.overhangIn, wallIn: settings.wallIn });
  const iw = items.find((i) => i.category === "ice_water" && i.requested);
  if (ib && iw) {
    const got = toNum(iw.requested.quantity);
    if (got !== null && Math.abs(got - ib.totalSF) > Math.max(10, ib.totalSF * 0.03))
      problems.push(`Ice & water: with ${ib.run} in. of run at ${ib.rise}/12 the eaves need ${ib.courses} course(s), so eaves ${ib.eavesSF} SF + valleys ${ib.valleysSF} SF = ${ib.totalSF} SF, but the draft requests ${got} SF.`);
  }
  const de = items.find((i) => i.category === "drip_edge" && i.requested);
  const e = toNum(m.eavesLF), rk = toNum(m.rakesLF);
  if (de && isNum(e) && isNum(rk)) {
    const got = toNum(de.requested.quantity);
    if (got !== null && Math.abs(got - (e + rk)) > 2) problems.push(`Drip edge: eaves ${e} + rakes ${rk} = ${e + rk} LF, but the draft requests ${got} LF.`);
  }
  const wi = items.find((i) => i.category === "waste" && i.requested);
  const wq = wasteQty(m.totalSQ, m.suggestedWastePct);
  if (wi && wq !== null) {
    const got = toNum(wi.requested.quantity);
    if (got !== null && Math.abs(got - wq) > 0.34) problems.push(`Waste: ${m.totalSQ} SQ × ${(1 + toNum(m.suggestedWastePct) / 100).toFixed(2)} = ${wq} SQ, but the draft requests ${got} SQ.`);
  }
  const steep = items.filter((i) => i.category === "steep" && i.requested);
  if (steep.length) {
    const removal = steep.filter((i) => /remov|tear|r&r/i.test(`${i.title} ${i.xactimateLine || ""}`));
    if (!removal.length || removal.length === steep.length)
      problems.push("Steep charges: write one removal line and one replacement line for each pitch band.");
  }
  const checked = new Set((draft.checklist || []).map((c) => c.category));
  const missing = CHECKLIST_CATEGORIES.filter((c) => !checked.has(c));
  if (missing.length) problems.push(`Checklist is missing: ${missing.join(", ")}.`);
  return problems;
}

/** Warnings shown next to a single item in review (the same checks, per item). */
export function itemWarnings(item, draft, job, settings) {
  const w = [];
  const all = checkDraft({ ...draft, items: [item], checklist: CHECKLIST_CATEGORIES.map((category) => ({ category })) }, job, settings);
  for (const p of all) if (/^(Ice & water|Drip edge|Waste):/.test(p)) w.push(p);
  if (item.include && item.requested && toNum(item.requested.unitPrice) === null) w.push("No unit price yet, so it isn't counted in the total.");
  return w;
}

export function buildLetter({ items = [], job = {}, settings = {} }) {
  const inc = items.filter((i) => i.include && String(i.letterLine || "").trim());
  const addr = [job.address, job.city].filter(Boolean).join(", ");
  return [
    "To Whom it May Concern:",
    "",
    `Re: Claim ${job.claimNumber || "—"} — ${job.customerName || ""}${addr ? ", " + addr : ""}`,
    "",
    settings.letterIntro || "",
    "",
    ...inc.map((it, n) => `${n + 1}. ${it.letterLine.trim()}`),
    "",
    "Thank you for your review.",
    "",
    settings.company || "3JM Exteriors",
    [settings.email, settings.phone].filter(Boolean).join(" · "),
  ].join("\n");
}
