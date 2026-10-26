import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const python='D:/anaconda/python.exe';
test('CP-SAT compacts and libavoid preserves a straight branched trunk around obstacles',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'layout-engines-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
 const script=`import sys,json\nsys.path.insert(0,'mcp')\nfrom constraint_placement import compact\ng=json.load(open(sys.argv[1]))\njson.dump(compact(g),open(sys.argv[2],'w'))`;
 const graph={children:[{id:'input',x:0,y:0,width:10,height:10,ports:[{id:'a',x:10,y:5,layoutOptions:{'elk.port.side':'EAST'}}]},{id:'output',x:150,y:0,width:10,height:10,ports:[{id:'b',x:0,y:5,layoutOptions:{'elk.port.side':'WEST'}}]},{id:'shunt',x:70,y:60,width:10,height:15,ports:[{id:'c',x:5,y:0,layoutOptions:{'elk.port.side':'NORTH'}}]}],edges:[{id:'ac',sources:['a'],targets:['c']},{id:'cb',sources:['c'],targets:['b']}]};
 await fs.writeFile(path.join(dir,'in.json'),JSON.stringify(graph));execFileSync(python,['-c',script,path.join(dir,'in.json'),path.join(dir,'placed.json')],{windowsHide:true});
 execFileSync(process.execPath,['mcp/route_avoid.mjs',path.join(dir,'placed.json'),path.join(dir,'routed.json')],{windowsHide:true});
 const result=JSON.parse(await fs.readFile(path.join(dir,'routed.json'),'utf8'));assert.equal(result.placementSolver,'OR-Tools CP-SAT');assert.equal(result.routingEngine,'libavoid');assert(result.width<100);assert(result.height<60);
 const segments=result.edges.flatMap(e=>e.sections);assert.equal(segments.length,2);assert(segments.some(s=>s.startPoint.y===s.endPoint.y));assert(segments.some(s=>s.startPoint.x===s.endPoint.x));assert(segments.every(s=>!s.bendPoints?.length));
});

test('parallel signal fan-in preserves terminals and does not short independent nets after grid snapping',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'route-signals-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
 const port=(id,x,y,side)=>({id,x,y,layoutOptions:{'elk.port.side':side}});
 const graph={children:[
  {id:'hub',x:88.9,y:5.08,width:60,height:101.6,ports:[port('in0',0,45.72,'WEST'),port('in1',0,50.8,'WEST'),port('in2',0,55.88,'WEST')]},
  ...[10.16,38.1,66.04].map((x,i)=>({id:'branch'+i,x:x-5.08,y:55.88,width:20.32,height:15.24,ports:[port('cap'+i,5.08,0,'NORTH')]}))
 ],edges:[{id:'a',sources:['cap0'],targets:['in2']},{id:'b',sources:['cap1'],targets:['in0']},{id:'c',sources:['cap2'],targets:['in1']}]};
 await fs.writeFile(path.join(dir,'in.json'),JSON.stringify(graph));
 execFileSync(process.execPath,['mcp/route_avoid.mjs',path.join(dir,'in.json'),path.join(dir,'out.json')],{windowsHide:true});
 const result=JSON.parse(await fs.readFile(path.join(dir,'out.json'),'utf8'));
 const snap=p=>[Math.round(p.x/1.27),Math.round(p.y/1.27)];
 const lines=result.edges.map(e=>e.sections.flatMap(s=>{const ps=[s.startPoint,...(s.bendPoints||[]),s.endPoint].map(snap);return ps.slice(1).map((p,i)=>[ps[i],p]);}));
 const on=(p,[a,b])=>(a[0]===b[0]?p[0]===a[0]:p[1]===a[1])&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++)for(const a of lines[i])for(const b of lines[j]){
  assert(!a.some(p=>on(p,b))&&!b.some(p=>on(p,a)),'Different nets touch at an endpoint or overlap');
 }
});
