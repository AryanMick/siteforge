import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { crawlSite, normalizeCrawlUrl, privateAddress, pinnedLookup, redirectTarget, scopeReason } from '../src/real-crawler.mjs';

async function fixture(routes,run){
  const hits=[];const server=createServer(async(req,res)=>{
    hits.push(req.url);const route=routes[req.url];
    if(!route){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
    if(typeof route==='function'){await route(req,res);return;}
    res.writeHead(200,{'Content-Type':req.url==='/robots.txt'?'text/plain':'text/html'});res.end(route);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{await run(`http://127.0.0.1:${server.address().port}`,hits);}
  finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
}
const options={allowLocal:true,delayMs:0,timeoutMs:1000,maxTimeMs:10000,maxPages:8};
const html=(body)=>`<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main><h1>Fixture</h1>${body}</main></body></html>`;

test('legacy HTML with missing or generic MIME headers is recovered with explicit evidence', async () => {
  const response = (body, contentType) => (req, res) => {
    res.writeHead(200, contentType ? { 'Content-Type': contentType } : {}); res.end(body);
  };
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': html('<a href="/missing">Missing</a><a href="/plain">Plain</a><a href="/generic">Generic</a>'),
    '/missing': response(html('<p>Missing header</p>')),
    '/plain': response('<!-- Old export -->\n' + html('<p>Plain header</p>'), 'text/plain; charset=utf-8'),
    '/generic': response(html('<p>Generic header</p>'), 'application/octet-stream'),
  }, async url => {
    const run = await crawlSite(url, options);
    assert.equal(run.pages.length, 4);
    for (const page of run.pages.slice(1)) {
      assert.equal(page.fetch.htmlDetected, true);
      assert(page.issues.some(issue => issue.code === 'html-content-type-recovered'));
    }
    assert.equal(run.pages[0].fetch.htmlDetected, false);
    assert.equal(run.pages[1].fetch.contentType, '');
    assert.equal(run.summary.allEligibleAnalyzed, true);
  });
});

test('MIME recovery does not reinterpret binary, JSON, explicit image or nosniff responses as HTML', async () => {
  const response = (body, contentType, extra = {}) => (req, res) => {
    res.writeHead(200, { 'Content-Type': contentType, ...extra }); res.end(body);
  };
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': html('<a href="/binary">Binary</a><a href="/json">JSON</a><a href="/image">Image</a><a href="/plain">Text</a><a href="/nosniff">No sniff</a>'),
    '/binary': response(Buffer.from([0, 1, 2, 60, 104, 116, 109, 108, 62]), 'application/octet-stream'),
    '/json': response('{"html":"<html>example</html>"}', 'application/json'),
    '/image': response(html('Not HTML by policy'), 'image/png'),
    '/plain': response('Example code: <html><body>hello</body></html>', 'text/plain'),
    '/nosniff': response(html('Do not reinterpret'), 'text/plain', { 'X-Content-Type-Options': 'nosniff' }),
  }, async url => {
    const run = await crawlSite(url, options);
    assert.equal(run.pages.length, 1);
    assert.equal(run.summary.counts.skipped, 5);
    assert.equal(run.summary.allEligibleAnalyzed, false);
    assert(run.urls.filter(item => item.state === 'skipped').every(item => item.reason === 'non_html_response'));
  });
});

test('legacy frame discovery follows public documents but never restricted or external sources', async () => {
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': '<!doctype html><html lang="en"><head><title>Archive</title></head><frameset><frame src="/record"><frame src="/private/answers"><frame src="https://example.test/external"></frameset></html>',
    '/record': '<html><head><title>Record</title></head><body><h1>Old Record</h1><p><font><b>Author:</b></font> Mara Vale<br><b>Year:</b> 1984</p></body></html>',
  }, async (url, hits) => {
    const run = await crawlSite(url, options);
    assert.equal(run.pages.length, 2);
    assert.equal(run.pages[1].fields.author, 'Mara Vale');
    assert.equal(run.pages[1].fields.year, '1984');
    assert(!hits.includes('/private/answers'));
    assert(run.network.every(entry => new URL(entry.url).origin === url));
    assert.equal(run.summary.counts.skipped, 2);
    assert.equal(run.summary.allEligibleAnalyzed, true);
  });
});

