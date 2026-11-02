import { parseArgs } from 'node:util';
import { runSiteStudy } from '../src/site-study.mjs';

const {values}=parseArgs({options:{url:{type:'string',default:'https://quotes.toscrape.com/'},out:{type:'string'},'max-pages':{type:'string',default:'8'},'max-depth':{type:'string',default:'2'},'max-seconds':{type:'string',default:'90'},'delay-ms':{type:'string',default:'1200'},'synthetic-pages':{type:'string',default:'30'},threshold:{type:'string',default:'0.32'},'path-prefix':{type:'string',default:'/'},'allow-local':{type:'boolean',default:false},'skip-contrast':{type:'boolean',default:false},help:{type:'boolean',default:false}}});
if(values.help){
  console.log(`One-site crawl -> inferred clusters -> fictional clean/noisy benchmark -> legacy example.

node scripts/site-study.mjs --out outputs/one-site-example
node scripts/site-study.mjs --url https://quotes.toscrape.com/ --max-pages 8 --out outputs/another-run

Options: --max-pages 1..500 --max-depth 0..10 --max-seconds 1..600
--delay-ms N (public minimum 500) --threshold 0..1 --synthetic-pages 13..100
--path-prefix /section/ --skip-contrast --allow-local

Only one origin, GET, robots respected, no logins or private paths.
Real-site clusters are predictions; only fictional fixtures have known answers.
Contrast audit runs on the local legacy example, never silently on the live site.`);
}else{
  if(!values.out)throw new Error('--out is required; use a fresh directory');
  try{
    const {study}=await runSiteStudy(values.url,values.out,{maxPages:Number(values['max-pages']),maxDepth:Number(values['max-depth']),maxTimeMs:Number(values['max-seconds'])*1000,delayMs:Number(values['delay-ms']),pathPrefix:values['path-prefix'],allowLocal:values['allow-local'],threshold:Number(values.threshold),syntheticPages:Number(values['synthetic-pages']),contrast:!values['skip-contrast']});
    if(study.status==='failed')process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
