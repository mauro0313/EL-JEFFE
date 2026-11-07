// Background function (name ends in -background): Netlify answers 202 right away
// and lets this run for up to 15 minutes. Progress and results go to Firestore.
import { requireTeam, parseBody, safeId, admin } from "../lib/admin.mjs";
import { runSupplement } from "../lib/agent.mjs";

export const handler = async (event) => {
  let body = {};
  try {
    body = parseBody(event);
    const user = await requireTeam(event);
    const { jobId, draftId, estimateDocId, measurementDocId } = body;
    if (![jobId, draftId, estimateDocId, measurementDocId].every(safeId)) return;
    const snap = await admin().db.doc(`jobs/${jobId}/supplementDrafts/${draftId}`).get();
    if (!snap.exists || snap.data().status !== "Queued") return; // only start a queued run, once
    await runSupplement({ jobId, draftId, estimateDocId, measurementDocId, user });
  } catch (e) {
    console.error("supplement-run-background", body.jobId, body.draftId, e?.message || e);
  }
};
