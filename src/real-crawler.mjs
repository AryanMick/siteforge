import { BasicCrawler } from '@crawlee/basic';
import { Configuration, RequestQueue, LogLevel } from '@crawlee/core';
import robotsParser from 'robots-parser';
import ipaddr from 'ipaddr.js';
import sniffEncoding from 'html-encoding-sniffer';
import { TextDecoder as HtmlTextDecoder } from '@exodus/bytes/encoding.js';
import { Agent, fetch } from 'undici';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { analyzePage } from './page-analysis.mjs';
import { hash } from './util.mjs';

const settingsSchema=z.object({
  maxPages:z.number().int().min(1).max(500).default(8),
  maxDepth:z.number().int().min(0).max(10).default(2),
  maxDiscovered:z.number().int().min(1).max(5000).default(500),
  maxTimeMs:z.number().int().min(500).max(1800000).default(90000),
  timeoutMs:z.number().int().min(100).max(30000).default(12000),
  delayMs:z.number().int().min(0).max(30000).default(1200),
  maxPageBytes:z.number().int().min(128).max(5000000).default(1000000),
  maxTotalBytes:z.number().int().min(256).max(50000000).default(8000000),
  maxRedirects:z.number().int().min(0).max(5).default(3),
  allowLocal:z.boolean().default(false),
  pathPrefix:z.string().startsWith('/').default('/'),
  userAgent:z.string().regex(/^[A-Za-z][A-Za-z0-9_.\/-]{2,100}$/).default('SiteforgeResearchBot/1.0'),
}).strict();

const privatePath=/(^|\/)(?:login|logout|signin|signout|admin|account|accounts|private|checkout|cart|delete|remove)(?:\/|$)/i;
const assetPath=/\.(?:png|jpe?g|webp|gif|svg|ico|css|js|mjs|pdf|zip|mp4|mp3|woff2?|xml|json|txt)(?:$)/i;
class PolicyError extends Error { constructor(code,message=code){super(message);this.code=code;} }

function recognizableHtml(html) {
  const prefix = html.slice(0, 512).trimStart().replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(prefix)) return false;
  return /^(?:<!doctype\s+html(?:\s|>)|<(?:html|head|body|frameset)(?:\s|\/?>))/i.test(prefix);
}

export function privateAddress(address){
  try{return ipaddr.process(address).range()!=='unicast';}catch{return true;}
}

export function pinnedLookup(hostname,addresses){
  const pinned=addresses.map(entry=>({...entry}));
  return (host,options,callback)=>{
    if(host!==hostname){callback(new Error('Unexpected dispatcher hostname'));return;}
    const family=typeof options==='number'?options:options?.family;
    const candidates=family?pinned.filter(entry=>entry.family===family):pinned;
    if(!candidates.length){callback(new Error('No vetted address for requested family'));return;}
    if(options?.all)callback(null,candidates.map(entry=>({...entry})));
    else callback(null,candidates[0].address,candidates[0].family);
  };
}

export function normalizeCrawlUrl(href,base){
  const url=new URL(href,base);url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid'].includes(key))url.searchParams.delete(key);
  return url;
}

export function redirectTarget(location,current,start){
  const declared=normalizeCrawlUrl(location,current);const target=new URL(declared);
  const preserveHttps=start.protocol==='https:'&&declared.protocol==='http:'&&declared.hostname===start.hostname&&!declared.port&&!start.port;
  if(preserveHttps)target.protocol='https:';
  return {declared,target,preserveHttps};
}

export function isCanonicalUpgrade(source, target) {
  return source.protocol === 'http:' && target.protocol === 'https:'
    && source.hostname === target.hostname && !source.port && !target.port
    && !target.username && !target.password;
}

