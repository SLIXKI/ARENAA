// Routing middleware — JSON 404 for unknown /api/* paths.
//
// Why this exists: when the project dropped from 14 to 11 serverless functions to
// fit Vercel's Hobby cap, the `/api/(.*)` rewrite and its catch-all handler went
// with it. Since then an unknown API path fell through to the SPA rewrite and came
// back as index.html with status 200 — an HTML body where a client expects JSON.
//
// The matcher below is a NEGATIVE lookahead: middleware only runs for /api/* paths
// that are NOT one of the real functions. Real routes are never intercepted, so
// this cannot break inference — and if middleware is somehow not picked up, the
// worst case is simply the old behaviour again.
//
// Middleware runs on the edge runtime and does NOT count against the 12-function
// Hobby limit.

export const config = {
  matcher:
    '/api/((?!health$|catalog/sync$|copilot/chat$|copilot/tts$|keys/issue$|keys/revoke$|keys/status$|keys/test$|v1/chat/completions$|v1/models$|anthropic/v1/messages$).*)',
};

const KNOWN_ROUTES = [
  'POST /api/v1/chat/completions',
  'POST /api/anthropic/v1/messages',
  'GET  /api/v1/models',
  'POST /api/keys/issue',
  'POST /api/keys/status',
  'POST /api/keys/revoke',
  'POST /api/keys/test',
  'POST /api/catalog/sync',
  'POST /api/copilot/chat',
  'POST /api/copilot/tts',
  'GET  /api/health',
];

export default function middleware(request: Request): Response {
  let pathname = '/';
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    /* keep the default */
  }

  const body = {
    error: {
      message: `Unknown API route: ${pathname}`,
      type: 'invalid_request_error',
      code: 'not_found',
      hint: 'Check the path — the gateway exposes the routes listed in "routes".',
    },
    routes: KNOWN_ROUTES,
  };

  return new Response(JSON.stringify(body), {
    status: 404,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // Keep CORS open so browser-based clients get the JSON body rather than an
      // opaque network error.
      'access-control-allow-origin': request.headers.get('origin') || '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization,x-api-key,x-gemini-key',
    },
  });
}
