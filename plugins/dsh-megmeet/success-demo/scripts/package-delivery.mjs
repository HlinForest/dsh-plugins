import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import yaml from '../../node_modules/js-yaml/index.js';
const demo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.dirname(demo),files=[];
const skipped=new Set(['permission-recovery','__pycache__','node_modules','.verification','.git','.agents','.codex']);
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(skipped.has(e.name)||e.name==='permission-verification.txt'||e.name.startsWith('.credentials')||e.name==='artifact-manifest.json'||e.name==='share-files.json'||e.name==='credential-audit.json'||e.name==='zip-verification.json')continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile())files.push(p);}}
for(const folder of ['success-demo','src','lib','test','scripts','examples'])await walk(path.join(root,folder));
for(const name of ['package.json','package-lock.json','tsconfig.json','README.md','LICENSE','cordis.patch.yml','dsh-megmeet-0.2.0.tgz'])files.push(path.join(root,name));
const secretValues=[];
function collect(v,k=''){if(Array.isArray(v))for(const i of v)collect(i,k);else if(v&&typeof v==='object')for(const [key,value]of Object.entries(v))collect(value,key);else if(typeof v==='string'&&v.length>=12&&/token|secret|password|api.?key|credential/i.test(k))secretValues.push(v);}
try{collect(yaml.load(await fs.readFile(path.join(process.env.USERPROFILE,'.dsh/.credentials.yaml'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
const manifest=[],failures=[];
for(const filename of files){const bytes=await fs.readFile(filename),relative=path.relative(root,filename).replaceAll('\\','/');
 if(!/\.(png|pdf|tgz|woff2?|jpg|jpeg|zstd)$/i.test(filename)){const text=bytes.toString('utf8');if(secretValues.some(v=>text.includes(v))||/eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text))failures.push(relative);}
 manifest.push({file:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
if(failures.length)throw Error('Credential audit failed in '+failures.join(', '));
const audit={pass:true,credentialValuesChecked:secretValues.length,textArtifactsChecked:files.filter(f=>!/\.(png|pdf|tgz|woff2?|jpg|jpeg|zstd)$/i.test(f)).length,privateProfilesIncluded:false,authenticationStorageIncluded:false,permissionBackupsIncluded:false};
await fs.writeFile(path.join(demo,'credential-audit.json'),JSON.stringify(audit,null,2)+'\n');
await fs.writeFile(path.join(demo,'artifact-manifest.json'),JSON.stringify({pluginVersion:'0.2.0',files:manifest,excluded:'Local ACL rollback backups and private DSH profiles/authentication; original copies remain on this machine.'},null,2)+'\n');
await fs.writeFile(path.join(demo,'share-files.json'),JSON.stringify([...manifest.map(f=>f.file),'success-demo/credential-audit.json','success-demo/artifact-manifest.json','success-demo/share-files.json'],null,2)+'\n');
console.log(JSON.stringify({pass:true,files:manifest.length,bytes:manifest.reduce((n,f)=>n+f.bytes,0),...audit}));
