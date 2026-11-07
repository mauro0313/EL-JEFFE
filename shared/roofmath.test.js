import test from "node:test";
import assert from "node:assert/strict";
import { iceBarrier, itemCalc, draftTotals, wasteQty, checkDraft, CHECKLIST_CATEGORIES } from "./roofmath.js";

test("ice barrier: 8/12 with 12 in overhang needs 2 courses", () => {
  const r = iceBarrier({ eavesLF: 160, valleysLF: 36, pitch: "8/12", overhangIn: 12, wallIn: 6 });
  assert.equal(r.courses, 2);
  assert.equal(r.eavesSF, 960);
  assert.equal(r.valleysSF, 108);
  assert.equal(r.totalSF, 1068);
});

test("ice barrier: 4/12 with 6 in overhang fits 2 courses too (36 in run)", () => {
  const r = iceBarrier({ eavesLF: 100, pitch: "4/12", overhangIn: 6, wallIn: 6 });
  assert.equal(r.courses, 2); // 36 * 1.054 = 37.9 > 33
});

test("item math: underpaid drip edge", () => {
  const c = itemCalc({ carrier: { quantity: 160, unitPrice: 3.3 }, requested: { quantity: 270, unitPrice: 3.3 } });
  assert.equal(c.carTotal, 528);
  assert.equal(c.reqTotal, 891);
  assert.equal(c.delta, 363);
});

test("totals skip excluded and unpriced", () => {
  const t = draftTotals([
    { include: true, support: "supported", requested: { quantity: 10, unitPrice: 2 } },
    { include: true, support: "unsupported", requested: { quantity: 1, unitPrice: null } },
    { include: false, support: "supported", requested: { quantity: 99, unitPrice: 9 } },
  ]);
  assert.equal(t.pricedRequestedDelta, 20);
  assert.equal(t.unpricedCount, 1);
  assert.equal(t.itemCount, 2);
});

test("waste", () => assert.equal(wasteQty(28.4, 14), 32.38));

test("checkDraft catches the preview's single-course ice & water and single steep line", () => {
  const draft = {
    measurements: { eavesLF: 160, rakesLF: 110, valleysLF: 36, predominantPitch: "8/12", totalSQ: 28.4, suggestedWastePct: 14 },
    items: [
      { category: "ice_water", title: "Ice & water", support: "supported", citations: [{}], letterLine: "x", requested: { quantity: 588, unitPrice: 1.95 } },
      { category: "steep", title: "Steep 7-9", support: "supported", citations: [{}], letterLine: "x", requested: { quantity: 22, unitPrice: 48.33 } },
    ],
    checklist: CHECKLIST_CATEGORIES.map((category) => ({ category })),
  };
  const p = checkDraft(draft, { overhangIn: 12 }, { wallIn: 6 });
  assert.ok(p.some((x) => x.startsWith("Ice & water")));
  assert.ok(p.some((x) => x.startsWith("Steep")));
});
