// Revoke a master key — SELF-CONTAINED.
// Global revoke needs KV (KV_REST_API_URL + KV_REST_API_TOKEN, e.g. Vercel KV).
// Without KV: local-only mode (app wipes its copy; distributed copies live till expiry).
import crypto from "node:crypto";
import { inflateSync } from "node:zlib";
import fs from "fs";
import path from "path";

// Vercel: give this function enough wall-clock time for its own internal
// timeouts to fire first, so callers get a real error instead of a platform kill.
export const maxDuration = 10;
export const runtime = "nodejs";

const MASTER_PREFIX = "er1.";

// Master-key secret: never a published constant. Production REQUIRES the env var;
// local dev auto-generates a stable, gitignored, machine-local secret file instead.
const DEV_SECRET_FILE = ".master-key-dev.secret";
function masterSecret(): Buffer {
  const configured = (process.env.MASTER_KEY_SECRET || "").trim();
  if (configured.length >= 16) {
    return crypto.createHash("sha256").update(configured).digest();
  }
  const isProd = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  if (isProd) {
    const err: any = new Error(
      "MASTER_KEY_SECRET is not configured. Refusing to mint or decrypt master keys with a published fallback secret. Set a random MASTER_KEY_SECRET (16+ chars) in the host environment — generate one with: openssl rand -hex 32",
    );
    err.code = "MASTER_KEY_SECRET_MISSING";
    err.status = 503;
    throw err;
  }
  try {
    const file = path.join(process.cwd(), DEV_SECRET_FILE);
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing.length >= 32) return crypto.createHash("sha256").update(existing).digest();
    }
    const generated = crypto.randomBytes(32).toString("hex");
    try { fs.writeFileSync(file, generated + "\n", { mode: 0o600 }); } catch { /* read-only fs */ }
    return crypto.createHash("sha256").update(generated).digest();
  } catch {
    return crypto.createHash("sha256").update(crypto.randomBytes(32)).digest();
  }
}

function kvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvSetEx(key: string, val: string, secs: number): Promise<boolean> {
  try {
    const url = process.env.KV_REST_API_URL as string;
    const tok = process.env.KV_REST_API_TOKEN as string;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", key, val, "EX", String(Math.max(60, Math.floor(secs)))]),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const j: any = await r.json().catch(() => null);
    return j?.result === "OK";
  } catch (e) {
    console.warn("KV SET fail:", (e as any)?.message || e);
    return false;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body || {};
    const cands = [
      req.headers?.["x-master-key"],
      (req.headers?.authorization || "").replace(/^Bearer\s+/i, ""),
      body?.masterKey,
    ];
    const token = cands.find((c) => typeof c === "string" && c.trim().startsWith(MASTER_PREFIX))?.trim() || "";
    if (!token) {
      return res.status(400).json({ revoked: false, error: "Master key (er1...) dalo." });
    }
    let payload: any;
    try {
      const raw = Buffer.from(token.slice(MASTER_PREFIX.length), "base64url");
      if (raw.length < 29) throw new Error("bad");
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(raw.length - 16);
      const ct = raw.subarray(12, raw.length - 16);
      const d = crypto.createDecipheriv("aes-256-gcm", masterSecret(), iv);
      d.setAuthTag(tag);
      payload = JSON.parse(inflateSync(Buffer.concat([d.update(ct), d.final()])).toString("utf8"));
    } catch {
      return res.status(400).json({ revoked: false, error: "Master key invalid hai." });
    }
    const mid = typeof payload?.mid === "string" ? payload.mid : "";
    if (!mid) {
      return res.status(400).json({ revoked: false, error: "Master key invalid hai." });
    }
    if (!kvConfigured()) {
      return res.json({
        revoked: false,
        mode: "local-only",
        message: "KV connected nahi hai — app se key hata do. Global instant-revoke ke liye Vercel KV connect karo (README dekho). Baanti hui copies expiry tak chalengi.",
      });
    }
    const ttlSecs = Math.max(60, Math.floor(((payload.exp || Date.now()) - Date.now()) / 1000));
    const ok = await kvSetEx(`er:revoked:${mid}`, "1", ttlSecs);
    if (!ok) {
      return res.status(502).json({ revoked: false, mode: "kv-error", error: "KV write fail — dobara try karo." });
    }
    return res.json({ revoked: true, mode: "global", mid, message: "Master key turant cut — kahin bhi kaam nahi karegi." });
  } catch (err: any) {
    console.error("keys/revoke error:", err?.message || err);
    if ((err as any)?.code === "MASTER_KEY_SECRET_MISSING") {
      return res.status(503).json({ error: { message: (err as any).message, type: "server_misconfigured", code: "MASTER_KEY_SECRET_MISSING" } });
    }
    return res.status(500).json({ revoked: false, error: "Revoke fail ho gaya" });
  }
}
