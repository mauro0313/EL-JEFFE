// Minimal Anthropic Messages API client (no SDK), with retries for overload.
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";

export async function createMessage(body, { signal } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error("ANTHROPIC_API_KEY isn't set in Netlify (scope: Functions)."), { userFacing: true });
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, ...body }),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch {}
    lastErr = Object.assign(new Error(`Anthropic ${res.status}: ${String(msg).slice(0, 300)}`), { status: res.status });
    if (res.status === 401) throw Object.assign(new Error("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Netlify."), { userFacing: true });
    if (res.status === 400 && /credit|billing|balance/i.test(msg)) throw Object.assign(new Error("The Anthropic account is out of credit. Add credit in console.anthropic.com > Billing."), { userFacing: true });
    if (![429, 500, 502, 503, 529].includes(res.status)) throw lastErr;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt + Math.random() * 1000));
  }
  throw lastErr;
}

export const textOf = (content) => (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
