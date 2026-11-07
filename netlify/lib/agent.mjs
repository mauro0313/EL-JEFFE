// EL JEFFE: reads the carrier estimate and the measurement report, researches the
// local building code, and saves a supplement draft for a person to review.
import { admin, FieldValue } from "./admin.mjs";
import { createMessage, MODEL } from "./anthropic.mjs";
import { CATEGORIES, CHECKLIST_CATEGORIES, checkDraft, draftTotals, toNum } from "../../shared/roofmath.js";

const MAX_ROUNDS = 16;
const MAX_REJECTIONS = 2;
const DEADLINE_MS = 13 * 60 * 1000; // background functions stop at 15 minutes
const MAX_ATTACH_BYTES = 24 * 1024 * 1024;

const SAVE_DRAFT = {
  name: "save_draft",
  description: "Save the finished supplement draft for the estimator to review. Call it exactly once, when the review is complete. If it returns problems, fix them and call it again.",
  input_schema: {
    type: "object",
    required: ["summary", "measurements", "items", "checklist"],
    properties: {
      summary: { type: "string", description: "2-3 sentences: what the carrier missed and which items are weakest." },
      measurements: {
        type: "object",
        description: "Values read from the measurement report. null when the report doesn't show one.",
        properties: {
          totalSQ: { type: ["number", "null"] }, predominantPitch: { type: ["string", "null"], description: "like 8/12" },
          pitchAreas: { type: "array", items: { type: "object", properties: { pitch: { type: "string" }, sq: { type: "number" } } } },
          eavesLF: { type: ["number", "null"] }, rakesLF: { type: ["number", "null"] }, valleysLF: { type: ["number", "null"] },
          ridgeLF: { type: ["number", "null"] }, hipsLF: { type: ["number", "null"] }, stepFlashingLF: { type: ["number", "null"] },
          stories: { type: ["number", "null"] }, suggestedWastePct: { type: ["number", "null"] },
        },
      },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["category", "title", "issue", "support", "rationale"],
          properties: {
            category: { type: "string", enum: Object.keys(CATEGORIES) },
            title: { type: "string" },
            issue: { type: "string", enum: ["missing", "underpaid"] },
            xactimateLine: { type: ["string", "null"] },
            carrier: { type: ["object", "null"], description: "What the carrier paid on this line; null if not paid.", properties: { quantity: { type: "number" }, unit: { type: "string" }, unitPrice: { type: ["number", "null"] }, total: { type: ["number", "null"] } } },
            requested: { type: ["object", "null"], description: "The FULL quantity owed on this line (not the difference).", properties: { quantity: { type: "number" }, unit: { type: "string" }, unitPrice: { type: ["number", "null"] } } },
            support: { type: "string", enum: ["supported", "needs_verification", "unsupported"] },
            rationale: { type: "string" },
            calc: { type: "string", description: "The arithmetic, if any." },
            letterLine: { type: "string", description: "1-2 sentences for the adjuster letter: quantity requested, quantity paid, and the source with page. Empty for unsupported items." },
            citations: {
              type: "array",
              items: { type: "object", properties: { source: { type: "string", enum: ["estimate", "measurement", "kb", "code", "other"] }, ref: { type: "string", description: "page like p.2, a KB id, or a URL" }, quote: { type: "string", description: "exact words, at most 120 characters" } } },
            },
          },
        },
      },
      checklist: {
        type: "array",
        description: `One entry for each of: ${CHECKLIST_CATEGORIES.join(", ")}.`,
        items: { type: "object", properties: { category: { type: "string" }, status: { type: "string", enum: ["flagged", "carrier_ok", "no_support", "not_applicable"] }, note: { type: "string" } } },
      },
      codeFindings: {
        type: "array",
        items: { type: "object", properties: { jurisdiction: { type: "string" }, adoptedCode: { type: "string" }, section: { type: "string" }, requirement: { type: "string" }, url: { type: "string" }, quote: { type: "string" }, official: { type: "boolean", description: "true only if the URL is the town's code, the state's code, or the ICC's published code" } } },
      },
      openQuestions: { type: "array", items: { type: "string" } },
    },
  },
};

