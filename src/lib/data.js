import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, orderBy, limit as qlimit } from "firebase/firestore";
import { db, auth } from "../firebase.js";
import team from "../../team.json";

export const TEAM = team.emails.map((e) => e.trim().toLowerCase());

/** Live collection. Returns {rows, loading, error}. path is a string; key changes resubscribe. */
export function useCollection(path, { order, dir = "asc", max } = {}) {
  const [state, set] = useState({ rows: [], loading: true, error: null });
  useEffect(() => {
    if (!path) return;
    set((s) => ({ ...s, loading: true }));
    const parts = [collection(db, path)];
    if (order) parts.push(orderBy(order, dir));
    if (max) parts.push(qlimit(max));
    return onSnapshot(query(...parts),
      (snap) => set({ rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null }),
      (error) => set({ rows: [], loading: false, error }));
  }, [path, order, dir, max]);
  return state;
}

export function useDoc(path) {
  const [state, set] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!path) return;
    return onSnapshot(doc(db, path),
      (s) => set({ data: s.exists() ? { id: s.id, ...s.data() } : null, loading: false, error: null }),
      (error) => set({ data: null, loading: false, error }));
  }, [path]);
  return state;
}

/** Calls a Netlify function as the signed-in user. Throws Error(message) on failure. */
export async function callFunction(name, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 202 || res.ok) return res.headers.get("content-type")?.includes("json") ? res.json().catch(() => ({})) : {};
  let msg = `Request failed (${res.status}).`;
  try { msg = (await res.json()).error || msg; } catch {}
  throw new Error(msg);
}

export const money = (n) => (typeof n === "number" && Number.isFinite(n) ? (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
export const qty = (n) => (typeof n === "number" && Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—");
export const when = (t) => (t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
export const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function friendlyError(e) {
  const code = e?.code || "";
  if (code.includes("permission-denied")) return "You don't have access to change this. Make sure you're signed in with a team account.";
  if (code.includes("unavailable")) return "You're offline or Firebase isn't reachable. Changes will save when you reconnect.";
  if (code.includes("storage/unauthorized")) return "That file wasn't accepted. Upload a PDF or a JPG/PNG photo under 30 MB.";
  return e?.message || "Something went wrong. Try again.";
}
