import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {inspectEnvironment} from '../src/environment.js';
test('missing CAD remains an explicit missing dependency, not a passing review-only environment',async()=>{
 let probes=0;const report=await inspectEnvironment({workspaceRoot:os.tmpdir(),reviewOnly:true},null,async()=>{probes++;return {ok:false,detail:'missing'}});
 assert.equal(report.reviewOnly,true);assert.equal(report.schematicReady,false);assert.equal(report.pcbReady,false);assert(report.checks.some(c=>c.id==='kicad'&&!c.passed));assert.equal(report.modelRequests,0);assert(probes>0);
});
test('future nightly CLI and old Java are not reported as verified tools',async()=>{
 const r=await inspectEnvironment({workspaceRoot:os.tmpdir(),kicadCli:'cad',kicadPython:'python',pcbPython:'python',javaPath:'java',allowModelCalls:true},{model:'configured'},async(exe)=>({ok:true,detail:exe==='cad'?'11.0.0':exe==='java'?'openjdk version "17.0.1"':'{"pcbnew":true,"wx":true,"sexpdata":true,"jsonschema":true,"pymupdf":true,"ortools.sat.python.cp_model":true}'}));
 assert.equal(r.checks.find(c=>c.id==='kicad').passed,false);assert.equal(r.checks.find(c=>c.id==='java').passed,false);assert.match(r.checks.find(c=>c.id==='model').detail,/未发送请求/);
});
test('native schematic readiness does not require legacy parser or PCB Python on its own interpreter',async()=>{
 const r=await inspectEnvironment({workspaceRoot:os.tmpdir(),kicadCli:'cad',kicadPython:'python',pcbPython:'pcb-python'},null,async exe=>({ok:true,detail:exe==='cad'?'10.0.6':exe==='python'?'{"pcbnew":false,"wx":false,"sexpdata":false,"jsonschema":true,"pymupdf":true,"ortools.sat.python.cp_model":true}':exe==='pcb-python'?'10.0.6':'openjdk version "21.0.1"'}));
 assert(r.checks.find(c=>c.id==='python').passed);assert(r.checks.find(c=>c.id==='mcp-python').passed);assert(r.checks.find(c=>c.id==='pcb-python').passed);
});
