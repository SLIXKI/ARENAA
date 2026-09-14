
// Vercel: give this function enough wall-clock time for its own internal
// timeouts to fire first, so callers get a real error instead of a platform kill.
export const maxDuration = 10;
// Single-gateway health check (zero-dependency serverless function).
export default function handler(_req: any, res: any) {
  res.status(200).json({
    status: "ok",
    hasServerApiKey: !!process.env.GEMINI_API_KEY,
  });
}
