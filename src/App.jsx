import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider, missingConfig } from "./firebase.js";
import { TEAM } from "./lib/data.js";
import { Button, Logo, Toaster } from "./ui.jsx";
import Jobs from "./pages/Jobs.jsx";
import Job from "./pages/Job.jsx";
import Knowledge from "./pages/Knowledge.jsx";
import Settings from "./pages/Settings.jsx";

function useRoute() {
  const read = () => (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean).map(decodeURIComponent);
  const [r, setR] = useState(read);
  useEffect(() => { const f = () => { setR(read()); window.scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return r;
}
export const go = (path) => { location.hash = "#/" + path; };

function Screen({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-jm-navy p-4 text-white">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-jm-ink shadow-jm">
        <div className="mb-5 flex items-center gap-2 text-jm-navy"><Logo /><span className="text-lg font-extrabold tracking-wide">3JM <span className="font-semibold text-jm-muted">EXTERIORS</span></span></div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [err, setErr] = useState("");
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), []);

  if (missingConfig.length) return (
    <Screen>
      <h1 className="text-xl font-bold">Almost ready</h1>
      <p className="mt-2 text-sm text-jm-muted">The site is missing these Netlify settings. Add each one under Site configuration → Environment variables (scope: Builds), then redeploy.</p>
      <ul className="mt-3 grid gap-1 font-mono text-sm">{missingConfig.map((k) => <li key={k} className="rounded bg-jm-sky px-2 py-1">{k}</li>)}</ul>
    </Screen>
  );
  if (user === undefined) return <Screen><p className="text-sm text-jm-muted">Loading…</p></Screen>;
  if (!user) return (
    <Screen>
      <h1 className="text-xl font-bold">EL JEFFE</h1>
      <p className="mt-1 text-sm text-jm-muted">3JM's job desk and supplement agent. Sign in with your 3JM Google account.</p>
      <Button variant="navy" className="mt-5 w-full justify-center py-2.5" onClick={async () => {
        setErr("");
        try { await signInWithPopup(auth, googleProvider); }
        catch (e) { setErr(e.code === "auth/unauthorized-domain" ? "This web address isn't allowed to sign in yet. Add it in Firebase → Authentication → Settings → Authorized domains." : e.code === "auth/popup-closed-by-user" ? "" : "Sign-in didn't finish. Try again."); }
      }}>Sign in with Google</Button>
      {err && <p className="mt-3 text-sm text-jm-red">{err}</p>}
    </Screen>
  );
  if (!TEAM.includes(String(user.email || "").toLowerCase())) return (
    <Screen>
      <h1 className="text-xl font-bold">This account is not on the team list</h1>
      <p className="mt-2 text-sm text-jm-muted"><b>{user.email}</b> can't open EL JEFFE yet. Send Claude this email to add it to team.json; the next deploy lets it in.</p>
      <Button className="mt-4" onClick={() => signOut(auth)}>Use a different account</Button>
    </Screen>
  );
  return <Shell user={user} />;
}

function Shell({ user }) {
  const r = useRoute();
  const section = r[0] || "jobs";
  const nav = [["jobs", "Jobs"], ["knowledge", "Knowledge base"], ["settings", "Company & letter"]];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b-[3px] border-jm-orange bg-jm-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <a href="#/" className="flex items-center gap-2"><Logo small /><span className="font-extrabold tracking-wide">3JM</span><span className="hidden text-xs uppercase tracking-widest text-white/60 sm:inline">EL JEFFE</span></a>
          <nav className="flex flex-wrap gap-1">{nav.map(([k, l]) => (
            <a key={k} href={`#/${k}`} className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${section === k || (k === "jobs" && section === "job") ? "bg-jm-navy2 text-white shadow-[inset_0_-2px_0_#FF7900]" : "text-white/70 hover:bg-jm-navy2 hover:text-white"}`}>{l}</a>
          ))}</nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-white/70">
            <span className="hidden sm:inline">{user.email}</span>
            <button className="rounded px-2 py-1 hover:bg-jm-navy2 hover:text-white" onClick={() => signOut(auth)}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-5 px-4 pb-16 pt-5">
        {section === "job" && r[1] ? <Job id={r[1]} tab={r[2] || "overview"} draftId={r[3]} user={user} />
          : section === "knowledge" ? <Knowledge user={user} />
          : section === "settings" ? <Settings />
          : <Jobs user={user} />}
      </main>
      <Toaster />
    </div>
  );
}
