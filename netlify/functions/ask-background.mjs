// "Ask EL JEFFE" chat about one job. The browser writes the question to
// jobs/{jobId}/chat and calls this; the answer is written back to the same place.
import { admin, requireTeam, parseBody, safeId } from "../lib/admin.mjs";
import { createMessage, textOf, MODEL } from "../lib/anthropic.mjs";
import { itemCalc } from "../../shared/roofmath.js";

export const handler = async (event) => {
  let chat, body = {};
  try {
    body = parseBody(event);
    await requireTeam(event);
    const { jobId, msgId } = body;
    if (!safeId(jobId) || !safeId(msgId)) return;
    const { db, bucket } = admin();
    const jobRef = db.doc(`jobs/${jobId}`);
    chat = jobRef.collection("chat");
    const [jobSnap, histSnap, settingsSnap, kbSnap, draftSnap] = await Promise.all([
      jobRef.get(), chat.orderBy("createdAt", "desc").limit(14).get(), db.doc("settings/company").get(),
      db.collection("knowledge").get(), jobRef.collection("supplementDrafts").orderBy("createdAt", "desc").limit(5).get(),
    ]);
    if (!jobSnap.exists) return;
    const job = jobSnap.data(), settings = settingsSnap.exists ? settingsSnap.data() : {};
    const turns = histSnap.docs.map((d) => d.data()).reverse().filter((m) => m.text && !m.error);
    while (turns.length && turns[0].role !== "user") turns.shift();
    if (!turns.length || turns[turns.length - 1].role !== "user") return;

    const draft = draftSnap.docs.map((d) => d.data()).find((d) => Array.isArray(d.items));
    const draftCtx = draft
      ? `LATEST SUPPLEMENT DRAFT (${draft.status}):\n${draft.summary || ""}\n` + draft.items.map((i) => { const c = itemCalc(i); return `- ${i.include ? "" : "[left out] "}${i.title}: requested ${i.requested ? `${i.requested.quantity} ${i.requested.unit} @ ${i.requested.unitPrice ?? "unpriced"}` : "—"}; carrier ${i.carrier ? `${i.carrier.quantity} ${i.carrier.unit}` : "not paid"}; difference ${c.delta ?? "unpriced"} (${i.support})`; }).join("\n")
      : "No supplement draft yet.";
    const kb = kbSnap.docs.map((d) => { const k = d.data(); return `[${d.id}] (${k.status}, ${k.category}) ${k.title}\n${k.body || ""}`; }).join("\n\n");

    const attach = [];
    let bytes = 0;
    for (const d of (job.documents || []).filter((x) => x.kind === "estimate" || x.kind === "measurement").slice(0, 3)) {
      if (bytes + (d.size || 0) > 20 * 1024 * 1024) break;
      const [buf] = await bucket.file(d.path).download().catch(() => [null]);
      if (!buf) continue;
      bytes += buf.length;
      const isPdf = (d.contentType || "").includes("pdf") || /\.pdf$/i.test(d.name);
      attach.push({ type: "text", text: `${d.kind === "estimate" ? "CARRIER ESTIMATE" : "MEASUREMENT REPORT"}: ${d.name}` },
        isPdf ? { type: "document", title: d.name, source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }
              : { type: "image", source: { type: "base64", media_type: d.contentType || "image/jpeg", data: buf.toString("base64") } });
    }
    if (attach.length) attach[attach.length - 1].cache_control = { type: "ephemeral" };

    const system = `You are EL JEFFE, the supplement estimator for ${settings.company || "3JM Exteriors"}, a Chicago-area roofing and insurance restoration contractor. Answer the estimator's questions about this one claim, briefly and specifically, like a senior estimator talking to a colleague. Use the attached documents, the draft and the knowledge base; search the web only for building codes or manufacturer requirements. If something isn't in what you have, say so. Give numbers with units and where they came from. Plain text, no markdown headings. If asked to write an email or note, write it ready to send.

JOB
${job.jobNumber || ""} · ${job.customerName || ""} · ${[job.address, job.city].filter(Boolean).join(", ")}
Carrier ${job.carrier || "—"}, claim ${job.claimNumber || "—"}${job.notes ? "\nNotes: " + job.notes : ""}

${draftCtx}

KNOWLEDGE BASE
${kb || "(empty)"}`;

    const merged = [];
    for (const t of turns) {
      const last = merged[merged.length - 1];
      if (last && last.role === t.role) last.text += "\n\n" + t.text; else merged.push({ role: t.role, text: t.text });
    }
    const messages = merged.map((t, i) => ({
      role: t.role,
      content: i === 0 && attach.length ? [...attach, { type: "text", text: t.text }] : t.text,
    }));
    const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    let answer = "";
    for (let round = 0; round < 4; round++) {
      const res = await createMessage({ system, messages, tools, max_tokens: 2000 });
      messages.push({ role: "assistant", content: res.content });
      answer += (answer ? "\n" : "") + textOf(res.content);
      if (res.stop_reason !== "pause_turn") break;
    }
    await chat.add({ role: "assistant", text: answer || "I couldn't come up with an answer. Try asking another way.", replyTo: msgId, model: MODEL, createdAt: Date.now() });
  } catch (e) {
    console.error("ask-background", body.jobId, e?.message || e);
    if (chat) await chat.add({ role: "assistant", error: true, text: e.userFacing ? e.message : "EL JEFFE couldn't answer just now. Try again in a minute.", replyTo: body.msgId || null, createdAt: Date.now() }).catch(() => {});
  }
};
