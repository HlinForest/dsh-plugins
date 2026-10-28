import test from 'node:test';
import assert from 'node:assert/strict';
import {textInputRecord} from '../frontend/textFlow.js';
import {documentEvidence} from '../src/inline-evidence.js';
import {extractFacts} from '../src/specification-facts.js';
test('OCR observations are visible but cannot become cited source facts',()=>{
 const figure={id:'fig-1',page:2,bbox:[40,70,340,190],content:'R >= 15 kohm',verified:false,limitations:'须对照原 PDF 复核'};
 const project={mode:'text-mcp',inputs:{evidence:[{id:'native',document:'part.pdf',page:2,content:'native source'}]},uploads:[{name:'part.pdf',figureObservations:[figure]}]};
 assert.match(textInputRecord(project),/图中文字待复核.*part.pdf.*第2页/);
 assert.match(textInputRecord(project),/R >= 15 kohm/);
 assert.equal(documentEvidence(project.inputs).some(r=>r.id==='fig-1'),false);
 assert.throws(()=>extractFacts({componentFacts:[{reference:'R8',value:'15k',componentKind:'resistor',pins:[{number:'1',name:'1',type:'passive'},{number:'2',name:'2',type:'passive'}],citations:[{sourceId:'fig-1',quote:'R >= 15 kohm'}]}]},project.inputs),/引用未匹配/);
});