function systemPrompt({ settings, knowledge, job }) {
  const kb = knowledge.length
    ? knowledge.map((k) => `[${k.id}] (${k.status === "needs_source" ? "needs_source" : "verified"}, ${k.category}) ${k.title}${k.source ? "\nSource: " + k.source : ""}${k.body ? "\n" + k.body : ""}`).join("\n\n")
    : "(empty)";
  return `You are EL JEFFE, the supplement estimator for ${settings.company || "3JM Exteriors"}, a roofing and insurance restoration contractor in the Chicago area. You review an insurance carrier's roof estimate against the measurement report for the same property, find every item the carrier missed or underpaid, and save a supplement draft with the save_draft tool. A person reviews your draft; nothing goes to the adjuster without them.

HOW TO WORK
1. Read both attached documents carefully. Note every line, quantity, unit price and page.
2. Find the building code the property's town has adopted. Search the web for the municipality's adopted residential code (for example "<town> IL adopted residential building code"), then read the official page. Look up the drip edge and ice barrier sections of that edition. Prefer the town's own code (ecode360, municode, amlegal, the village website), the state, or codes.iccsafe.org. Use at most a few searches.
3. Work through the checklist, then call save_draft once with the complete draft.

RULES
- Use only facts from the attached documents, the knowledge base below, and pages you actually read on the web. Never invent measurements, prices, page numbers, code sections or quotes.
- Citation quotes are copied exactly, at most 120 characters.
- Unit prices: the carrier's unit price for the same Xactimate line when it has one; else a price from a KB price entry (cite its id); else unitPrice null, so the item stays unpriced.
- support: "supported" when the report, the estimate, a verified KB entry, or an official code page you read backs it; "needs_verification" when it relies only on a needs_source KB entry or an unofficial code summary; "unsupported" when you think it applies but nothing backs it.
- requested.quantity is the FULL quantity owed on the line, not the difference. carrier is what was paid on that line, or null.
- Round SQ to 2 decimals; round LF and SF up to whole numbers.
- Don't request what the carrier already paid correctly.

CHECKLIST (one checklist entry per category)
- drip_edge: eaves + rakes LF.
- starter: eaves; rakes only when a KB entry or the shingle manufacturer's instructions you read require it.
- ice_water: eaves AND valleys, in one item. The eave barrier reaches 24 in. inside the exterior wall line. Run = overhang + wall + 24 in. Slope length = run × √(1 + (rise/12)²) at the predominant pitch. Courses = ceil(slope length ÷ 33). Eaves SF = eaves LF × courses × 3; valleys SF = valley LF × 3. Put the arithmetic in calc. The draft is checked against this.
- valleys: valley metal or treatment if missing.
- steep: a separate REMOVAL item and REPLACEMENT item for each pitch band (7/12–9/12, 10/12–12/12, over 12/12), quantity = SQ in that band. Title the removal item starting with "Remove".
- high: two-story roofs: removal and replacement high-roof items only with a KB entry and a price; otherwise one unsupported item with unitPrice null.
- waste: shingle quantity = measured SQ × (1 + the report's suggested waste %).
- ridge_cap, hips: LF against the report.
- step_flashing: report LF against the estimate.
- pipe_jacks_vents: counts against the report and notes.
- underlayment: quantity against the measured area.
- o_and_p: only with 3+ trades or KB support.
- code_upgrades: code-required items from the adopted code.
- permits_debris: permit, dumpster, haul-off.
Checklist status: flagged (you made an item), carrier_ok, no_support, not_applicable.

JOB
Job number: ${job.jobNumber || "—"}
Customer: ${job.customerName || "—"}
Property: ${[job.address, job.city].filter(Boolean).join(", ") || "—"}
Carrier: ${job.carrier || "—"} · Claim: ${job.claimNumber || "—"} · Date of loss: ${job.dateOfLoss || "—"}
Shingle: ${job.shingle || "not stated"}
Eave overhang: ${job.overhangIn ?? settings.overhangIn ?? 12} in. · Exterior wall: ${settings.wallIn ?? 6} in.
Stories (job record): ${job.stories || "not stated"}
${job.notes ? "Estimator notes: " + job.notes : ""}

KNOWLEDGE BASE (cite by id)
${kb}`;
}

