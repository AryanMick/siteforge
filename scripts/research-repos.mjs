import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const repos=['faker-js/faker','apify/crawlee','inikulin/parse5','scrapy/scrapy','microsoft/playwright','web-arena-x/webarena','ServiceNow/BrowserGym'];
const out=process.argv[2]??'outputs/repository-snapshot.json';
const results=[];
for(const repository of repos){
  const source=`https://api.github.com/repos/${repository}`;
  const response=await fetch(source,{headers:{Accept:'application/vnd.github+json','User-Agent':'siteforge-research'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`${repository}: HTTP ${response.status}`);
  const data=await response.json();
  results.push({repository,url:data.html_url,stars:data.stargazers_count,meetsThreshold:data.stargazers_count>=1000,apiLicense:data.license?.spdx_id??null,archived:data.archived,source});
}
await mkdir(dirname(out),{recursive:true});
await writeFile(out,JSON.stringify({checkedAt:new Date().toISOString(),minimumStars:1000,repositories:results},null,2)+'\n',{flag:'wx'});
console.log(`Saved live repository evidence to ${out}`);
