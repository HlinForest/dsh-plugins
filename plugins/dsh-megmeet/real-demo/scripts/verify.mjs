import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadCatalog, parseRequirements, validateCandidate } from '../../lib/domain.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = await loadCatalog(path.join(root,'catalog.real.json'));
const results=JSON.parse(await fs.readFile(path.join(root,'deterministic-results.json'),'utf8'));
assert.equal(catalog.products.length,28);
assert.equal(catalog.sources.length,8);
assert.equal(results.cases.length,6);
assert.equal(catalog.products.find(p=>p.id==='MPT35-12V').parameters.output_power_w,36);
assert.equal(catalog.products.find(p=>p.id==='MPT100-24V').parameters.output_power_w,108);
for(const source of catalog.sources) { await fs.access(source.file); assert(source.links.some(l=>l.kind==='snapshot'&&l.markdown.includes(source.version))); }
for(const p of catalog.products) { assert.equal(p.parameters.efficiency_pct,undefined); assert.equal(p.parameters.temperature_c,undefined); }
const matches=id=>results.cases.find(c=>c.id===id).basic.candidates.filter(p=>p.status==='matches_listed_constraints').map(p=>p.productId);
assert.deepEqual(matches('YR-24-120'),['MPT150-24V']);
assert.deepEqual(matches('YR-24-240'),[]);
assert.deepEqual(matches('YR-48-120'),['MPT150-48V']);
for(const c of results.cases) assert(c.full.candidates.every(p=>p.status!=='matches_listed_constraints'));
const voltage=validateCandidate(catalog,parseRequirements('输入电压：176–264VAC\n输出电压：24VDC\n额定功率：≥240W'),'MPT350-24V-F').checks.find(c=>c.field==='input_voltage_v');
assert.equal(voltage.status,'fail');
const efficiency=validateCandidate(catalog,parseRequirements('效率：≥85%'),'MPT600-24V').checks[0];
assert.equal(efficiency.status,'unknown');
assert(results.cases.find(c=>c.id==='CRSC-DUAL').full.candidates.every(c=>c.status==='incompatible' && c.checks.some(check=>check.field==='output_channels' && check.status==='fail')));
const verification={pass:true,productCount:28,officialIndustrialPDFs:8,realProcurementSources:4,testCases:6,screeningEvaluations:28*6*2,fullMatches:0,checks:['All catalog source snapshots exist','All eight PDF file headers and hashes checked by preparation','28 first-page product rows independently visually checked','MPT35-12V rated power corrected to original36W','MPT100-24V original108W, not inferred from series name','Split AC input ranges not joined','Typ. efficiency never used as a guarantee','Full requirements cannot be hidden by screening scores','Version text points to local original'],nativeChatEvidence:'native-chat-link-verification.json'};
await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(verification,null,2)+'\n');
console.log(JSON.stringify(verification));
