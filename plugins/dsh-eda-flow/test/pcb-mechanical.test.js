import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMechanicalDatums} from '../src/pcb-flow.js';
import {displayBoardInputs} from '../src/input-presets.js';
test('explicit mechanical datums cannot silently become automatic placements',()=>{
 const text='定位点 A1=(70.6786,47.5742)mm，M2=(7.077,6.35)mm';
 assert.match(validateMechanicalDatums({pcb:{placements:{}}},text,['A1','M2']),/A1/);
 assert.match(validateMechanicalDatums({pcb:{placements:{A1:{xMm:70.6786,yMm:47.5742},M2:{xMm:7,yMm:6.35}}}},text,['A1','M2']),/M2/);
 assert.equal(validateMechanicalDatums({pcb:{placements:{A1:{xMm:70.6786,yMm:47.5742},M2:{xMm:7.077,yMm:6.35}}}},text,['A1','M2']),null);
});
test('ordinary prose and unrelated coordinates do not invent PCB constraints',()=>{
 assert.equal(validateMechanicalDatums({pcb:{}},'示例点 A=(1,2)mm；器件按功能自动放置。',['U1']),null);
});

test('explicit mechanical fixture enforces coordinates while retaining side and rotation',()=>{
 const text='位号 DISP；显示窗安装基准 X=21.1 mm、Y=11.55 mm';
 const plan={pcb:{placements:{DISP:{xMm:21.1,yMm:11.55,rotation:90}},assemblySides:{DISP:'B.Cu'}}};
 assert.equal(plan.pcb.placements.DISP.rotation,90);
 assert.equal(plan.pcb.assemblySides.DISP,'B.Cu');
 assert.equal(validateMechanicalDatums(plan,text,['DISP']),null);

 const omitted={pcb:{placements:{},assemblySides:{DISP:'B.Cu'}}};
 assert.match(validateMechanicalDatums(omitted,text,['DISP']),/DISP/);

 const displaced={pcb:{placements:{DISP:{xMm:21.11,yMm:11.55,rotation:90}},assemblySides:{DISP:'B.Cu'}}};
 assert.match(validateMechanicalDatums(displaced,text,['DISP']),/DISP/);
});

test('default display-board stage six leaves unspecified placements to automatic layout',()=>{
 const text=displayBoardInputs().stageNotes[6];
 assert.doesNotMatch(text,/QR Code1|DWK2|D1|X\s*=|Y\s*=/);
 const refs=['D1','QR Code1'];
 assert.match(validateMechanicalDatums({pcb:{placements:{D1:{xMm:18.09,yMm:33.9}}}},text,refs),/没有输入机械基准/);
 assert.equal(validateMechanicalDatums({pcb:{placements:{}}},text,refs),null);
});
