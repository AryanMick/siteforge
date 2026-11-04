import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateConfig } from '../../src/site/config.mjs';
import { presetConfig } from '../../src/site/presets.mjs';
import { generate } from '../../src/site/generator.mjs';
import { serve } from '../../src/preview/server.mjs';
import { json } from '../../src/site/util.mjs';

const out=resolve(process.argv[2]??'outputs/native-preview');
const servers=[];const fixtures=[];
try{
  for(const [i,framework] of ['html','react','angular'].entries())for(const [j,level] of ['clean','high'].entries()){
    const port=4380+i*2+j;
    const c=presetConfig(['library','government','university'][i],i);
    c.site.framework=framework;c.site.pageCount=30;c.site.visualStyle=['modern','conventional','legacy'][i];c.site.baseUrl=`http://127.0.0.1:${port}`;c.noise={level};
    const directory=join(out,`${framework}-${level}`);
    try{await readFile(join(directory,'private/manifest.json'));}catch{await generate(validateConfig(c),directory);}
    const truth=JSON.parse(await readFile(join(directory,'private/ground-truth.json'),'utf8'));
    const server=await serve(directory,{port});servers.push(server);
    fixtures.push({framework,noise:level,url:server.url,directory,pages:[truth.pages[0],...truth.pages.filter(p=>p.kind==='detail').slice(0,3),truth.pages.find(p=>p.kind==='listing')]});
    console.log(`${framework}/${level}: ${server.url}`);
  }
  await writeFile(join(out,'fixtures.json'),json(fixtures));
  const close=async()=>{for(const s of servers)await s.close();};
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await close();process.exit(0);});
}catch(error){for(const s of servers)await s.close();throw error;}
