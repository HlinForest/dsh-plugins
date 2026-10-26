import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFootprint} from '../src/pcb-footprints.js';
const conventions='单位：mm。按封装顶面局部坐标，X向右、Y向下。通孔：全部铜层和两面阻焊。F标准贴片：F.Cu/F.Mask/F.Paste；B铜形：仅B.Cu。圆角比均为0.25。';
const evidence=[{id:'page',sourceSha256:'abc',page:1,document:'Vendor.pdf',content:conventions+'局部边界 (-4,-4,4,4)。编号1铜形；3个顶点\n(0,0);(1,0);(0,1)'},
 {id:'table',sourceSha256:'abc',page:1,document:'Vendor.pdf',table:{rows:[['number','type','center','size','layer'],['1','thru hole / circle _','-1, 0','1.5,1.5 孔 0.8,0.8','0 / 通孔'],['2','thru_hole / circle','1,0','1.5,1.5 孔 0.8,0.8','0 / 通孔'],['无编号','smd / roundrect','0,2','1,1 孔 0,0','90 / F标准贴片'],['1','smd / custom','-1,0','0.000001,0.000001 孔 0,0','0 / B铜形']]}}];
const components=[{ref:'X17',footprint:'',pins:[{number:'1',pad:'1',name:'A'},{number:'2',pad:'2',name:'NC'}]}];
const args={ref:'X17',tableSourceId:'table',sourceKind:'manufacturer-datasheet',columns:{number:0,typeShape:1,center:2,sizeDrill:3,rotationLayer:4},conventions:{sourceId:'page',quote:conventions},envelope:{sourceId:'page',quote:'局部边界 (-4,-4,4,4)'},polygons:[{row:4,sourceId:'page',heading:'编号1铜形；3个顶点'}]};
test('source table includes duplicate pads, unnamed auxiliaries and every NC pin',()=>{
 const result=compileFootprint(args,evidence,components);
 assert.equal(result.physicalPads,4);assert.equal(result.auxiliaryPads,1);
 assert.deepEqual(result.pinMap.map(p=>[p.pin,p.physicalPads]),[['1',2],['2',1]]);
 assert.deepEqual(result.geometry.pads[3].polygon,[[0,0],[1,0],[0,1]]);
 assert.equal(result.geometry.pads[3].size[0],.000001);
});
test('page selectors read original conventions without model transcription',()=>{
 const result=compileFootprint({...args,conventions:{sourceId:'page'},envelope:{sourceId:'page'}},evidence,components);
 assert.deepEqual(result.geometry,compileFootprint(args,evidence,components).geometry);
});
test('missing NC pad, missing polygon and unjustified dimensions are rejected',()=>{
 const bad=structuredClone(evidence);bad[1].table.rows.splice(2,1);
 assert.throws(()=>compileFootprint({...args,polygons:[{...args.polygons[0],row:3}]},bad,components),/全部引脚/);
 assert.throws(()=>compileFootprint({...args,polygons:[]},evidence,components),/顶点来源/);
 assert.throws(()=>compileFootprint({...args,pads:[]},evidence,components),/额外几何/);
 assert.throws(()=>compileFootprint({...args,envelope:{sourceId:'page',quote:'局部边界 (-5,-5,5,5)'}},evidence,components),/引用不在/);
});
test('truncated polygon, inverted drill and changed frozen package cannot pass',()=>{
 const bad=structuredClone(evidence);bad[0].content=bad[0].content.replace('(0,1)','');
 assert.throws(()=>compileFootprint(args,bad,components),/顶点缺失/);
 const drill=structuredClone(evidence);drill[1].table.rows[1][3]='1,1 孔 2,2';
 assert.throws(()=>compileFootprint(args,drill,components),/孔径不能/);
 assert.throws(()=>compileFootprint(args,evidence,[{...components[0],footprint:'Known:Real'}]),/冻结封装/);
});
