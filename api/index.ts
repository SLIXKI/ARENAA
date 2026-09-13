// Catch-all for unmatched /api/* paths — SELF-CONTAINED JSON 404.
// Real endpoints live in their own files (health, ping, v1/*, anthropic/*, keys/*, catalog/*, copilot/*, router/*).
// (Must not import server.ts: cross-file TS imports break Vercel functions here.)
export default function handler(req: any, res: any) {
  res.status(404).json({
    error: {
      message: `Unknown API path: ${req.url || ""}. Available: /api/health, /api/ping, /api/v1/chat/completions, /api/v1/models, /api/anthropic/v1/messages, /api/keys/issue, /api/keys/test, /api/keys/status, /api/keys/revoke, /api/catalog/sync, /api/copilot/chat, /api/copilot/tts, /api/router/inference.`,
      type: "not_found",
    },
  });
}
