import fs from 'node:fs/promises';
import path from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
const root=path.resolve('success-demo'), dirs=(await fs.readdir(path.join(root,'records'))).filter(x=>x.startsWith('experiment-')).sort();const dir=dirs.at(-1);
const events=(await fs.readFile(path.join(root,'records',dir,'c-1/initial.events.jsonl'),'utf8')).trim().split('\n').map(x=>{try{return JSON.parse(x);}catch{return {}}});const sid=events.find(e=>e.type==='session')?.sessionId;
const home=process.env.DSH_HOME??path.join(process.env.USERPROFILE,'.dsh');
const sessions=path.join(home,'sessions');
for(const workspace of await fs.readdir(sessions)){
 const folder=path.join(sessions,workspace,sid??'MISSING');if(!await fs.stat(folder).then(s=>s.isDirectory(),()=>false))continue;
 for(const file of await fs.readdir(folder)){
  if(!/\.jsonl(?:\.zstd)?$/.test(file))continue;let bytes=await fs.readFile(path.join(folder,file));if(file.endsWith('.zstd')){let offset=0,chunks=[];while(offset<bytes.length){const d=zstdDecompressSync(bytes.subarray(offset),{info:true});offset+=d.engine.bytesWritten;chunks.push(d.buffer);}bytes=Buffer.concat(chunks);}
  for(const line of bytes.toString('utf8').trim().split('\n')){const r=JSON.parse(line);if(r.type==='request/context'){console.log('context keys',Object.keys(r.data));const find=(o)=>{if(!o||typeof o!=='object')return;if(Array.isArray(o.tools))console.log('tool names',o.tools.map(t=>t.name??t.function?.name));if(o.kind==='tool-registry')console.log('registry keys',Object.keys(o));for(const [k,v]of Object.entries(o))if(!/headers|credential|authorization/i.test(k)&&v&&typeof v==='object')find(v);};find(r.data);returnprocess: {} }
   if(r.type==='system/message'||r.type==='context/message'){const message=r.data.message??r.data;if(message.source?.kind==='tool-registry')console.log(JSON.stringify(message.content).slice(0,1200));}
  }
 }
}
