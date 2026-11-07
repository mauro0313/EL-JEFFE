import { useState } from "react";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useCollection, friendlyError } from "../lib/data.js";
import { Button, Card, Confirm, Empty, Field, Pill, inputCls, toast } from "../ui.jsx";

const TYPES = { argument: "Argument", price: "Price list", code: "Building code", manufacturer: "Manufacturer spec", carrier: "Carrier note", other: "Other" };

export default function Knowledge({ user }) {
  const { rows, loading } = useCollection("knowledge", { order: "title" });
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState("");
  const list = rows.filter((k) => !filter || k.category === filter);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-jm-muted">What EL JEFFE knows</p><h1 className="text-2xl font-extrabold text-jm-navy">Knowledge base</h1></div>
        <Button variant="primary" onClick={() => setEdit({})}>Add entry</Button>
      </div>
      <p className="max-w-3xl text-sm text-jm-muted">EL JEFFE reads every entry on each run and argues only what it can back with these entries, the job's documents and official code pages it finds. Mark an entry <b>Needs source</b> until you've confirmed it; items that lean on it get flagged “Verify source.” Prices: one per line as <span className="font-mono">Xactimate line | unit | price</span>.</p>
      {edit && <Editor entry={edit} user={user} onDone={() => setEdit(null)} />}
      <Card actions={<select className={`${inputCls} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by type"><option value="">All types ({rows.length})</option>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l} ({rows.filter((r) => r.category === k).length})</option>)}</select>}>
        {loading ? <Empty>Loading…</Empty> : !list.length ? <Empty>No entries yet. The first deploy loads EL JEFFE's starting entries; add your own arguments, prices and code sections here.</Empty> : (
          <div className="divide-y divide-jm-line">{list.map((k) => (
            <div key={k.id} className="grid gap-1.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><b>{k.title}</b>
                <div className="flex flex-wrap items-center gap-1.5"><Pill>{TYPES[k.category] || k.category}</Pill>{k.status === "needs_source" ? <Pill tone="amber">Needs source</Pill> : <Pill tone="green">Verified</Pill>}<Button size="sm" variant="ghost" onClick={() => setEdit(k)}>Edit</Button></div></div>
              {k.source && <p className="text-xs text-jm-muted">{k.source}</p>}
              {k.body && <p className="whitespace-pre-wrap text-sm">{k.body}</p>}
              <p className="font-mono text-[11px] text-jm-muted">{k.id}</p>
            </div>))}</div>)}
      </Card>
    </>
  );
}

function Editor({ entry, user, onDone }) {
  const [v, setV] = useState({ title: "", category: "argument", status: "verified", source: "", body: "", ...entry });
  const [del, setDel] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!v.title.trim()) return toast("Give the entry a title.");
    const id = entry.id || (v.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "entry") + "-" + Date.now().toString(36).slice(-4);
    try {
      await setDoc(doc(db, "knowledge", id), { title: v.title.trim(), category: v.category, status: v.status, source: v.source.trim(), body: v.body.trim(), updatedAt: Date.now(), updatedBy: user.email, ...(entry.id ? {} : { createdAt: Date.now() }) }, { merge: true });
      toast("Entry saved"); onDone();
    } catch (err) { toast(friendlyError(err)); }
  }
  return (
    <Card title={entry.id ? "Edit entry" : "New entry"}>
      <form onSubmit={save} className="grid gap-3">
        <Field label="Title"><input className={inputCls} value={v.title} onChange={set("title")} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type"><select className={inputCls} value={v.category} onChange={set("category")}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Status"><select className={inputCls} value={v.status} onChange={set("status")}><option value="verified">Verified</option><option value="needs_source">Needs source</option></select></Field>
        </div>
        <Field label="Source"><input className={inputCls} value={v.source} onChange={set("source")} placeholder="Our supplement on the Feb 2025 hail claim, line 24" /></Field>
        <Field label="What it says"><textarea className={`${inputCls} min-h-[140px]`} value={v.body} onChange={set("body")} /></Field>
        <div className="flex flex-wrap gap-2"><Button variant="primary" type="submit">Save entry</Button><Button variant="ghost" onClick={onDone}>Cancel</Button>
          {entry.id && <Button variant="ghost" className="ml-auto" onClick={() => setDel(true)}>Delete</Button>}</div>
        {del && <Confirm text={`Delete “${entry.title}”?`} confirmLabel="Delete" onCancel={() => setDel(false)} onConfirm={async () => { try { await deleteDoc(doc(db, "knowledge", entry.id)); toast("Entry deleted"); onDone(); } catch (e) { toast(friendlyError(e)); } }} />}
      </form>
    </Card>
  );
}
