// Master key status — SELF-CONTAINED. Keys NEVER returned (counts + gmails only).
// Master key via Authorization Bearer / x-master-key header / body.masterKey.
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

export default async function handler(req: any, res: any) {
  try {
    const cands = [
      req.headers?.["x-master-key"],
      (req.headers?.authorization || "").replace(/^Bearer\s+/i, ""),
      req.body?.masterKey,
    ];
    const token = cands.find((c) => typeof c === "string" && c.trim().startsWith(MASTER_PREFIX))?.trim() || "";
    if (!token) {
      return res.status(401).json({ valid: false, error: "Master key (er1...) dalo." });
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
    } catch (err: any) {
      // Distinguish "your token is bad" from "this server is misconfigured".
      if (err?.code === "MASTER_KEY_SECRET_MISSING") {
        return res.status(503).json({ valid: false, error: err.message, code: err.code });
      }
      return res.status(401).json({ valid: false, error: "Master key invalid hai (tutli-phutli ya galat secret)." });
    }
    if (!payload || payload.v !== 1 || typeof payload.exp !== "number" || typeof payload.keys !== "object") {
      return res.status(401).json({ valid: false, error: "Master key invalid hai." });
    }
    if (payload.exp <= Date.now()) {
      return res.status(401).json({ valid: false, expired: true, error: "Master key expire ho gayi — Regenerate karo." });
    }
    const providers: Record<string, { count: number; gmails: string[] }> = {};
    for (const pid of Object.keys(payload.keys || {})) {
      const arr = Array.isArray(payload.keys[pid]) ? payload.keys[pid] : [];
      providers[pid] = {
        count: arr.length,
        gmails: [...new Set(arr.map((e: any) => (typeof e?.g === "string" ? e.g : "")).filter(Boolean))],
      };
    }
    return res.json({
      valid: true,
      mid: payload.mid || "",
      label: payload.label || "",
      expiresAt: payload.exp,
      providers,
    });
  } catch (err: any) {
    console.error("keys/status error:", err?.message || err);
    if ((err as any)?.code === "MASTER_KEY_SECRET_MISSING") {
      return res.status(503).json({ error: { message: (err as any).message, type: "server_misconfigured", code: "MASTER_KEY_SECRET_MISSING" } });
    }
    return res.status(500).json({ valid: false, error: "Status fail ho gaya" });
  }
}
