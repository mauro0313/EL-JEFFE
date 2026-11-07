import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import teamFile from "../../team.json";

export { FieldValue };

function normalizeKey(v) {
  let k = String(v || "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\n/g, "\n");
}

export function admin() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = normalizeKey(process.env.FIREBASE_PRIVATE_KEY);
    if (!projectId || !clientEmail || !privateKey) throw new HttpError(500, "The Firebase server key isn't set up in Netlify (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).");
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    });
  }
  return { db: getFirestore(), bucket: getStorage().bucket(), auth: getAuth() };
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TEAM = new Set(teamFile.emails.map((e) => e.trim().toLowerCase()));

/** Verifies the caller's Firebase ID token and that the email is on team.json. */
export async function requireTeam(event) {
  const h = event.headers || {};
  const m = String(h.authorization || h.Authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpError(401, "Sign in again.");
  const { auth } = admin();
  let tok;
  try { tok = await auth.verifyIdToken(m[1]); } catch { throw new HttpError(401, "Your sign-in expired. Reload the page."); }
  const email = String(tok.email || "").toLowerCase();
  if (!tok.email_verified || !TEAM.has(email)) throw new HttpError(403, "This account is not on the team list.");
  return { uid: tok.uid, email };
}

export function json(status, body) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function parseBody(event) {
  try { return JSON.parse(event.body || "{}"); } catch { throw new HttpError(400, "Bad request."); }
}

export const safeId = (s) => /^[A-Za-z0-9_-]{1,64}$/.test(String(s || ""));
