// POST /.netlify/functions/supplement-start  {jobId, estimateDocId, measurementDocId}
// Checks the caller and the setup, creates the draft, and hands the run to the
// background function (which may take several minutes). Returns {draftId}.
import { admin, requireTeam, json, parseBody, HttpError, safeId } from "../lib/admin.mjs";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") throw new HttpError(405, "Use POST.");
    const user = await requireTeam(event);
    const { jobId, estimateDocId, measurementDocId } = parseBody(event);
    if (![jobId, estimateDocId, measurementDocId].every(safeId)) throw new HttpError(400, "Pick the job's estimate and measurement report.");
    if (estimateDocId === measurementDocId) throw new HttpError(400, "Pick two different documents.");
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, "EL JEFFE isn't connected yet: ANTHROPIC_API_KEY is missing in Netlify (scope: Functions).");

    const { db } = admin();
    const job = await db.doc(`jobs/${jobId}`).get();
    if (!job.exists) throw new HttpError(404, "That job no longer exists.");
    const docs = job.data().documents || [];
    const est = docs.find((d) => d.id === estimateDocId), mea = docs.find((d) => d.id === measurementDocId);
    if (!est || !mea) throw new HttpError(400, "One of those documents was removed. Reload and pick again.");

    const ref = db.collection(`jobs/${jobId}/supplementDrafts`).doc();
    const now = Date.now();
    await ref.set({
      status: "Queued", createdAt: now, updatedAt: now, createdBy: user.email,
      estimateDoc: { id: est.id, name: est.name }, measurementDoc: { id: mea.id, name: mea.name },
      log: [{ ts: now, type: "status", tool: null, text: "EL JEFFE started" }],
    });

    const origin = event.rawUrl ? new URL(event.rawUrl).origin : process.env.URL;
    const res = await fetch(`${origin}/.netlify/functions/supplement-run-background`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: event.headers.authorization || event.headers.Authorization },
      body: JSON.stringify({ jobId, draftId: ref.id, estimateDocId, measurementDocId }),
    });
    if (res.status !== 202 && !res.ok) {
      await ref.update({ status: "Failed", error: "The background worker didn't start. Check that the Netlify plan includes Background Functions.", updatedAt: Date.now() });
      throw new HttpError(502, "EL JEFFE's background worker didn't start. Check that the Netlify plan includes Background Functions.");
    }
    return json(202, { draftId: ref.id });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error("supplement-start", e);
    return json(e.status || 500, { error: e instanceof HttpError ? e.message : "EL JEFFE couldn't start. Try again in a minute." });
  }
};
