import { useEffect, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useDoc, money, qty, when, friendlyError } from "../lib/data.js";
import { Button, Card, Confirm, Empty, Field, Pill, StatusPill, SupportPill, inputCls, toast } from "../ui.jsx";
import { CATEGORIES, itemCalc, draftTotals, iceBarrier, itemWarnings, buildLetter, toNum } from "../../shared/roofmath.js";
import { useSettings } from "./Jobs.jsx";
import { runStatus } from "./Job.jsx";

const lf = (v) => (v != null ? `${v} LF` : "—");
const CHECK = { flagged: ["orange", "Flagged"], carrier_ok: ["green", "Carrier OK"], no_support: ["red", "No support"], not_applicable: ["gray", "N/A"] };

export default function Draft({ job, draftId, user }) {
  const path = `jobs/${job.id}/supplementDrafts/${draftId}`;
  const { data: d, loading } = useDoc(path);
  const settings = useSettings();
  const [open, setOpen] = useState({});
  const [decide, setDecide] = useState(null);
  const [note, setNote] = useState("");
  const [letter, setLetter] = useState(null);
  useEffect(() => { setLetter(null); }, [draftId]);
  if (loading) return <Card><p className="text-sm text-jm-muted">Loading draft…</p></Card>;
  if (!d) return <Card><p>This run no longer exists.</p><a className="text-sm text-jm-blue" href={`#/job/${job.id}/supplement`}>Back to runs</a></Card>;

  const status = runStatus(d);
  const back = <a className="text-sm text-jm-blue" href={`#/job/${job.id}/supplement`}>← All runs</a>;
  const save = (patch) => updateDoc(doc(db, path), { ...patch, updatedAt: Date.now() }).catch((e) => toast(friendlyError(e)));
  const locked = status === "Approved" || status === "Rejected";

  if (!Array.isArray(d.items)) {
    const live = status === "Queued" || status === "Running";
    return (
      <Card title={live ? "EL JEFFE is working" : status === "Interrupted" ? "This run stopped" : "This run didn't finish"} actions={<StatusPill status={status} />}>
        {live && <div className="mb-3 h-1 overflow-hidden rounded bg-jm-sky"><div className="jm-progress h-full w-1/3 bg-jm-orange" /></div>}
        {d.error && <p className="mb-3 text-sm text-jm-red">{d.error}</p>}
        {status === "Interrupted" && <p className="mb-3 text-sm">No progress for over 15 minutes. Run it again from the Supplement tab.</p>}
        <Log log={d.log} />
        <div className="mt-4">{back}</div>
      </Card>
    );
  }

  const items = d.items;
  const t = draftTotals(items);
  const m = d.measurements || {};
  const ib = iceBarrier({ eavesLF: m.eavesLF, valleysLF: m.valleysLF, pitch: m.predominantPitch, overhangIn: job.overhangIn ?? settings.overhangIn, wallIn: settings.wallIn });
  const builtLetter = buildLetter({ items, job, settings });
  const letterText = letter ?? d.letterOverride ?? builtLetter;
  const patchItem = (i, fn) => save({ items: items.map((it, k) => (k === i ? fn(structuredClone(it)) : it)) });

  async function finish() {
    try {
      await updateDoc(doc(db, path), { status: decide, reviewNote: note.trim(), decidedAt: Date.now(), decidedBy: user.email, updatedAt: Date.now() });
      await updateDoc(doc(db, "jobs", job.id), { lastDraft: { ...(job.lastDraft || {}), id: draftId, status: decide, priced: t.pricedRequestedDelta, items: t.itemCount, at: Date.now() }, updatedAt: Date.now() });
      toast(decide === "Approved" ? "Approved. Send it to the adjuster when you're ready." : "Draft rejected");
      setDecide(null);
    } catch (e) { toast(friendlyError(e)); }
  }
  async function copy() { try { await navigator.clipboard.writeText(letterText); toast("Letter copied"); } catch { toast("Select the letter and copy it with Ctrl+C."); } }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function csv() {
    const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [["Include", "Item", "Category", "Xactimate line", "Carrier qty", "Carrier unit price", "Carrier total", "Requested qty", "Unit", "Unit price", "Line total", "Difference", "Support"]];
    for (const it of items) { const c = itemCalc(it); rows.push([it.include ? "yes" : "no", it.title, CATEGORIES[it.category], it.xactimateLine, it.carrier?.quantity, it.carrier?.unitPrice, c.carTotal, it.requested?.quantity, it.requested?.unit, it.requested?.unitPrice, c.reqTotal, c.delta, it.support]); }
    download(`${job.jobNumber || "job"}-supplement-items.csv`, rows.map((r) => r.map(cell).join(",")).join("\n"), "text/csv");
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>{back}<p className="mt-1 text-xs text-jm-muted">Run {when(d.createdAt)} by {d.createdBy} · {d.estimateDoc?.name} vs {d.measurementDoc?.name}{d.durationSec ? ` · ${Math.round(d.durationSec / 60)} min` : ""}</p></div>
        <StatusPill status={status} />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-jm-line bg-jm-line md:grid-cols-4">
        {[["Items in supplement", t.itemCount], ["Requested (priced items)", money(t.pricedRequestedDelta)], ["Source to verify", t.verifyCount], ["Unpriced", t.unpricedCount]].map(([l, v]) => (
          <div key={l} className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wider text-jm-muted">{l}</div><div className="tabular text-2xl font-extrabold text-jm-navy">{v}</div></div>))}
      </div>
      {status === "Approved" && <div className="rounded-xl bg-green-50 p-3 text-sm">Approved {when(d.decidedAt)} by {d.decidedBy}. Send the letter and supplement estimate to the adjuster yourself.{d.reviewNote && ` Note: ${d.reviewNote}`}</div>}
      {status === "Rejected" && <div className="rounded-xl bg-red-50 p-3 text-sm">Rejected {when(d.decidedAt)} by {d.decidedBy}.{d.reviewNote && ` Reason: ${d.reviewNote}`}</div>}
      <Card title="Summary">
        <p className="text-sm">{d.summary}</p>
        {d.openQuestions?.length > 0 && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-jm-muted">Confirm on site</p><ul className="mt-1 list-disc pl-5 text-sm">{d.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
        {d.validationWarnings?.length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-jm-amber"><b>Math checks EL JEFFE didn't resolve:</b><ul className="mt-1 list-disc pl-5">{d.validationWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      </Card>

      <Card title="Line items" actions={<span className="text-xs text-jm-muted">{locked ? "Locked after review" : "Edit quantities and prices; totals recalculate"}</span>}>
        <div className="-mx-1 overflow-x-auto"><table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-jm-line text-left text-[11px] uppercase tracking-wider text-jm-muted">
            <th className="w-8 px-1 py-2" /><th className="px-2">Item</th><th className="px-2 text-right">Carrier paid</th><th className="px-2 text-right">Requested qty</th><th className="px-2 text-right">Unit price</th><th className="px-2 text-right">Line total</th><th className="px-2 text-right">Difference</th></tr></thead>
          <tbody>{items.map((it, i) => {
            const c = itemCalc(it); const warns = itemWarnings(it, d, job, settings);
            return [
              <tr key={it.id || i} className={`border-b border-jm-line/70 align-top ${it.include ? "" : "opacity-50"}`}>
                <td className="px-1 py-3"><input type="checkbox" className="h-4 w-4" checked={!!it.include} disabled={locked} aria-label="Include in supplement" onChange={(e) => patchItem(i, (x) => ({ ...x, include: e.target.checked }))} /></td>
                <td className="min-w-[260px] px-2 py-2.5">
                  <div className="font-semibold">{it.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1"><Pill>{CATEGORIES[it.category] || it.category}</Pill><Pill tone="blue">{it.issue === "underpaid" ? "Underpaid" : "Missing"}</Pill><SupportPill support={it.support} /></div>
                  {warns.map((w, k) => <div key={k} className="mt-1 text-xs text-jm-amber">{w}</div>)}
                  <button className="mt-1 text-xs font-semibold text-jm-blue" onClick={() => setOpen({ ...open, [i]: !open[i] })}>{open[i] ? "Hide details" : "Why, sources & letter line"}</button>
                </td>
                <td className="tabular px-2 py-2.5 text-right">{it.carrier ? <>{qty(toNum(it.carrier.quantity))} {it.carrier.unit}<div className="text-xs text-jm-muted">{money(c.carTotal)}</div></> : <span className="text-jm-muted">Not paid</span>}</td>
                <td className="px-2 py-2 text-right">{it.requested ? <NumCell value={it.requested.quantity} disabled={locked} label="Requested quantity" onSave={(v) => patchItem(i, (x) => ({ ...x, requested: { ...x.requested, quantity: v } }))} suffix={it.requested.unit} /> : "—"}</td>
                <td className="px-2 py-2 text-right">{it.requested ? <NumCell value={it.requested.unitPrice} disabled={locked} label="Unit price" onSave={(v) => patchItem(i, (x) => ({ ...x, requested: { ...x.requested, unitPrice: v } }))} /> : "—"}</td>
                <td className="tabular px-2 py-2.5 text-right">{money(c.reqTotal)}</td>
                <td className="tabular px-2 py-2.5 text-right font-semibold">{money(c.delta)}</td>
              </tr>,
              open[i] && (
                <tr key={`${it.id || i}-d`} className="border-b border-jm-line/70 bg-jm-sky"><td /><td colSpan={6} className="grid gap-2 px-2 py-3 text-sm">
                  <p>{it.rationale}</p>
                  {it.calc && <p className="font-mono text-xs">{it.calc}</p>}
                  {it.xactimateLine && <p className="text-xs"><span className="font-semibold text-jm-muted">Xactimate line:</span> {it.xactimateLine}</p>}
                  <div className="grid gap-1">{(it.citations || []).map((ci, k) => (
                    <div key={k} className="text-xs"><span className="mr-1.5 font-mono uppercase text-jm-muted">{ci.source}{ci.ref && ` · `}{/^https?:/.test(ci.ref) ? <a className="text-jm-blue" href={ci.ref} target="_blank" rel="noreferrer">link</a> : ci.ref}</span>{ci.quote && `“${ci.quote}”`}</div>))}</div>
                  <Field label="Letter line"><textarea className={`${inputCls} min-h-[60px]`} defaultValue={it.letterLine} disabled={locked} onBlur={(e) => e.target.value !== it.letterLine && patchItem(i, (x) => ({ ...x, letterLine: e.target.value }))} /></Field>
                </td></tr>
              ),
            ];
          })}</tbody>
        </table></div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Review checklist">
          <div className="grid gap-2 sm:grid-cols-2">{(d.checklist || []).map((c, k) => { const [tone, label] = CHECK[c.status] || ["gray", c.status]; return (
            <div key={k} className="grid gap-1 rounded-lg border border-jm-line p-2.5 text-sm"><div className="flex items-center justify-between gap-2"><b>{CATEGORIES[c.category] || c.category}</b><Pill tone={tone}>{label}</Pill></div><span className="text-xs text-jm-muted">{c.note}</span></div>); })}</div>
        </Card>
        <Card title="Measurements and code">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{[["Total", m.totalSQ != null ? `${m.totalSQ} SQ` : "—"], ["Pitch", m.predominantPitch || "—"], ["Eaves", lf(m.eavesLF)], ["Rakes", lf(m.rakesLF)], ["Valleys", lf(m.valleysLF)], ["Ridges", lf(m.ridgeLF)], ["Hips", lf(m.hipsLF)], ["Step flashing", lf(m.stepFlashingLF)], ["Stories", m.stories ?? "—"], ["Suggested waste", m.suggestedWastePct != null ? `${m.suggestedWastePct}%` : "—"]].map(([a, b]) => (
            <div key={a}><dt className="text-[11px] font-semibold uppercase tracking-wider text-jm-muted">{a}</dt><dd className="tabular font-mono">{b}</dd></div>))}</dl>
          {ib && <p className="mt-3 text-xs text-jm-muted">Ice barrier check: {ib.run} in. run at {ib.rise}/12 = {ib.slopeIn} in. up the slope → {ib.courses} course{ib.courses > 1 ? "s" : ""} of 36 in. roll. Eaves {ib.eavesSF.toLocaleString()} SF + valleys {ib.valleysSF.toLocaleString()} SF = {ib.totalSF.toLocaleString()} SF.</p>}
          {d.codeFindings?.length > 0 && <div className="mt-4 grid gap-2">{d.codeFindings.map((c, k) => (
            <div key={k} className="text-sm"><b className="font-mono">{c.section}</b> {c.official ? <Pill tone="green">Official source</Pill> : <Pill tone="amber">Check source</Pill>}
              <div>{c.requirement}</div><div className="text-xs text-jm-muted">{c.jurisdiction}{c.adoptedCode && ` · ${c.adoptedCode}`} {c.url && <a className="text-jm-blue" href={c.url} target="_blank" rel="noreferrer">open</a>}</div></div>))}</div>}
        </Card>
      </div>

      <Card title="Letter to the adjuster" actions={<>
        {!locked && (d.letterOverride != null || letter != null) && <Button size="sm" variant="ghost" onClick={() => { setLetter(null); save({ letterOverride: null }); }}>Rebuild from items</Button>}
        <Button size="sm" onClick={copy}>Copy</Button>
        <Button size="sm" onClick={() => download(`${job.jobNumber || "job"}-supplement-letter.txt`, letterText, "text/plain")}>Download .txt</Button>
        <Button size="sm" onClick={csv}>Items .csv</Button></>}>
        <p className="mb-2 text-xs text-jm-muted">{d.letterOverride != null ? "You edited this letter, so item changes no longer update it." : "Built from the included items. Edits save when you click away."}</p>
        <textarea className={`${inputCls} min-h-[340px] font-mono text-xs`} value={letterText} disabled={locked}
          onChange={(e) => setLetter(e.target.value)} onBlur={() => letter != null && letter !== (d.letterOverride ?? builtLetter) && save({ letterOverride: letter })} />
      </Card>

      {!locked && status === "Needs Review" && (
        <Card title="Review">
          {decide ? (
            <Confirm tone={decide === "Approved" ? "green" : "red"} confirmLabel={decide === "Approved" ? "Approve" : "Reject"} onCancel={() => setDecide(null)} onConfirm={finish}
              text={decide === "Approved"
                ? <><b>{t.itemCount} items, {money(t.pricedRequestedDelta)} priced{t.verifyCount ? `, ${t.verifyCount} with a source to verify` : ""}{t.unsupportedCount ? <span className="text-jm-red">, {t.unsupportedCount} without support</span> : ""}.</b> Approving doesn't send anything. You still send it to the adjuster yourself.</>
                : "Reject this draft? It stays in the run history, marked rejected."}>
              <Field label={decide === "Approved" ? "Note (optional)" : "Reason"}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </Confirm>
          ) : <div className="flex gap-2"><Button variant="green" onClick={() => { setNote(""); setDecide("Approved"); }}>Approve</Button><Button variant="red" onClick={() => { setNote(""); setDecide("Rejected"); }}>Reject</Button></div>}
        </Card>
      )}
      <Card title="What EL JEFFE did"><Log log={d.log} />{d.usage && <p className="mt-3 text-xs text-jm-muted">{d.model} · {(d.usage.input_tokens + d.usage.cache_read_input_tokens + d.usage.cache_creation_input_tokens).toLocaleString()} input / {d.usage.output_tokens.toLocaleString()} output tokens · {d.usage.web_search_requests} web searches</p>}</Card>
    </>
  );
}

function NumCell({ value, onSave, disabled, label, suffix }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <span className="inline-flex items-center gap-1">
      <input className="w-20 rounded-md border border-jm-line px-1.5 py-1 text-right font-mono text-xs" inputMode="decimal" aria-label={label} value={v} disabled={disabled} placeholder="—"
        onChange={(e) => setV(e.target.value)} onBlur={() => { const n = toNum(v); if (n !== toNum(value)) onSave(n); }} />
      {suffix && <span className="text-xs text-jm-muted">{suffix}</span>}
    </span>
  );
}

function Log({ log }) {
  if (!log?.length) return <Empty>No activity yet.</Empty>;
  const sorted = [...log].sort((a, b) => a.ts - b.ts);
  return <div className="grid gap-1 font-mono text-xs">{sorted.map((l, k) => (
    <div key={k} className={`flex gap-2 ${l.type === "error" ? "text-jm-red" : l.type === "validation" ? "text-jm-amber" : ""}`}>
      <span className="shrink-0 text-jm-muted">{new Date(l.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span><span>{l.text}</span></div>))}</div>;
}
