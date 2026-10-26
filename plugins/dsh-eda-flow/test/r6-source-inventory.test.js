import test from 'node:test';import assert from 'node:assert/strict';
import {mockEvidence,mockBrief} from './fixtures/mock-inputs.js';
import {validateSourceInventory} from '../src/source-inventory.js';
const rows=mockEvidence.filter(r=>r.objectRole);
const design=()=>({components:rows.map(r=>({ref:r.reference,librarySymbol:r.symbolId||mockEvidence.find(e=>e.binding===r.reference&&e.symbolId&&e.appearance)?.symbolId,value:r.value,dnp:r.dnp,in_bom:r.in_bom,on_board:r.on_board,pins:structuredClone(r.pins),...Object.fromEntries(['objectRole','originalFootprint','materialCode','materialDescription','assemblyType'].map(k=>[k,r[k]]))}))});
test('obsolete evidence cannot silently bypass the source inventory gate',()=>{
 assert(validateSourceInventory(design(),[{id:'display',pins:[]}]).length);
});
test('R6 mock facts contain 29 electrical parts, 12 process objects and 85 pins',()=>{
 assert.equal(rows.filter(r=>r.objectRole==='electrical').length,29);assert.equal(rows.filter(r=>r.objectRole==='process').length,12);
 assert.equal(rows.reduce((n,r)=>n+r.pins.length,0),85);assert(mockBrief.includes('IRM-3638M3-X'));
 assert(!mockEvidence.some(r=>r.content.includes('GT8238D')));assert.equal(validateSourceInventory(design(),mockEvidence).length,0);
});
test('wrong model, missing jumpers, changed value and DNP cannot be frozen as a valid demo',()=>{
 for(const edit of [d=>d.components=d.components.filter(c=>c.ref!=='RJ8'),d=>d.components.find(c=>c.ref==='D1').value='GT8238D',d=>d.components.find(c=>c.ref==='R2').value='220R',d=>d.components.find(c=>c.ref==='R3').dnp=true]){
  const d=design();edit(d);assert(validateSourceInventory(d,mockEvidence).length);
 }
});

test('same-pin generic symbol cannot replace specification appearance',()=>{
 const d=design();d.components.find(c=>c.ref==='R2').librarySymbol='Device:R';
 assert(validateSourceInventory(d,mockEvidence).some(e=>e.includes('外观符号')));
 const display=design();display.components.find(c=>c.ref==='*').librarySymbol='Display:Generic';
 assert(validateSourceInventory(display,mockEvidence).some(e=>e.includes('外观符号')));
});