test('recoverable MIME responses still obey the response-byte budget', async () => {
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(html('x'.repeat(1000))); },
  }, async url => {
    const run = await crawlSite(url, { ...options, maxPageBytes: 256 });
    assert.equal(run.pages.length, 0);
    assert.equal(run.urls[0].reason, 'page_byte_budget');
  });
});

test('real crawl respects robots, skips auth/private/external and continues past an HTTP failure',async()=>{
  await fixture({
    '/robots.txt':'User-agent: *\nDisallow: /blocked\n',
    '/':html('<a href="/book">Book</a><a href="/blocked">Blocked</a><a href="/login">Login</a><a href="/private/ground-truth.json">Private</a><a href="https://example.com/">External</a><a href="/broken">Broken</a>'),
    '/book':html('<dl><dt>Author</dt><dd>Avery Cole</dd></dl>'),
    '/blocked':html('never'),'/login':html('never'),
  },async(url,hits)=>{
    const run=await crawlSite(url,options);
    assert.equal(run.pages.length,2);assert.equal(run.summary.counts.failed,1);
    assert.equal(run.summary.frontierExhausted,true);assert.equal(run.summary.allEligibleAnalyzed,false);assert.equal(run.summary.completeFrontier,false);
    assert.equal(run.urls.find(r=>r.url.endsWith('/blocked')).reason,'robots_disallowed');
    assert.equal(run.urls.find(r=>r.url.endsWith('/login')).reason,'auth_or_private_path');
    assert(!hits.includes('/blocked'));assert(!hits.includes('/login'));assert(!hits.some(u=>u.startsWith('/private')));
    assert(run.network.every(r=>new URL(r.url).origin===url));
    assert(!run.urls.some(r=>r.state==='queued'));
  });
});

test('base links obey origin policy and skipped diagnostics do not consume eligible frontier capacity', async () => {
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': html('<base href="/archive/"><a href="https://elsewhere.test/">Outside</a><a href="record">Record</a>'),
    '/archive/record': html('<base href="https://elsewhere.test/"><a href="private">Outside base</a>'),
  }, async (url, hits) => {
    const run = await crawlSite(url, { ...options, maxDiscovered: 2 });
    assert.equal(run.pages.length, 2);
    assert(hits.includes('/archive/record'));assert(!hits.includes('/record'));
    assert(run.network.every(entry => new URL(entry.url).origin === url));
    assert.equal(run.summary.eligibleDiscovered, 2);assert.equal(run.summary.omittedLinks, 0);
    assert.equal(run.summary.allEligibleAnalyzed, true, 'links excluded at discovery are outside the eligible set');
  });
});

test('HTML encoding honors BOM, HTTP charset and legacy meta declarations', async () => {
  const latin = '<meta charset="windows-1252"><main><h1>Caf\u00e9</h1></main>';
  const route = (body, contentType = 'text/html') => (req, res) => { res.writeHead(200, { 'Content-Type': contentType }); res.end(body); };
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': html('<a href="/meta">Meta</a><a href="/header">Header</a><a href="/bom">BOM</a><a href="/invalid">Unknown header</a>'),
    '/meta': route(Buffer.from(latin, 'latin1')),
    '/header': route(Buffer.from(latin.replace('windows-1252', 'utf-8'), 'latin1'), 'text/html; charset=windows-1252'),
    '/bom': route(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from(latin)]), 'text/html; charset=windows-1252'),
    '/invalid': route(Buffer.from(latin, 'latin1'), 'text/html; charset=not-real'),
  }, async url => {
    const run = await crawlSite(url, options);
    for (const page of run.pages.slice(1)) assert.equal(page.title, 'Caf\u00e9', page.url);
    assert.equal(run.pages.find(page => page.url.endsWith('/bom')).fetch.encoding, 'UTF-8');
    assert.equal(run.pages.find(page => page.url.endsWith('/meta')).fetch.encoding, 'windows-1252');
  });
});

