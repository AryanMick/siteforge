import { wordpressStatus } from '@/wordpress/runtime.mjs';
import { apiError, localOnly } from '@/fixture-lab/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// http://127.0.0.1:4400/wp-admin/... opens the same page in the local WordPress. When WordPress is stopped, this page
// offers to start it and then opens the dashboard.
export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    localOnly(request);
    const status = await wordpressStatus();
    const { path = [] } = await params;
    const target = new URL(`wp-admin/${path.map(encodeURIComponent).join('/')}`, `${String(status.url).replace(/\/+$/, '')}/`);
    target.search = new URL(request.url).search;
    if (status.state === 'running') return new Response(null, { status: 307, headers: { Location: target.href, 'Cache-Control': 'no-store' } });
    return new Response(startPage(status.state, status.error, target.href), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) { return apiError(error); }
}

// Values go into the inline script as JSON; "<" is escaped so no value can close the script tag.
const script = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

function startPage(state: string, error: string | null, target: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Start WordPress | SiteForge</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f7; --card: #fff; --text: #1d2327; --muted: #50575e; --line: #dcdcde; --accent: #2271b1; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1d2327; --card: #2c3338; --text: #f0f0f1; --muted: #c3c4c7; --line: #3c434a; --accent: #72aee6; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { box-sizing: border-box; width: min(34rem, calc(100% - 32px)); padding: 28px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { margin: 0 0 16px; color: var(--muted); }
  button { font: inherit; font-weight: 600; padding: 9px 16px; border: 0; border-radius: 4px; background: var(--accent); color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; cursor: progress; }
  a { color: var(--accent); margin-left: 12px; }
  pre { white-space: pre-wrap; font-size: 12px; max-height: 14rem; overflow: auto; padding: 8px; background: var(--bg); border-radius: 4px; }
</style>
</head>
<body>
<main>
  <h1>WordPress is not running</h1>
  <p>Start the local WordPress and this page opens <code>/wp-admin</code>. Log in with <code>admin</code> / <code>password</code> if asked.</p>
  <button id="start" type="button">Start WordPress</button><a href="/">Back to SiteForge</a>
  <p id="note" role="status" style="margin-top:16px"></p>
  <pre id="log" hidden></pre>
</main>
<script>
const target = ${script(target)};
const initial = ${script({ state, error })};
const button = document.getElementById('start');
const note = document.getElementById('note');
const log = document.getElementById('log');
function stopped(message, tail) {
  button.disabled = false;
  note.textContent = message;
  log.hidden = !tail;
  log.textContent = tail || '';
}
async function waitForWordPress() {
  button.disabled = true;
  note.textContent = 'Starting WordPress. The first start downloads WordPress and Elementor and takes about a minute.';
  for (;;) {
    const status = await fetch('/api/wordpress/runtime', { cache: 'no-store' }).then(response => response.json()).catch(() => null);
    if (status && status.state === 'running') { location.replace(target); return; }
    if (!status || status.state !== 'starting') {
      stopped(status && status.error ? 'WordPress did not start: ' + status.error : 'WordPress did not start.', status && status.logTail);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
button.addEventListener('click', async () => {
  button.disabled = true;
  const response = await fetch('/api/wordpress/runtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) }).catch(() => null);
  if (!response || !response.ok) {
    const body = response ? await response.json().catch(() => null) : null;
    stopped((body && body.error) || 'WordPress did not start.');
    return;
  }
  waitForWordPress();
});
if (initial.state === 'starting') waitForWordPress();
else if (initial.state === 'failed') stopped('The last start failed: ' + (initial.error || 'see the log in SiteForge.'));
</script>
</body>
</html>`;
}
