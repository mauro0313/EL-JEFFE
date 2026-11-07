import { useEffect, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { friendlyError, TEAM } from "../lib/data.js";
import { Button, Card, Field, inputCls, toast } from "../ui.jsx";
import { useSettings } from "./Jobs.jsx";

export default function Settings() {
  const s = useSettings();
  const [v, setV] = useState(null);
  useEffect(() => { if (!v && s.updatedAt) setV(s); }, [s, v]);
  const val = v || s;
  const set = (k) => (e) => setV({ ...val, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    try {
      await setDoc(doc(db, "settings", "company"), {
        company: String(val.company || "").trim(), email: String(val.email || "").trim(), phone: String(val.phone || "").trim(),
        overhangIn: Number(val.overhangIn) || 12, wallIn: Number(val.wallIn) || 6, letterIntro: String(val.letterIntro || "").trim(), updatedAt: Date.now(),
      }, { merge: true });
      toast("Saved");
    } catch (err) { toast(friendlyError(err)); }
  }
  return (
    <>
      <div><p className="text-xs font-semibold uppercase tracking-widest text-jm-muted">Used in every letter and run</p><h1 className="text-2xl font-extrabold text-jm-navy">Company & letter</h1></div>
      <Card>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Company name"><input className={inputCls} value={val.company || ""} onChange={set("company")} /></Field>
            <Field label="Estimating email"><input className={inputCls} value={val.email || ""} onChange={set("email")} /></Field>
            <Field label="Phone"><input className={inputCls} value={val.phone || ""} onChange={set("phone")} /></Field>
            <Field label="Default eave overhang (in)"><input className={inputCls} type="number" value={val.overhangIn ?? ""} onChange={set("overhangIn")} /></Field>
            <Field label="Exterior wall thickness (in)"><input className={inputCls} type="number" value={val.wallIn ?? ""} onChange={set("wallIn")} /></Field>
          </div>
          <Field label="Letter opening paragraph"><textarea className={`${inputCls} min-h-[140px]`} value={val.letterIntro || ""} onChange={set("letterIntro")} /></Field>
          <div><Button variant="primary" type="submit">Save</Button></div>
        </form>
      </Card>
      <Card title="Team">
        <p className="text-sm text-jm-muted">These Google accounts can sign in. To add or remove someone, send Claude their Google sign-in email; the next deploy updates the list and the security rules.</p>
        <ul className="mt-2 grid gap-1 font-mono text-sm">{TEAM.map((e) => <li key={e}>{e}</li>)}</ul>
      </Card>
    </>
  );
}