test('legacy x-user-defined encoding is decoded instead of failing the page', async () => {
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=x-user-defined' }); res.end(Buffer.from('<main><h1>Record</h1></main>', 'ascii')); },
  }, async url => {
    const run = await crawlSite(url, options);
    assert.equal(run.pages.length, 1);assert.equal(run.pages[0].title, 'Record');
    assert.equal(run.summary.counts.failed, 0);
  });
});

test('path prefixes use the same decoded scope and reject malformed configuration', () => {
  const start = new URL('https://example.test/catalog/');
  assert.equal(scopeReason(start, start, { pathPrefix: '/c%61talog' }), null);
  for (const pathPrefix of ['/../catalog', '/catalog?x', '/%zz']) assert.equal(scopeReason(start, start, { pathPrefix }), 'invalid_path_prefix');
});
test('real crawl checks redirect targets before requesting them and deduplicates final URLs',async()=>{
  await fixture({
    '/robots.txt':'User-agent: *\nAllow: /\n',
    '/':html('<a href="/jump">A</a><a href="/final">B</a><a href="/outside">C</a><a href="/secret">D</a>'),
    '/jump':(req,res)=>{res.writeHead(302,{Location:'/final'});res.end();},
    '/outside':(req,res)=>{res.writeHead(302,{Location:'https://example.com/'});res.end();},
    '/secret':(req,res)=>{res.writeHead(302,{Location:'/private/answers'});res.end();},
    '/final':html('<p>Destination</p>')
  },async(url,hits)=>{
    const run=await crawlSite(url,options);
    assert.equal(run.pages.length,2);assert.equal(run.summary.counts.redirect_duplicate,1);
    assert.equal(run.urls.find(r=>r.url.endsWith('/outside')).reason,'cross_origin');
    assert.equal(run.urls.find(r=>r.url.endsWith('/outside')).redirects.length,1);
    assert.equal(run.urls.find(r=>r.url.endsWith('/secret')).reason,'auth_or_private_path');
    assert.equal(run.summary.frontierExhausted,true);
    assert.equal(run.summary.allEligibleAnalyzed,false,'eligible URLs blocked during fetch must not count as analyzed');
    assert.equal(run.summary.completeFrontier,false);
    assert(!hits.includes('/private/answers'));
    assert(run.network.every(r=>new URL(r.url).origin===url));
  });
});
test('safe redirect aliases count as processed without inflating the page count', async () => {
  await fixture({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': html('<a href="/jump">Alias</a><a href="/final">Destination</a>'),
    '/jump': (req, res) => { res.writeHead(302, { Location: '/final' }); res.end(); },
    '/final': html('<p>Destination</p>'),
  }, async url => {
    const run = await crawlSite(url, options);
    assert.equal(run.summary.analyzed, 2);
    assert.equal(run.summary.eligibleDiscovered, 3);
    assert.equal(run.summary.counts.redirect_duplicate, 1);
    assert.equal(run.summary.allEligibleAnalyzed, true);
  });
});
test('same-host default-port redirect normalization keeps HTTPS and records its declared target',()=>{
  const start=new URL('https://example.com/');
  const changed=redirectTarget('http://example.com/author/one/',new URL('https://example.com/author/one'),start);
  assert.equal(changed.target.href,'https://example.com/author/one/');
  assert.equal(changed.declared.href,'http://example.com/author/one/');assert.equal(changed.preserveHttps,true);
  assert.equal(redirectTarget('http://other.test/',start,start).preserveHttps,false);
  assert.equal(redirectTarget('http://example.com:8080/',start,start).preserveHttps,false);
});
test('real crawl enforces page, response-byte, total-byte and time budgets',async()=>{
  await fixture({
    '/robots.txt':'User-agent: *\nAllow: /\n',
    '/':html('<a href="/a">A</a><a href="/b">B</a>'),
    '/a':html('x'.repeat(1000)),'/b':html('B')
  },async(url,hits)=>{
    const limited=await crawlSite(url,{...options,maxPages:1});
    assert.equal(limited.pages.length,1);assert.equal(limited.summary.counts.unattempted,2);
    const oversized=await crawlSite(url,{...options,maxPageBytes:500});
    assert(oversized.urls.some(r=>r.reason==='page_byte_budget'));assert.equal(oversized.pages.length,2);
    const total=await crawlSite(url,{...options,maxTotalBytes:350});
    assert.equal(total.summary.stopReason,'total_byte_budget');
  });
  await fixture({'/robots.txt':'User-agent: *\nAllow: /\n','/':html('never')},async(url,hits)=>{
    const run=await crawlSite(url,{...options,delayMs:1000,maxTimeMs:500});
    assert.equal(run.summary.stopReason,'time_budget');assert.deepEqual(hits,['/robots.txt']);
  });
});
test('robots errors fail closed, missing robots permits a bounded run, rate limit stops new fetches',async()=>{
  await fixture({'/robots.txt':(req,res)=>{res.writeHead(500);res.end();},'/':html('never')},async(url,hits)=>{
    const run=await crawlSite(url,options);assert.equal(run.summary.stopReason,'robots_unavailable');assert.deepEqual(hits,['/robots.txt']);
  });
  await fixture({'/':html('<a href="/rate">Rate</a><a href="/later">Later</a>'),'/rate':(req,res)=>{res.writeHead(429);res.end();},'/later':html('never')},async(url,hits)=>{
    const run=await crawlSite(url,options);assert.equal(run.robots.status,'not_present');assert.equal(run.summary.stopReason,'server_429_stop');assert(!hits.includes('/later'));
  });
});
test('real crawl preserves semantic query parameters and rejects private network defaults',async()=>{
  assert.equal(normalizeCrawlUrl('/Record?edition=2&utm_source=x#section','https://example.com').href,'https://example.com/Record?edition=2');
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','192.0.0.1','198.18.0.1','2001:db8::1','::1','fd00::1','::ffff:127.0.0.1'])assert(privateAddress(ip),ip);
  assert(!privateAddress('8.8.8.8'));
  await assert.rejects(crawlSite('http://127.0.0.1'),/Private network/);
  await assert.rejects(crawlSite('https://example.com',{maxPages:0}),/small|greater|least/i);
  await assert.rejects(crawlSite('https://example.com',{delayMs:0}),/delayMs/);
});
test('connection lookup is pinned and known oversized aggregate bodies are not read',async()=>{
  const addresses=[{address:'8.8.8.8',family:4}];
  const resolvePinned=pinnedLookup('public.test',addresses);addresses[0].address='127.0.0.1';
  assert.deepEqual(await new Promise((resolve,reject)=>resolvePinned('public.test',{all:true},(e,v)=>e?reject(e):resolve(v))),[{address:'8.8.8.8',family:4}]);
  await assert.rejects(new Promise((resolve,reject)=>resolvePinned('different.test',{},(e,v)=>e?reject(e):resolve(v))),/Unexpected/);
  await fixture({'/robots.txt':'User-agent: *\nAllow: /\n','/':(req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Content-Length':'1000'});res.end('x'.repeat(1000));}},async(url)=>{
    const run=await crawlSite(url,{...options,maxTotalBytes:256});
    assert.equal(run.summary.stopReason,'total_byte_budget');
    assert.equal(run.network.find(n=>n.kind==='page').bytes,0);
  });
});