export function scopeReason(url,start,settings,{robots=false}={}){
  if(!['http:','https:'].includes(url.protocol))return 'non_http';
  if(url.username||url.password)return 'credentials_in_url';
  if(url.origin!==start.origin)return 'cross_origin';
  let path;try{path=decodeURIComponent(url.pathname);}catch{return 'invalid_encoding';}
  if(path.includes('\\')||path.includes('\0')||path.split('/').some(p=>p.startsWith('.')))return 'hidden_or_unsafe_path';
  if(robots&&path==='/robots.txt')return null;
  if(privatePath.test(path))return 'auth_or_private_path';
  let prefix;
  try { prefix=decodeURIComponent(settings.pathPrefix).replace(/\/$/,''); } catch { return 'invalid_path_prefix'; }
  if(/[?#\\\0]/.test(prefix)||prefix.split('/').some(p=>p.startsWith('.')))return 'invalid_path_prefix';
  if(prefix&&path!==prefix&&!path.startsWith(prefix+'/'))return 'outside_path_prefix';
  if(assetPath.test(path))return 'non_html_asset';
  if(url.href.length>4096)return 'url_too_long';
  return null;
}

/** Public, bounded HTTP crawl. No login, form submission, browser JS or gold files. */
export async function crawlSite(startUrl,options={},transport={lookup,fetch,Agent},callbacks={}){
  const settings=settingsSchema.parse(options);
  if(!settings.allowLocal&&settings.delayMs<500)throw new Error('Public crawls require delayMs >= 500');
  const start=normalizeCrawlUrl(startUrl);
  const requestedStart=start.href;
  let effectiveStartUrl=start.href;
  const startReason=scopeReason(start,start,settings);
  if(startReason)throw new Error(`Start URL rejected: ${startReason}`);
  const began=Date.now();const deadline=began+settings.maxTimeMs;let dnsTimer;
  const addresses=await Promise.race([transport.lookup(start.hostname.replace(/^\[|\]$/g,''),{all:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('DNS lookup timed out')),Math.min(settings.timeoutMs,settings.maxTimeMs));})]).finally(()=>clearTimeout(dnsTimer));
  const loopback=['localhost','127.0.0.1','[::1]'].includes(start.hostname);
  const allowedLoopback=settings.allowLocal&&loopback&&addresses.every(a=>ipaddr.process(a.address).range()==='loopback');
  if(!addresses.length||addresses.some(a=>privateAddress(a.address))&&!allowedLoopback)throw new Error('Private network URL rejected; --allow-local supports explicit loopback fixtures only');
  // Every connection uses the vetted snapshot; fetch cannot resolve a rebound host.
  const dispatcher=new transport.Agent({connect:{lookup:pinnedLookup(start.hostname,addresses)},connections:1});

  try{
  const network=[];const states=new Map();const pages=[];const finalUrls=new Set();
  let consumedBytes=0,lastRequestAt=0,stopReason=null,omittedLinks=0,eligibleDiscovered=0,omittedDiagnostics=0;
  let currentUrl=null;
  let effectiveDelay=settings.delayMs;
  let robots={url:new URL('/robots.txt',start).href,status:'unavailable',httpStatus:null,bodySha256:null};
  let parser;
  const remaining=()=>deadline-Date.now();
  const mark=(url,state,more={})=>states.set(url,{...(states.get(url)??{url}),state,...more});
  const count=state=>[...states.values()].filter(item=>item.state===state).length;
  const publishProgress=async()=>{
    if(typeof callbacks.onProgress!=='function')return;
    await callbacks.onProgress({analyzed:pages.length,discovered:states.size,queued:count('queued'),failed:count('failed'),skipped:count('skipped'),bytes:consumedBytes,elapsedMs:Date.now()-began,currentUrl,maxPages:settings.maxPages});
  };
  const checkStop=async()=>{
    if(stopReason)return stopReason==='user_stopped';
    if(typeof callbacks.shouldStop==='function'&&await callbacks.shouldStop()){stopReason='user_stopped';return true;}
    return false;
  };
  const cooperativeWait=async duration=>{
    const until=Date.now()+duration;
    while(Date.now()<until){
      await sleep(Math.min(250,until-Date.now()));
      if(await checkStop())throw new PolicyError('user_stopped');
    }
  };

  async function fetchBounded(url,{isRobots=false}={}){
    const chain=[];let current=redirectTarget(url.href,start,start).target;
    const policyError=code=>Object.assign(new PolicyError(code),{redirects:[...chain]});
    for(let hop=0;hop<=settings.maxRedirects;hop++){
      if(await checkStop())throw policyError('user_stopped');
      if(stopReason)throw policyError(stopReason);
      const reason=scopeReason(current,start,settings,{robots:isRobots});
      if(reason)throw policyError(reason);
      if(!isRobots&&parser?.isAllowed(current.href,settings.userAgent)===false)throw policyError('robots_disallowed');
      if(network.length>=(settings.maxPages+2)*(settings.maxRedirects+1))throw policyError('request_budget');
      const wait=effectiveDelay-(Date.now()-lastRequestAt);
      if(remaining()<=Math.max(0,wait))throw policyError('time_budget');
      if(wait>0)await cooperativeWait(wait);
      if(remaining()<=0)throw policyError('time_budget');
      lastRequestAt=Date.now();
      const entry={url:current.href,kind:isRobots?'robots':'page',status:null,bytes:0};network.push(entry);
      let response;
      try{
        response=await transport.fetch(current,{dispatcher,redirect:'manual',headers:{'User-Agent':settings.userAgent,Accept:isRobots?'text/plain':'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(Math.max(1,Math.min(remaining(),settings.timeoutMs)))});
        entry.status=response.status;
        if([301,302,303,307,308].includes(response.status)){
          const location=response.headers.get('location');await response.body?.cancel();
          if(!location)throw new PolicyError('redirect_without_location');
          const {declared,target,preserveHttps}=redirectTarget(location,current,start);
          chain.push({from:current.href,declaredTo:declared.href,to:target.href,status:response.status,preserveHttps});
          entry.redirectTo=target.href;entry.declaredRedirectTo=declared.href;
          if(hop>=settings.maxRedirects)throw policyError('redirect_limit');
          if(isCanonicalUpgrade(start,target)){
            const upgraded=new URL(start);upgraded.protocol='https:';
            const targetReason=scopeReason(target,upgraded,settings,{robots:isRobots});
            if(targetReason)throw policyError(targetReason);
            // The host and pinned DNS stay unchanged. HTTPS has its own robots policy.
            start.protocol='https:';
            effectiveStartUrl=start.href;
            robots.url=new URL('/robots.txt',start).href;
            if(!isRobots){await readRobots();if(stopReason)throw policyError(stopReason);}
          }
          current=target;continue;
        }
        const contentType=response.headers.get('content-type')??'';
        const mime=contentType.split(';')[0].trim().toLowerCase();
        const declaredHtml=['text/html','application/xhtml+xml'].includes(mime);
        const canDetectHtml=['','text/plain','application/octet-stream'].includes(mime)
          && !/\bnosniff\b/i.test(response.headers.get('x-content-type-options')??'');
        if(!isRobots&&response.ok&&!declaredHtml&&!canDetectHtml){await response.body?.cancel();throw new PolicyError('non_html_response');}
        if(response.status===429||response.status===503){stopReason=`server_${response.status}_stop`;await response.body?.cancel();throw new PolicyError(stopReason);}
        if(!response.ok&&!isRobots){await response.body?.cancel();throw new PolicyError(`http_${response.status}`);}
        const length=Number(response.headers.get('content-length'));
        if(length>settings.maxPageBytes){await response.body?.cancel();throw new PolicyError('page_byte_budget');}
        if(consumedBytes+length>settings.maxTotalBytes){stopReason='total_byte_budget';await response.body?.cancel();throw new PolicyError(stopReason);}
        const reader=response.body?.getReader();const chunks=[];
        if(reader)try{
          while(true){
            const item=await reader.read();if(item.done)break;
            entry.bytes+=item.value.byteLength;consumedBytes+=item.value.byteLength;
            if(consumedBytes>settings.maxTotalBytes){stopReason='total_byte_budget';await reader.cancel();throw new PolicyError(stopReason);}
            if(entry.bytes>settings.maxPageBytes){await reader.cancel();throw new PolicyError('page_byte_budget');}
            chunks.push(item.value);
          }
        }finally{reader?.releaseLock();}
        const bytes=Buffer.concat(chunks);
        const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1];
        const encoding=isRobots?'UTF-8':sniffEncoding(bytes,{transportLayerEncodingLabel:charset,xml:/^application\/xhtml\+xml/i.test(contentType)});
        const decoder=new HtmlTextDecoder(encoding);entry.encoding=encoding;
        const html=decoder.decode(bytes);
        const htmlDetected=!isRobots&&!declaredHtml;
        if(htmlDetected&&!recognizableHtml(html))throw new PolicyError('non_html_response');
        entry.htmlDetected=htmlDetected;
        return {url:current.href,status:response.status,contentType,htmlDetected,encoding,html,bytes:bytes.length,sha256:hash(bytes),redirects:chain};
      }catch(error){entry.error=error.code??error.cause?.code??error.name;entry.message=error.cause?.message??error.message;error.redirects=chain;throw error;}
    }
    throw policyError('redirect_limit');
  }

  async function readRobots(){
  robots={url:new URL('/robots.txt',start).href,status:'unavailable',httpStatus:null,bodySha256:null};
  parser=undefined;
  try{
    const response=await fetchBounded(new URL(robots.url),{isRobots:true});
    robots={...robots,httpStatus:response.status,bodySha256:response.sha256,redirects:response.redirects};
    if([404,410].includes(response.status)){robots.status='not_present';parser=robotsParser(robots.url,'');}
    else if(response.status>=200&&response.status<300&&!/^\s*</.test(response.html)){
      robots.status='loaded';robots.text=response.html;parser=robotsParser(robots.url,response.html);
      const delay=parser.getCrawlDelay(settings.userAgent);if(Number.isFinite(delay))effectiveDelay=Math.max(effectiveDelay,delay*1000);
      robots.effectiveDelayMs=effectiveDelay;
    }else{stopReason='robots_unavailable';robots.reason=`HTTP ${response.status} or invalid robots body`;robots.code=`http_${response.status}`;}
  }catch(error){
    const code=error.code??error.cause?.code??error.name;
    stopReason??=remaining()<=0?'time_budget':['time_budget','total_byte_budget','request_budget'].includes(code)?code:'robots_unavailable';
    robots.reason=error.cause?.message??error.message;robots.code=code;robots.redirects=error.redirects??[];
  }
  }
  await publishProgress();
  await readRobots();

  const enqueue=[];
  function discover(href,base,depth){
    let url;try{url=redirectTarget(href,base,start).target;}catch{return;}
    if(states.has(url.href))return;
    const reason=scopeReason(url,start,settings)??(parser?.isAllowed(url.href,settings.userAgent)===false?'robots_disallowed':null);
    if(reason){
      if(states.size-eligibleDiscovered<settings.maxDiscovered)mark(url.href,'skipped',{reason,depth});
      else omittedDiagnostics++;
      return;
    }
    if(eligibleDiscovered>=settings.maxDiscovered){omittedLinks++;return;}
    eligibleDiscovered++;
    if(depth>settings.maxDepth){mark(url.href,'unattempted',{reason:'depth_budget',depth});return;}
    if(enqueue.length>=settings.maxPages){mark(url.href,'unattempted',{reason:'page_budget',depth});return;}
    mark(url.href,'queued',{depth});enqueue.push({url:url.href,userData:{depth}});
  }
  discover(start.href,start,0);
  if(!stopReason&&enqueue.length){
    const config=new Configuration({persistStorage:false,purgeOnStart:false,storageClientOptions:{persistStorage:false},logLevel:LogLevel.ERROR});
    const queue=await RequestQueue.open(`study-${randomUUID()}`,{config});
    let added=enqueue.length;await queue.addRequests(enqueue);
    let crawler;
    crawler=new BasicCrawler({requestQueue:queue,maxConcurrency:1,minConcurrency:1,maxRequestRetries:0,maxRequestsPerCrawl:settings.maxPages,useSessionPool:false,requestHandlerTimeoutSecs:Math.ceil(settings.maxTimeMs/1000)+5,
      async requestHandler({request}){
        currentUrl=request.url;await publishProgress();
        if(remaining()<=0)stopReason??='time_budget';
        if(await checkStop()||stopReason){mark(request.url,'unattempted',{reason:stopReason});crawler.stop(stopReason);currentUrl=null;await publishProgress();return;}
        const depth=request.userData.depth;
        try{
          const response=await fetchBounded(new URL(request.url));
          if(depth===0)effectiveStartUrl=response.url;
          if(finalUrls.has(response.url)){mark(request.url,'redirect_duplicate',{finalUrl:response.url,redirects:response.redirects});return;}
          const analysis=analyzePage(response.html,response.url);finalUrls.add(response.url);
          if(response.htmlDetected)analysis.issues.push({code:'html-content-type-recovered',severity:'warning',count:1,evidence:response.contentType||'Content-Type header missing'});
          pages.push({...analysis,fetch:{requestedUrl:request.url,status:response.status,contentType:response.contentType,htmlDetected:response.htmlDetected,bytes:response.bytes,encoding:response.encoding,sha256:response.sha256,redirects:response.redirects}});
          mark(request.url,'analyzed',{finalUrl:response.url,redirects:response.redirects});
          // Breadth-first DOM order; a finite frontier prevents calendar/search traps.
          for(const href of analysis.links)discover(href,response.url,depth+1);
          const next=enqueue.slice(added);added=enqueue.length;if(next.length)await queue.addRequests(next);
        }catch(error){
          if(['time_budget','total_byte_budget','request_budget'].includes(error.code))stopReason=error.code;
          if(error.code==='user_stopped'){stopReason='user_stopped';mark(request.url,'unattempted',{reason:stopReason});crawler.stop(stopReason);return;}
          const skipped=['cross_origin','auth_or_private_path','hidden_or_unsafe_path','robots_disallowed','outside_path_prefix','non_html_response','non_html_asset'].includes(error.code);
          mark(request.url,skipped?'skipped':'failed',{reason:error.code??error.cause?.code??error.name,message:error.cause?.message??error.message,redirects:error.redirects??[]});
        }finally{currentUrl=null;await publishProgress();}
      },
      async failedRequestHandler({request},error){mark(request.url,'failed',{reason:'crawler_error',message:error.message});}
    },config);
    try{await crawler.run();}finally{await queue.drop();}
  }
  for(const [url,state]of states)if(state.state==='queued')mark(url,'unattempted',{reason:stopReason??'page_budget'});
  currentUrl=null;await publishProgress();
  const frontierExhausted=omittedLinks===0&&![...states.values()].some(s=>s.state==='unattempted');
  // A URL accepted at discovery is incomplete if a later redirect blocks its fetch.
  const processedEligible=[...states.values()].filter(s=>s.state==='analyzed'||s.state==='redirect_duplicate').length;
  const allEligibleAnalyzed=!stopReason&&pages.length>0&&frontierExhausted&&processedEligible===eligibleDiscovered;
  return {version:1,startUrl:requestedStart,effectiveStartUrl,settings,settingsSha256:hash(settings),pinnedAddresses:addresses,startedAt:new Date(began).toISOString(),completedAt:new Date().toISOString(),pages,urls:[...states.values()],robots,network,
    summary:{analyzed:pages.length,discovered:states.size,eligibleDiscovered,omittedLinks,omittedDiagnostics,networkRequests:network.length,bytes:consumedBytes,durationMs:Date.now()-began,stopReason,frontierExhausted,allEligibleAnalyzed,completeFrontier:allEligibleAnalyzed,counts:Object.fromEntries(['analyzed','skipped','failed','unattempted','redirect_duplicate'].map(s=>[s,[...states.values()].filter(p=>p.state===s).length]))},
    limitations:['HTTP source only; JavaScript-generated text and computed color contrast are not observed.','Robots decisions are policy signals, not a legal authorization assessment.','Live pages and DNS can change; use controlled fixtures for deterministic accuracy tests.','GET requests only, no authentication, no forms, no external hosts or custom-port redirects, no proxy or bot-protection bypass.']};
  }finally{await dispatcher.close();}
}
