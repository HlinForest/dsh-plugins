import test from 'node:test';
import assert from 'node:assert/strict';
import {pcbProcess,applyPcbProcess} from '../src/pcb-process.js';
const pin=(number,type='passive')=>({number,pad:number,type});
const design={components:[{ref:'AMP',librarySymbol:'Device:U',pins:[pin('8','power_in'),pin('4','power_in')]},{ref:'BYP',librarySymbol:'Device:C',pins:[pin('1'),pin('2')]},{ref:'RES',librarySymbol:'Device:C',pins:[pin('1'),pin('2')]},{ref:'LINK',value:'0Ω',pins:[pin('1'),pin('2')]}],nets:[{name:'VRAW',nodes:['AMP.8','BYP.1','RES.1','LINK.1']},{name:'RET',nodes:['AMP.4','BYP.2','RES.2']},{name:'ISOLATED',nodes:['LINK.2']}],functions:[{layout:[{kind:'decoupling',anchor:'AMP.8',return:'AMP.4',members:['BYP']}]}],operatingPoints:[{kind:'supply-transient',owner:'AMP',components:['BYP','RES']}]};
test('non-display circuit carries reviewed bypass/storage ownership and distinct copper nets',()=>{
 const p=pcbProcess(design,{pcbDecouplingMm:'4',pcbStorageMm:'9',pcbCopper:'电源与回流铜区'});
 assert.deepEqual(p.relations.map(r=>[r.ref,r.kind,r.anchor.pad,r.maxDistanceMm]),[['BYP','decoupling','8',4],['RES','storage','8',9]]);
 assert.deepEqual(p.copperNets.map(n=>n.name),['RET','VRAW']);assert(!p.copperNets.some(n=>n.name==='ISOLATED'));
 assert.deepEqual(p.jumpers,['LINK']);assert(!JSON.stringify(p).includes('xMm'));
});
test('disconnected claimed bypass and invalid distance are rejected',()=>{
 const d=structuredClone(design);d.nets[0].nodes=d.nets[0].nodes.filter(n=>n!=='BYP.1');
 assert.throws(()=>pcbProcess(d,{}),/布局归属/);assert.throws(()=>pcbProcess(design,{pcbDecouplingMm:'NaN'}),/距离/);
});
test('explicit visible routing overrides the model; no silent jumper deletion',()=>{
 const p=pcbProcess(design,{pcbRoutingLayers:'仅底层',pcbVias:'禁止'});
 assert.deepEqual(applyPcbProcess({activeLayers:['F.Cu'],allowVias:true},p),{activeLayers:['B.Cu'],allowVias:false});
 assert.throws(()=>pcbProcess(design,{pcbJumpers:'不使用跨线'}),/电路阶段/);
});
