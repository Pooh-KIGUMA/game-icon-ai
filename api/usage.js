import crypto from "node:crypto";

const DAILY_LIMIT = 3;
const COOKIE = "iconia_uid";

function getCookie(req, name) {
  const raw = req.headers?.cookie || "";
  const found = raw.split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function newId() {
  return crypto.randomUUID();
}

function dayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Phase 1: anonymous device-level limit. This is intentionally a soft limit until
// proper account authentication + durable database billing is added.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "GETのみ対応しています。" });
  const uid = getCookie(req, COOKIE) || newId();
  const key = `${dayKey()}:${uid}`;
  // Durable storage is intentionally not faked here. The frontend receives the
  // identifier and can show the product UI, while the real server-side counter
  // will be connected when authentication/database is introduced.
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(uid)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
  return res.status(200).json({ success: true, dailyLimit: DAILY_LIMIT, used: 0, remaining: DAILY_LIMIT, reset: dayKey(), softLimit: true, key });
}
