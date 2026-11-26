// Checks a running site against an answer key: every page answers with the expected status and shows every short
// field value. Works for a preview, the local WordPress or Drupal, or the Docker WordPress.
//   npm run check:live -- <answer-key.json> <site address>
//   npm run check:live -- outputs/library/private/wordpress-answer-key.json http://localhost:8080
// Exits 1 when any page differs, and lists the first ones.
import { readFile } from 'node:fs/promises';

const [keyFile, base] = process.argv.slice(2);
if (!keyFile || !/^https?:\/\//.test(base ?? '')) {
  console.error('Usage: npm run check:live -- <answer-key.json> <site address, e.g. http://127.0.0.1:9600>');
  process.exit(2);
}
const truth = JSON.parse(await readFile(keyFile, 'utf8'));
const origin = base.replace(/\/+$/, '');
const decode = text => text
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// A WordPress answer key may hold full addresses; check the path on the given site.
const pathOf = url => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

let ok = 0;
const problems = [];
const queue = [...truth.pages];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let page; (page = queue.shift());) {
    const path = pathOf(page.url);
    let status, html = '';
    try {
      const response = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
      status = response.status; html = await response.text();
    } catch (error) { status = `error (${error.cause?.code ?? error.message})`; }
    const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const raw = decode(html);
    const missing = Object.entries(page.fields ?? {})
      .filter(([, value]) => typeof value === 'string' && value && value.length < 300)
      .filter(([, value]) => value.startsWith('/') || /^https?:\/\//.test(value) ? !raw.includes(pathOf(value)) : !text.includes(value.replace(/\s+/g, ' ')))
      .map(([name]) => name);
    const expected = page.status ?? 200;
    if (status === expected && !missing.length) ok++;
    else problems.push(status !== expected ? `${path}: answered ${status}, expected ${expected}` : `${path}: missing ${missing.join(', ')}`);
  }
}));
console.log(`${ok} of ${truth.pages.length} pages match ${keyFile} on ${origin}`);
if (problems.length) { console.log(problems.slice(0, 20).join('\n')); process.exit(1); }
