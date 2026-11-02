const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// These are host/CSRF checks, not peer authentication. The server must bind to loopback.
export function isLocalRequest(request: Request, requireOrigin = false): boolean {
  const url = new URL(request.url);
  if (!LOOPBACK.has(url.hostname)) return false;
  const host = request.headers.get('host');
  let publicUrl = url;
  if (host) {
    try { publicUrl = new URL(`${url.protocol}//${host}`); } catch { return false; }
    if (!LOOPBACK.has(publicUrl.hostname) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/') return false;
  }
  const origin = request.headers.get('origin');
  if (requireOrigin && !origin) return false;
  if (origin && origin !== publicUrl.origin) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}

export function isRunId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
