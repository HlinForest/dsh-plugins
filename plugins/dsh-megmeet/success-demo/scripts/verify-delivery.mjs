import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCatalog,parseRequirements,validateCandidate} from '../../lib/domain.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=b=>createHash('sha256').update(b).digest('hex'),normal=v=>JSON.stringify(JSON.parse(JSON.stringify(v)));
const experiment=JSON.parse(await fs.readFile(path.join(root,'records/primary-comparison/experiment.json'),'utf8'));
async function walk(dir){const found=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())found.push(...await walk(name));else if(item.name==='report.json')found.push(name);}return found;}
const originals=new Set(),checks=[];
const files=[...['initial','changed','expanded'].map(id=>path.join(root,`reports/${id}.json`)),...await walk(path.join(root,'records/plugin-reports'))];
for(const w of experiment.workflows.filter(w=>w.arm==='d'))files.push(...await walk(path.join(root,'workspaces',path.basename(w.originDirectory),w.id)));
for(const filename of files){
 const report=JSON.parse(await fs.readFile(filename,'utf8'));if(!report.catalogSnapshot||!report.analysis)continue;
 const catalog=validateCatalog(report.catalogSnapshot);
 if(catalog.revision!==report.catalog.revision||report.analysis.catalogRevision!==report.catalog.revision)throw Error('Historical snapshot mismatch: '+filename);
 for(const source of catalog.sources){if(originals.has(source.sha256))continue;if(hash(await fs.readFile(source.file))!==source.sha256)throw Error('Original mismatch: '+source.id);originals.add(source.sha256);}
 const provided=report.analysis.requirements.constraints.filter(c=>c.origin==='provided').map(({id,origin,...c})=>c);
 const req=parseRequirements(report.requestText,provided);if(normal(req)!==normal(report.analysis.requirements))throw Error('Historical requirements mismatch');
 for(const saved of report.analysis.candidates)if(normal(validateCandidate(catalog,req,saved.productId))!==normal(saved))throw Error('Historical candidate mismatch: '+saved.productId);
 if(normal(report.conclusion.qualified)!==normal(report.analysis.candidates.filter(c=>c.status==='matches_listed_constraints').map(c=>c.productId)))throw Error('Saved conclusion mismatch');
 if(path.basename(filename)==='report.json'){
  const html=await fs.readFile(filename.replace(/\.json$/,'.html'),'utf8');const embedded=JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);if(normal(embedded)!==normal(report))throw Error('HTML and JSON differ');
  const md=await fs.readFile(filename.replace(/\.json$/,'.md'),'utf8');for(const heading of ['结论','需求表','候选表','计算依据','资料来源','待确认事项'])if(!md.includes(heading))throw Error('Missing Markdown section');
 }
 checks.push({file:path.relative(root,filename).replaceAll('\\','/'),reportId:report.reportId,revision:catalog.revision,candidates:report.analysis.candidates.length,qualified:report.conclusion.qualified});
}
const result={pass:true,historicalReportsReplayed:checks.length,originalPDFsVerified:originals.size,htmlJSONConsistency:true,markdownSixSections:true,checks};
await fs.writeFile(path.join(root,'delivery-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,checks:undefined}));