function normalizeDraft(o) {
  const side = (s) => (s && typeof s === "object" ? { quantity: toNum(s.quantity), unit: String(s.unit || ""), unitPrice: toNum(s.unitPrice), total: toNum(s.total) } : null);
  const str = (v, n) => String(v ?? "").slice(0, n);
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 40).map((it, n) => {
    const support = ["supported", "needs_verification", "unsupported"].includes(it.support) ? it.support : "unsupported";
    return {
      id: `item-${n + 1}`, category: CATEGORIES[it.category] ? it.category : "other", title: str(it.title || "Untitled item", 160),
      issue: it.issue === "underpaid" ? "underpaid" : "missing", xactimateLine: it.xactimateLine ? str(it.xactimateLine, 200) : null,
      carrier: side(it.carrier), requested: side(it.requested), support, include: support !== "unsupported",
      rationale: str(it.rationale, 1500), calc: str(it.calc, 600), letterLine: str(it.letterLine, 800),
      citations: (Array.isArray(it.citations) ? it.citations : []).slice(0, 8).map((c) => ({ source: str(c.source, 20), ref: str(c.ref, 300), quote: str(c.quote, 200) })),
    };
  });
  const m = o.measurements && typeof o.measurements === "object" ? o.measurements : {};
  const measurements = {};
  for (const k of ["totalSQ", "eavesLF", "rakesLF", "valleysLF", "ridgeLF", "hipsLF", "stepFlashingLF", "stories", "suggestedWastePct"]) measurements[k] = toNum(m[k]);
  measurements.predominantPitch = m.predominantPitch ? str(m.predominantPitch, 20) : null;
  measurements.pitchAreas = (Array.isArray(m.pitchAreas) ? m.pitchAreas : []).slice(0, 12).map((p) => ({ pitch: str(p.pitch, 20), sq: toNum(p.sq) }));
  return {
    summary: str(o.summary, 1500), measurements, items,
    checklist: (Array.isArray(o.checklist) ? o.checklist : []).slice(0, 20).map((c) => ({ category: str(c.category, 40), status: str(c.status, 20), note: str(c.note, 200) })),
    codeFindings: (Array.isArray(o.codeFindings) ? o.codeFindings : []).slice(0, 10).map((c) => ({
      jurisdiction: str(c.jurisdiction, 120), adoptedCode: str(c.adoptedCode, 120), section: str(c.section, 120), requirement: str(c.requirement, 400),
      url: /^https?:\/\//.test(String(c.url || "")) ? str(c.url, 500) : "", quote: str(c.quote, 200), official: !!c.official,
    })),
    openQuestions: (Array.isArray(o.openQuestions) ? o.openQuestions : []).slice(0, 8).map((q) => str(q, 300)),
  };
}

async function loadAttachment(bucket, doc) {
  const [buf] = await bucket.file(doc.path).download();
  const mt = doc.contentType || (/\.pdf$/i.test(doc.name) ? "application/pdf" : "image/jpeg");
  if (mt === "application/pdf") return { bytes: buf.length, block: { type: "document", title: doc.name, source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } } };
  return { bytes: buf.length, block: { type: "image", source: { type: "base64", media_type: mt, data: buf.toString("base64") } } };
}

