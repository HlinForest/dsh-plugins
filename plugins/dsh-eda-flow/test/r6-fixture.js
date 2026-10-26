import fs from 'node:fs/promises';
import {mockEvidence} from './fixtures/mock-inputs.js';
export function r6Design(){
 const rows=mockEvidence.filter(r=>r.objectRole);
 const components=rows.map(r=>({id:r.id,ref:r.reference,value:r.value,mpn:['U1','D1'].includes(r.reference)?r.value:'',librarySymbol:(r.reference==='*'?'Evidence:R6_Display':r.symbolId),footprint:'',pins:r.pins.map(p=>({...p,pad:p.number})),...Object.fromEntries(['dnp','in_bom','on_board','objectRole','originalFootprint','materialCode','materialDescription','assemblyType'].map(k=>[k,r[k]]))}));
 const nets=[
 {name:'+5V',nodes:['DISP.3','U1.4','C1.1','C4.2','C8.2','R1.2','R3.2']},
 {name:'SGND',nodes:['DISP.2','U1.14','D1.2','C1.2',...['C2','C3','C4','C5','C6','C7','C8'].map(r=>r+'.1'),...['RJ3','RJ4','RJ7'].flatMap(r=>[r+'.1',r+'.2'])]},
 {name:'IR_VCC',nodes:['R1.1','D1.3','C2.2','C3.2']},
 {name:'RCV',nodes:['DISP.1','D1.1','R3.1']},
 {name:'DIN',nodes:['DISP.6','U1.1','C7.2']},
 {name:'CLK',nodes:['DISP.5','U1.2','C6.2','RJ5.1','RJ5.2','RJ6.1','RJ6.2']},
 {name:'STB',nodes:['DISP.4','U1.3','C5.2']},
 ...[['R2','2','1','C','8'],['R4','2','1','E','9'],['R6','2','1','G','7'],['R8','2','1','D','10'],['R9','1','2','F','6'],['R7','1','2','A','5'],['R5','1','2','B','4']].flatMap(([r,input,output,seg,pin],i)=>[{name:'SEG'+(i+1),nodes:[`U1.${i+5}`,`${r}.${input}`]},{name:seg,nodes:[`${r}.${output}`,`*.${pin}`]}]),
 {name:'G1',nodes:['U1.16','*.1','RJ2.1','RJ2.2']},
 {name:'G2',nodes:['U1.15','*.3','RJ8.1','RJ8.2']},
 {name:'G3',nodes:['U1.13','*.2','RJ1.1','RJ1.2']},
 ];
 return {components,nets,nc:['U1.12'],supplied_nets:['+5V','SGND','IR_VCC'],functions:[{requirementId:'r6',description:'Preserve documented R6 circuit facts',checks:[{kind:'connected',nodes:['DISP.1','D1.1']},{kind:'connected',nodes:['U1.16','*.1']}],limitations:['Mock extraction; hardware not tested']}],unresolved:['PCB footprint geometry and manufacturer procurement verification not performed']};
}
export function r6Layout(){return {template:'generic-v1',paper:'A3-landscape',gapMm:3.81,rotations:{},groups:[
 {id:'driver',title:'TM1616, decoupling and segment resistors',references:['U1','R2','R4','R6','R8','R9','R7','R5','C1','C4','C8']},
 {id:'display',title:'Original display',references:['*']},
 {id:'infrared',title:'Infrared receiver',references:['D1','R1','R3','C2','C3']},
 {id:'input',title:'Control inputs',references:['DISP','C5','C6','C7']},
 {id:'jumpers',title:'Zero-ohm fitted links',references:['RJ1','RJ2','RJ3','RJ4','RJ5','RJ6','RJ7','RJ8']},
 {id:'process',title:'Process objects - not electronic components',references:['SS','DWK1','DWK2','check','UL','LLOO','QR Code','QR Code1','MM1','MM2','MM3','LLAA']}
]};}
if(process.argv[1]?.endsWith('r6-fixture.js'))await fs.writeFile(process.argv[2],JSON.stringify(r6Design(),null,2));
