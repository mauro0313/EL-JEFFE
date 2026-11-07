// Runs before every build (npm run build). It checks the Netlify settings, installs
// 3JM's security rules from team.json, and loads EL JEFFE's starting knowledge base.
// It prints one "[3JM setup]" line per step. It never prints secret values, and it
// never fails the build: a site with missing settings shows an "Almost ready" screen.
import { readFileSync } from "node:fs";
import { buildFirestoreRules, buildStorageRules } from "./rules.mjs";

const root = new URL("..", import.meta.url);
const team = JSON.parse(readFileSync(new URL("team.json", root), "utf8")).emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
const seed = JSON.parse(readFileSync(new URL("scripts/knowledge-seed.json", root), "utf8"));

const ok = (step, detail = "") => console.log(`[3JM setup] OK        ${step}${detail ? " — " + detail : ""}`);
const notDone = (step, fix) => { console.log(`[3JM setup] NOT DONE  ${step}`); console.log(`[3JM setup]           What to do: ${fix}`); };
const info = (msg) => console.log(`[3JM setup] ${msg}`);

const env = process.env;
const onNetlify = !!env.NETLIFY;
info(`Checking setup${onNetlify ? " on Netlify" : " on this computer"} for ${team.length} team member(s).`);

// 1. Browser (VITE_) settings
const VITE = ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"].map((k) => "VITE_FIREBASE_" + k);
const missingVite = VITE.filter((k) => !String(env[k] || "").trim());
if (missingVite.length) notDone("Firebase web app settings", `add ${missingVite.join(", ")} in Netlify (scope: Builds), then redeploy. Values come from Firebase > Project settings > Your apps.`);
else ok("Firebase web app settings", `project ${env.VITE_FIREBASE_PROJECT_ID}`);

// 2. Server key
const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || "").trim();
const privateKey = normalizeKey(env.FIREBASE_PRIVATE_KEY);
if (!projectId || !clientEmail || !privateKey) {
  const miss = [!projectId && "FIREBASE_PROJECT_ID", !clientEmail && "FIREBASE_CLIENT_EMAIL", !privateKey && "FIREBASE_PRIVATE_KEY"].filter(Boolean);
  notDone("Firebase server key", `add ${miss.join(", ")} in Netlify (scope: All scopes) from the downloaded private key file, then redeploy.`);
  notDone("Security rules", "waiting on the Firebase server key.");
  notDone("Starting knowledge base", "waiting on the Firebase server key.");
  finish();
} else {
  if (!privateKey.includes("BEGIN PRIVATE KEY")) notDone("Firebase server key", "FIREBASE_PRIVATE_KEY should start with -----BEGIN PRIVATE KEY-----. Paste the whole private_key value from the file, without the outer quotes.");
  if (missingVite.length === 0 && env.VITE_FIREBASE_PROJECT_ID !== projectId) notDone("Project match", `VITE_FIREBASE_PROJECT_ID (${env.VITE_FIREBASE_PROJECT_ID}) and FIREBASE_PROJECT_ID (${projectId}) must be the same project.`);
  await runAdmin().catch((e) => { notDone("Firebase server key", `Firebase refused the key (${short(e)}). Generate a new private key and paste the three values again.`); });
  finish();
}

async function runAdmin() {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getSecurityRules } = await import("firebase-admin/security-rules");
  const bucket = String(env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`).trim();
  const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId, storageBucket: bucket }, "setup");
  const db = getFirestore(app);
  try { await db.collection("settings").limit(1).get(); ok("Firebase server key", clientEmail.replace(/^(.{4}).*(@.*)$/, "$1…$2")); }
  catch (e) {
    if (/NOT_FOUND|does not exist/i.test(String(e))) { notDone("Firestore database", "in Firebase, open Build > Firestore Database > Create database (production mode, us-central1), then redeploy."); return; }
    throw e;
  }
  if (!team.length) notDone("Team list", "team.json has no emails, so nobody could sign in. Send Claude the emails to add.");

  const rules = getSecurityRules(app);
  try { await rules.releaseFirestoreRulesetFromSource(buildFirestoreRules(team)); ok("Database security rules", `${team.length} team member(s)`); }
  catch (e) { notDone("Database security rules", `couldn't install them (${short(e)}). In Google Cloud IAM, give ${clientEmail} the "Firebase Rules Admin" role, or check that Firestore is turned on.`); }
  try { await rules.releaseStorageRulesetFromSource(buildStorageRules(team), bucket); ok("File storage security rules", bucket); }
  catch (e) { notDone("File storage security rules", `couldn't install them for bucket ${bucket} (${short(e)}). Turn on Build > Storage in Firebase (needs the Blaze plan) and check VITE_FIREBASE_STORAGE_BUCKET.`); }

  try {
    const sref = db.doc("settings/company");
    if (!(await sref.get()).exists) await sref.set({ ...seed.settings, createdAt: Date.now(), updatedAt: Date.now() });
    const existing = new Set((await db.collection("knowledge").select().get()).docs.map((d) => d.id));
    const add = seed.knowledge.filter((k) => !existing.has(k.id));
    if (add.length) { const b = db.batch(); for (const { id, ...k } of add) b.set(db.doc(`knowledge/${id}`), { ...k, createdAt: Date.now(), updatedAt: Date.now(), createdBy: "setup" }); await b.commit(); }
    ok("Starting knowledge base", add.length ? `added ${add.length} entr${add.length === 1 ? "y" : "ies"}` : "already loaded; your edits are kept");
  } catch (e) { notDone("Starting knowledge base", `couldn't write it (${short(e)}).`); }
}

function finish() {
  if (onNetlify) info("ANTHROPIC_API_KEY is only visible to functions (scope: Functions), so it's checked when EL JEFFE first runs, not here.");
  info("Done. Lines marked NOT DONE say what to fix; fix them, then redeploy.");
}
function normalizeKey(v) {
  let k = String(v || "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\n/g, "\n");
}
function short(e) { return String(e?.message || e).split("\n")[0].replace(/-----BEGIN[^-]*-----[\s\S]*?-----END[^-]*-----/g, "[key]").slice(0, 160); }
