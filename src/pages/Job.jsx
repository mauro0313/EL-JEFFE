import { useEffect, useRef, useState } from "react";
import { doc, updateDoc, deleteDoc, arrayUnion, collection, addDoc, getDocs } from "firebase/firestore";
import { ref as sref, uploadBytesResumable, deleteObject, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase.js";
import { useDoc, useCollection, callFunction, money, when, newId, friendlyError } from "../lib/data.js";
import { Button, Card, Confirm, Empty, Field, StatusPill, inputCls, toast } from "../ui.jsx";
import { JobForm, JOB_STATUS, useSettings } from "./Jobs.jsx";
import Draft from "./Draft.jsx";
import { go } from "../App.jsx";

const KINDS = { estimate: "Carrier estimate", measurement: "Measurement report", photos: "Photos", other: "Other" };
const guessKind = (n) => { n = n.toLowerCase(); return /eagle|hover|measure|roofr|geo|pitch|report/.test(n) ? "measurement" : /estimate|xact|carrier|insur|claim|scope|loss/.test(n) ? "estimate" : /\.(jpe?g|png|webp)$/.test(n) ? "photos" : "other"; };
export const runStatus = (d) => ((d.status === "Running" || d.status === "Queued") && Date.now() - (d.updatedAt || d.createdAt) > 16 * 60 * 1000 ? "Interrupted" : d.status);

export default function Job({ id, tab, draftId, user }) {
  const { data: job, loading } = useDoc(`jobs/${id}`);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  if (loading) return <Card><p className="text-sm text-jm-muted">Loading job…</p></Card>;
  if (!job) return <Card><p>This job no longer exists.</p><a className="mt-2 inline-block text-sm text-jm-blue" href="#/">Back to jobs</a></Card>;
  const tabs = [["overview", "Overview"], ["documents", `Documents (${(job.documents || []).length})`], ["supplement", "Supplement"], ["ask", "Ask EL JEFFE"]];
  return (
    <>
      <div className="text-xs text-jm-muted"><a href="#/" className="hover:underline">Jobs</a> / <span className="font-mono">{job.jobNumber}</span></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-jm-muted">{job.carrier || "No carrier"} · claim <span className="font-mono">{job.claimNumber || "—"}</span></p>
          <h1 className="text-2xl font-extrabold text-jm-navy">{job.customerName}</h1>
          <p className="text-sm text-jm-muted">{[job.address, job.city].filter(Boolean).join(", ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={`${inputCls} w-auto`} value={job.status || "Open"} aria-label="Job status"
            onChange={(e) => updateDoc(doc(db, "jobs", id), { status: e.target.value, updatedAt: Date.now() }).catch((err) => toast(friendlyError(err)))}>
            {JOB_STATUS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <Button onClick={() => setEditing(!editing)}>Edit</Button>
          <Button variant="ghost" onClick={() => setConfirmDel(true)}>Delete</Button>
        </div>
      </div>
      {confirmDel && <Confirm text="Delete this job, its documents, EL JEFFE drafts and chat? This can't be undone." confirmLabel="Delete job" onCancel={() => setConfirmDel(false)} onConfirm={() => deleteJob(id, job)} />}
      {editing && <JobForm job={{ ...job, id }} user={user} onDone={() => setEditing(false)} />}
      <nav className="flex flex-wrap gap-1 border-b border-jm-line">{tabs.map(([k, l]) => (
        <a key={k} href={`#/job/${id}/${k}`} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-jm-orange text-jm-navy" : "border-transparent text-jm-muted hover:text-jm-ink"}`}>{l}</a>
      ))}</nav>
      {tab === "documents" ? <Documents job={{ ...job, id }} />
        : tab === "supplement" ? (draftId ? <Draft job={{ ...job, id }} draftId={draftId} user={user} /> : <Supplement job={{ ...job, id }} />)
        : tab === "ask" ? <Ask job={{ ...job, id }} user={user} />
        : <Overview job={{ ...job, id }} />}
    </>
  );
}

async function deleteJob(id, job) {
  try {
    for (const d of job.documents || []) await deleteObject(sref(storage, d.path)).catch(() => {});
    for (const sub of ["supplementDrafts", "chat"]) { const s = await getDocs(collection(db, "jobs", id, sub)); for (const d of s.docs) await deleteDoc(d.ref); }
    await deleteDoc(doc(db, "jobs", id));
    toast("Job deleted"); go("");
  } catch (e) { toast(friendlyError(e)); }
}

function Overview({ job }) {
  const s = useSettings();
  const rows = [["Job number", job.jobNumber], ["Date of loss", job.dateOfLoss || "—"], ["Shingle", job.shingle || "—"], ["Eave overhang", `${job.overhangIn ?? s.overhangIn} in`], ["Stories", job.stories || "—"], ["Created", when(job.createdAt)]];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Job details" className="lg:col-span-2">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{rows.map(([k, v]) => <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-jm-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
        {job.notes && <p className="mt-4 whitespace-pre-wrap text-sm">{job.notes}</p>}
      </Card>
      <Card title="Next step">
        {!(job.documents || []).length ? <p className="text-sm">Upload the carrier estimate and the measurement report. <a className="text-jm-blue" href={`#/job/${job.id}/documents`}>Go to documents</a></p>
          : job.lastDraft ? <p className="text-sm">Last EL JEFFE run: <StatusPill status={job.lastDraft.status} />{job.lastDraft.priced != null && <> · {money(job.lastDraft.priced)} requested</>}. <a className="text-jm-blue" href={`#/job/${job.id}/supplement/${job.lastDraft.id}`}>Open it</a></p>
          : <p className="text-sm">Documents are in. <a className="text-jm-blue" href={`#/job/${job.id}/supplement`}>Run EL JEFFE</a></p>}
      </Card>
    </div>
  );
}

function Documents({ job }) {
  const [progress, setProgress] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const input = useRef();
  const docs = job.documents || [];
  async function upload(files) {
    for (const file of files) {
      const okType = file.type === "application/pdf" || /^image\/(jpeg|png|webp)$/.test(file.type);
      if (!okType) { toast(`${file.name}: upload a PDF or a JPG/PNG photo.`); continue; }
      if (file.size > 30 * 1024 * 1024) { toast(`${file.name} is over 30 MB.`); continue; }
      const id = newId();
      const path = `documents/${job.id}/${id}-${file.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
      try {
        await new Promise((res, rej) => {
          const t = uploadBytesResumable(sref(storage, path), file, { contentType: file.type });
          t.on("state_changed", (s) => setProgress(`${file.name}: ${Math.round((s.bytesTransferred / s.totalBytes) * 100)}%`), rej, res);
        });
        await updateDoc(doc(db, "jobs", job.id), { documents: arrayUnion({ id, name: file.name, kind: guessKind(file.name), path, size: file.size, contentType: file.type, uploadedAt: Date.now() }), updatedAt: Date.now() });
      } catch (e) { toast(friendlyError(e)); }
    }
    setProgress(null);
  }
  const setKind = (d, kind) => updateDoc(doc(db, "jobs", job.id), { documents: docs.map((x) => (x.id === d.id ? { ...x, kind } : x)), updatedAt: Date.now() }).catch((e) => toast(friendlyError(e)));
  async function remove(d) {
    try { await deleteObject(sref(storage, d.path)).catch(() => {}); await updateDoc(doc(db, "jobs", job.id), { documents: docs.filter((x) => x.id !== d.id), updatedAt: Date.now() }); setConfirm(null); }
    catch (e) { toast(friendlyError(e)); }
  }
  async function open(d) { try { window.open(await getDownloadURL(sref(storage, d.path)), "_blank", "noopener"); } catch (e) { toast(friendlyError(e)); } }
  return (
    <Card title="Documents" actions={<>
      <input ref={input} type="file" multiple hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { const f = [...e.target.files]; e.target.value = ""; upload(f); }} />
      <Button variant="navy" disabled={!!progress} onClick={() => input.current.click()}>{progress || "Upload PDF or photos"}</Button></>}>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload([...e.dataTransfer.files]); }}>
        {!docs.length ? <Empty>Drop the carrier's estimate and the EagleView or HOVER report here (PDF). Scanned PDFs and photos work too; EL JEFFE reads them directly.</Empty> : (
          <div className="grid gap-2">{docs.map((d) => (
            <div key={d.id} className="grid gap-2 rounded-xl border border-jm-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button className="min-w-0 flex-1 break-all text-left font-semibold text-jm-blue hover:underline" onClick={() => open(d)}>{d.name}</button>
                <select className={`${inputCls} w-auto`} value={d.kind} onChange={(e) => setKind(d, e.target.value)} aria-label="Document type">{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(d.id)}>Remove</Button>
              </div>
              <div className="text-xs text-jm-muted">{Math.round((d.size || 0) / 1024).toLocaleString()} KB · added {when(d.uploadedAt)}</div>
              {confirm === d.id && <Confirm text={`Remove ${d.name}?`} confirmLabel="Remove" onCancel={() => setConfirm(null)} onConfirm={() => remove(d)} />}
            </div>))}</div>
        )}
      </div>
    </Card>
  );
}

function Supplement({ job }) {
  const docs = job.documents || [];
  const [est, setEst] = useState(() => (docs.find((d) => d.kind === "estimate") || {}).id || "");
  const [mea, setMea] = useState(() => (docs.find((d) => d.kind === "measurement") || {}).id || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { rows: runs } = useCollection(`jobs/${job.id}/supplementDrafts`, { order: "createdAt", dir: "desc", max: 50 });
  const running = runs.some((r) => ["Queued", "Running"].includes(runStatus(r)));
  async function start() {
    setBusy(true); setErr("");
    try { const { draftId } = await callFunction("supplement-start", { jobId: job.id, estimateDocId: est, measurementDocId: mea }); go(`job/${job.id}/supplement/${draftId}`); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const opts = docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>);
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card title="Run EL JEFFE" className="lg:col-span-3">
        <p className="text-sm text-jm-muted">EL JEFFE reads the carrier estimate against the measurement report, looks up the town's adopted building code, and drafts the supplement for you to approve. A run takes about 2–6 minutes. Nothing goes to the adjuster until you send it.</p>
        {!docs.length ? <div className="mt-3"><Empty>Upload the documents first. <a className="text-jm-blue" href={`#/job/${job.id}/documents`}>Go to documents</a></Empty></div> : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Carrier estimate"><select className={inputCls} value={est} onChange={(e) => setEst(e.target.value)}><option value="">Choose…</option>{opts}</select></Field>
            <Field label="Measurement report"><select className={inputCls} value={mea} onChange={(e) => setMea(e.target.value)}><option value="">Choose…</option>{opts}</select></Field>
          </div>)}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy || running || !est || !mea || est === mea} onClick={start}>{busy ? "Starting…" : running ? "EL JEFFE is working…" : "🚀 Run EL JEFFE"}</Button>
          {est && mea && est === mea && <span className="text-sm text-jm-muted">Pick two different documents.</span>}
        </div>
        {err && <p className="mt-3 text-sm text-jm-red">{err}</p>}
      </Card>
      <Card title="Runs" className="lg:col-span-2">
        {!runs.length ? <p className="text-sm text-jm-muted">No runs yet.</p> : (
          <div className="divide-y divide-jm-line">{runs.map((r) => (
            <a key={r.id} href={`#/job/${job.id}/supplement/${r.id}`} className="flex flex-wrap items-center gap-2 py-2 text-sm hover:bg-jm-sky">
              <span className="text-jm-muted">{when(r.createdAt)}</span><StatusPill status={runStatus(r)} />
              <span className="ml-auto tabular font-semibold">{r.totals ? money(r.totals.pricedRequestedDelta) : ""}</span>
            </a>))}</div>)}
      </Card>
    </div>
  );
}

function Ask({ job, user }) {
  const { rows: msgs } = useCollection(`jobs/${job.id}/chat`, { order: "createdAt", max: 200 });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length]);
  const last = msgs[msgs.length - 1];
  const waiting = last && last.role === "user" && Date.now() - last.createdAt < 3 * 60 * 1000;
  async function send(e) {
    e.preventDefault();
    const q = text.trim(); if (!q) return;
    setSending(true);
    try {
      const r = await addDoc(collection(db, "jobs", job.id, "chat"), { role: "user", text: q, by: user.email, createdAt: Date.now() });
      setText("");
      await callFunction("ask-background", { jobId: job.id, msgId: r.id });
    } catch (err) { toast(friendlyError(err)); } finally { setSending(false); }
  }
  return (
    <Card title="Ask EL JEFFE about this claim">
      <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
        {!msgs.length && <p className="text-sm text-jm-muted">EL JEFFE reads this job's estimate and report, the latest draft, and your knowledge base. Try “What did the carrier pay for drip edge?” or “Write the adjuster a short email asking for a re-inspection.”</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto max-w-[85%] bg-blue-50" : m.error ? "max-w-[95%] bg-red-50 text-jm-red" : "max-w-[95%] bg-jm-sky"}`}>
            {m.role !== "user" && <div className="mb-0.5 text-[11px] font-bold tracking-widest text-jm-orange">EL JEFFE</div>}{m.text}
          </div>))}
        {waiting && <div className="max-w-[95%] rounded-xl bg-jm-sky px-3 py-2 text-sm text-jm-muted">EL JEFFE is thinking…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this claim" disabled={sending || waiting} />
        <Button variant="navy" type="submit" disabled={sending || waiting || !text.trim()}>Ask</Button>
      </form>
    </Card>
  );
}
