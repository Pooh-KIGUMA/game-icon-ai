import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(body));
}

function visitorId(req) {
  const raw = req.headers?.["x-iconia-visitor"] || "";
  if (typeof raw === "string" && raw.length >= 16 && raw.length <= 128) return raw;
  return crypto.randomUUID();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { success: false });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(res, 503, { success: false, error: "analytics_not_configured" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const eventName = String(body.event || "").slice(0, 80);
    if (!eventName) return json(res, 400, { success: false, error: "event_required" });

    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const row = {
      visitor_id: visitorId(req),
      event_name: eventName,
      path: String(body.path || "").slice(0, 500),
      referrer: String(body.referrer || "").slice(0, 1000),
      metadata,
    };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/site_events`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(`SUPABASE_${r.status}`);
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, { success: true });
  } catch (e) {
    console.error("Iconia analytics error", e);
    return json(res, 500, { success: false });
  }
}