export async function runSupplement({ jobId, draftId, estimateDocId, measurementDocId, user }) {
  const started = Date.now();
  const { db, bucket } = admin();
  const jobRef = db.doc(`jobs/${jobId}`);
  const draftRef = jobRef.collection("supplementDrafts").doc(draftId);
  const log = async (text, type = "tool", tool = null) => {
    await draftRef.update({ log: FieldValue.arrayUnion({ ts: Date.now(), type, tool, text: String(text).slice(0, 400) }), updatedAt: Date.now() }).catch(() => {});
  };
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 };

  try {
    await draftRef.update({ status: "Running", updatedAt: Date.now() });
    const [jobSnap, settingsSnap, kbSnap] = await Promise.all([jobRef.get(), db.doc("settings/company").get(), db.collection("knowledge").get()]);
    if (!jobSnap.exists) throw Object.assign(new Error("The job was deleted."), { userFacing: true });
    const job = jobSnap.data();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const knowledge = kbSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const docs = job.documents || [];
    const est = docs.find((d) => d.id === estimateDocId), mea = docs.find((d) => d.id === measurementDocId);
    if (!est || !mea) throw Object.assign(new Error("One of the chosen documents was removed from the job."), { userFacing: true });
    await log(`Read job ${job.jobNumber || ""} (${job.carrier || "carrier"}, claim ${job.claimNumber || "—"})`, "tool", "get_job");

    const content = [];
    let bytes = 0;
    for (const [label, d] of [["CARRIER ESTIMATE", est], ["MEASUREMENT REPORT", mea]]) {
      const a = await loadAttachment(bucket, d);
      bytes += a.bytes;
      content.push({ type: "text", text: `${label}: ${d.name}` }, a.block);
      await log(`Opened ${label.toLowerCase()} "${d.name}" (${Math.round(a.bytes / 1024)} KB)`, "tool", "read_document");
    }
    for (const d of docs.filter((x) => x.id !== est.id && x.id !== mea.id && x.kind !== "other").slice(0, 6)) {
      if (bytes + (d.size || 0) > MAX_ATTACH_BYTES) break;
      const a = await loadAttachment(bucket, d).catch(() => null);
      if (!a) continue;
      bytes += a.bytes;
      content.push({ type: "text", text: `ADDITIONAL (${d.kind || "document"}): ${d.name}` }, a.block);
    }
    if (bytes > MAX_ATTACH_BYTES) throw Object.assign(new Error("The documents are too large to send together (over 24 MB). Upload smaller PDFs or fewer photos."), { userFacing: true });
    content[content.length - 1].cache_control = { type: "ephemeral" };
    content.push({ type: "text", text: "Review this claim and save the supplement draft." });
    await log(`Loaded knowledge base: ${knowledge.length} entries`, "tool", "lookup_knowledge");

    const system = systemPrompt({ settings, knowledge, job });
    const tools = [
      { type: "web_search_20250305", name: "web_search", max_uses: 6, user_location: { type: "approximate", city: "Chicago", region: "Illinois", country: "US", timezone: "America/Chicago" } },
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: 6 },
      SAVE_DRAFT,
    ];
    const messages = [{ role: "user", content }];
    let rejections = 0, nudged = false, saved = null;

    for (let round = 0; round < MAX_ROUNDS && !saved; round++) {
      if (Date.now() - started > DEADLINE_MS) throw Object.assign(new Error("EL JEFFE ran out of time (13 minutes). Try again, or remove extra documents."), { userFacing: true });
      const res = await createMessage({ system, messages, tools, max_tokens: 16000 });
      for (const k of Object.keys(usage)) if (k !== "web_search_requests") usage[k] += res.usage?.[k] || 0;
      usage.web_search_requests += res.usage?.server_tool_use?.web_search_requests || 0;
      messages.push({ role: "assistant", content: res.content });

      for (const b of res.content) {
        if (b.type === "server_tool_use" && b.name === "web_search") await log(`Searched the web: "${b.input?.query || ""}"`, "tool", "web_search");
        if (b.type === "server_tool_use" && b.name === "web_fetch") await log(`Read ${b.input?.url || "a page"}`, "tool", "web_fetch");
      }
      if (res.stop_reason === "pause_turn") continue;

      const calls = res.content.filter((b) => b.type === "tool_use");
      if (!calls.length) {
        if (res.stop_reason === "max_tokens") { messages.push({ role: "user", content: "You hit the length limit. Keep notes short and call save_draft now." }); continue; }
        if (nudged) throw Object.assign(new Error("EL JEFFE stopped without saving a draft. Run it again."), { userFacing: true });
        nudged = true;
        messages.push({ role: "user", content: "Call save_draft now with the complete draft." });
        continue;
      }
      const results = [];
      for (const call of calls) {
        if (call.name !== "save_draft") { results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Unknown tool ${call.name}.` }); continue; }
        const draft = normalizeDraft(call.input || {});
        const problems = checkDraft(draft, job, settings);
        if (problems.length && rejections < MAX_REJECTIONS) {
          rejections++;
          await log(`Draft rejected by validation (${problems.length} problem${problems.length > 1 ? "s" : ""}); EL JEFFE is revising`, "validation", "save_draft");
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Not saved. Fix these and call save_draft again with the whole draft:\n- " + problems.join("\n- ") });
        } else {
          saved = { draft, warnings: problems };
          results.push({ type: "tool_result", tool_use_id: call.id, content: "Saved for review." });
        }
      }
      messages.push({ role: "user", content: results });
    }
    if (!saved) throw Object.assign(new Error("EL JEFFE didn't finish within its step limit. Run it again."), { userFacing: true });

    const { draft, warnings } = saved;
    const totals = draftTotals(draft.items);
    for (const it of draft.items) await log(`${it.support === "unsupported" ? "Flagged (no support, left out)" : "Flagged"}: ${it.title}`, "finding");
    await draftRef.update({
      ...draft, totals, validationWarnings: warnings, status: "Needs Review", model: MODEL, usage,
      durationSec: Math.round((Date.now() - started) / 1000), finishedAt: Date.now(), updatedAt: Date.now(),
      log: FieldValue.arrayUnion({ ts: Date.now(), type: "status", tool: "save_draft", text: `Supplement draft saved for review: ${totals.itemCount} items, $${totals.pricedRequestedDelta.toLocaleString("en-US", { minimumFractionDigits: 2 })} priced` }),
    });
    await jobRef.update({
      ...(!job.status || job.status === "Open" ? { status: "Supplement in review" } : {}),
      lastDraft: { id: draftId, status: "Needs Review", priced: totals.pricedRequestedDelta, items: totals.itemCount, at: Date.now() },
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.error("EL JEFFE run failed", jobId, draftId, e);
    const msg = e.userFacing ? e.message : "Something went wrong while EL JEFFE was working. Run it again; if it keeps failing, send Claude the time it happened.";
    await draftRef.update({ status: "Failed", error: msg, usage, finishedAt: Date.now(), updatedAt: Date.now(),
      log: FieldValue.arrayUnion({ ts: Date.now(), type: "error", tool: null, text: msg }) }).catch(() => {});
    await jobRef.update({ lastDraft: { id: draftId, status: "Failed", at: Date.now() } }).catch(() => {});
  }
}
