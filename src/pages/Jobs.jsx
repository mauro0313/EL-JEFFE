import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useCollection, useDoc, money, newId, friendlyError } from "../lib/data.js";
import { Button, Card, Empty, Field, StatusPill, inputCls, toast } from "../ui.jsx";
import { go } from "../App.jsx";

export const JOB_STATUS = ["Open", "Supplement in review", "Supplement sent", "Approved by carrier", "Closed"];
const FIELDS = [
  ["jobNumber", "Job number", "text", "3JM2026-1043"], ["customerName", "Customer", "text", ""], ["address", "Street address", "text", ""],
  ["city", "City, state", "text", "Lombard, IL"], ["carrier", "Insurance carrier", "text", ""], ["claimNumber", "Claim number", "text", ""],
  ["dateOfLoss", "Date of loss", "date", ""], ["shingle", "Shingle (manufacturer & line)", "text", "GAF Timberline HDZ"],
  ["overhangIn", "Eave overhang (in)", "number", "12"], ["stories", "Stories", "number", ""],
];

export function JobForm({ job, onDone, user }) {
  const [v, setV] = useState(() => Object.fromEntries([...FIELDS.map(([k]) => [k, job?.[k] ?? ""]), ["notes", job?.notes ?? ""]]));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!v.customerName.trim()) return toast("Add the customer's name.");
    setBusy(true);
    try {
      const num = (x) => (x === "" || x === null ? null : Number(x));
      const body = { ...v, overhangIn: num(v.overhangIn), stories: num(v.stories), updatedAt: Date.now() };
      for (const k of ["jobNumber", "customerName", "address", "city", "carrier", "claimNumber", "shingle"]) body[k] = String(body[k] || "").trim();
      if (job) { await setDoc(doc(db, "jobs", job.id), body, { merge: true }); toast("Job saved"); onDone?.(); }
      else {
        const id = newId();
        if (!body.jobNumber) body.jobNumber = `3JM${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
        await setDoc(doc(db, "jobs", id), { ...body, status: "Open", documents: [], createdAt: Date.now(), createdBy: user.email });
        go(`job/${id}/documents`);
      }
    } catch (err) { toast(friendlyError(err)); } finally { setBusy(false); }
  }
  return (
    <Card title={job ? "Edit job" : "New job"}>
      <form onSubmit={save} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map(([k, label, type, ph]) => (
            <Field key={k} label={label}><input className={inputCls} type={type} value={v[k] ?? ""} onChange={set(k)} placeholder={ph} required={k === "customerName"} /></Field>
          ))}
          <Field label="Notes for EL JEFFE" className="sm:col-span-2 lg:col-span-3">
            <textarea className={`${inputCls} min-h-[80px]`} value={v.notes} onChange={set("notes")} placeholder="Anything the documents don't show: two layers, chimney, skylights, local code notes…" />
          </Field>
        </div>
        <div className="flex gap-2"><Button variant="primary" type="submit" disabled={busy}>{job ? "Save job" : "Create job"}</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
      </form>
    </Card>
  );
}

export default function Jobs({ user }) {
  const { rows: jobs, loading, error } = useCollection("jobs", { order: "createdAt", dir: "desc", max: 500 });
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const review = jobs.filter((j) => j.lastDraft?.status === "Needs Review");
  const open = jobs.filter((j) => j.status !== "Closed");
  const shown = jobs.filter((j) => !q || `${j.jobNumber} ${j.customerName} ${j.address} ${j.city} ${j.claimNumber} ${j.carrier}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-jm-muted">3JM Exteriors</p><h1 className="text-2xl font-extrabold text-jm-navy">Jobs</h1></div>
        <Button variant="primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "New job"}</Button>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-jm-line bg-jm-line sm:grid-cols-3">
        {[["Open jobs", open.length], ["Drafts to review", review.length], ["Requested in drafts to review", money(review.reduce((a, j) => a + (j.lastDraft?.priced || 0), 0))]].map(([l, v]) => (
          <div key={l} className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wider text-jm-muted">{l}</div><div className="tabular text-2xl font-extrabold text-jm-navy">{v}</div></div>
        ))}
      </div>
      {adding && <JobForm user={user} onDone={() => setAdding(false)} />}
      {review.length > 0 && (
        <Card title="Waiting on your review">
          <div className="divide-y divide-jm-line">{review.map((j) => (
            <a key={j.id} href={`#/job/${j.id}/supplement/${j.lastDraft.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:bg-jm-sky">
              <span className="font-mono text-xs text-jm-muted">{j.jobNumber}</span><span className="font-semibold">{j.customerName}</span>
              <span className="ml-auto tabular font-semibold">{money(j.lastDraft.priced)}</span><StatusPill status="Needs Review" />
            </a>))}</div>
        </Card>
      )}
      <Card title="All jobs" actions={<input className={`${inputCls} w-56`} placeholder="Search name, address, claim" value={q} onChange={(e) => setQ(e.target.value)} />}>
        {error ? <Empty>Couldn't load jobs: {friendlyError(error)}</Empty>
          : loading ? <Empty>Loading jobs…</Empty>
          : !jobs.length ? <Empty>No jobs yet. Click <b>New job</b>, upload the carrier estimate and the EagleView or HOVER report, then run EL JEFFE from the Supplement tab.</Empty>
          : (
            <div className="-mx-1 overflow-x-auto"><table className="w-full min-w-[700px] text-sm">
              <thead><tr className="border-b border-jm-line text-left text-[11px] uppercase tracking-wider text-jm-muted">
                <th className="px-2 py-2">Job #</th><th className="px-2">Customer</th><th className="px-2">Address</th><th className="px-2">Carrier · claim</th><th className="px-2">Status</th><th className="px-2">Last EL JEFFE run</th></tr></thead>
              <tbody>{shown.map((j) => (
                <tr key={j.id} className="cursor-pointer border-b border-jm-line/70 hover:bg-jm-sky" onClick={() => go(`job/${j.id}`)}>
                  <td className="px-2 py-2.5 font-mono text-xs">{j.jobNumber}</td><td className="px-2 font-semibold">{j.customerName}</td>
                  <td className="px-2">{[j.address, j.city].filter(Boolean).join(", ")}</td>
                  <td className="px-2">{j.carrier || "—"}<div className="font-mono text-xs text-jm-muted">{j.claimNumber}</div></td>
                  <td className="px-2"><StatusPill status={j.status || "Open"} /></td>
                  <td className="px-2">{j.lastDraft ? <StatusPill status={j.lastDraft.status} /> : <span className="text-jm-muted">—</span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
      </Card>
    </>
  );
}

export function useSettings() {
  const { data } = useDoc("settings/company");
  return { company: "3JM Exteriors", overhangIn: 12, wallIn: 6, letterIntro: "", ...(data || {}) };
}
