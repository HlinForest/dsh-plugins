import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCatalog,parseRequirements,validateCandidate} from '../../lib/domain.js';
const filename=path.resolve(process.argv[2]??'success-demo/reports/expanded.json');
const report=JSON.parse(await fs.readFile(filename,'utf8')),catalog=validateCatalog(report.catalogSnapshot);
if(catalog.revision!==report.catalog.revision||report.analysis.catalogRevision!==report.catalog.revision)throw Error('Report snapshot identifiers differ');
const materialsRoot=path.resolve(process.argv[3]??path.join(path.dirname(fileURLToPath(import.meta.url)),'../materials'));
for(const source of catalog.sources){if(!source.file||!source.sha256)throw Error('Historical original integrity metadata missing');let bytes;try{bytes=await fs.readFile(source.file);}catch(error){if(error.code!=='ENOENT')throw error;bytes=await fs.readFile(path.join(materialsRoot,path.win32.basename(source.file)));}const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==source.sha256)throw Error('Historical original hash mismatch: '+source.id);}
const additions=report.analysis.requirements.constraints.filter(c=>c.origin==='provided').map(({id,origin,...c})=>c);
const requirements=parseRequirements(report.requestText,additions);
const normalize=value=>JSON.stringify(JSON.parse(JSON.stringify(value)));
if(normalize(requirements)!==normalize(report.analysis.requirements))throw Error('Requirements replay differs');
for(const saved of report.analysis.candidates){const replay=validateCandidate(catalog,requirements,saved.productId);if(normalize(replay)!==normalize(saved))throw Error('Candidate replay differs: '+saved.productId);}
console.log(JSON.stringify({verified:true,reportId:report.reportId,catalogRevision:report.catalog.revision,candidates:report.analysis.candidates.length,originalsVerified:catalog.sources.length,engine:'dsh-megmeet@0.2.0'},null,2));
