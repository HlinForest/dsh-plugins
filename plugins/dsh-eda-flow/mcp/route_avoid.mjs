import fs from 'node:fs';
import {AvoidLib} from './vendor-libavoid/dist/index-node.mjs';
const g=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
await AvoidLib.load();const A=AvoidLib.getInstance(),router=new A.Router(2);
router.setRoutingParameter(A.RoutingParameter.segmentPenalty,10);
router.setRoutingParameter(A.RoutingParameter.crossingPenalty,100);
router.setRoutingParameter(A.RoutingParameter.fixedSharedPathPenalty,10000);
router.setRoutingParameter(A.RoutingParameter.idealNudgingDistance,2.54);
router.setRoutingOption(A.RoutingOption.nudgeOrthogonalSegmentsConnectedToShapes,false);
router.setRoutingOption(A.RoutingOption.nudgeOrthogonalTouchingColinearSegments,true);
router.setRoutingOption(A.RoutingOption.penaliseOrthogonalSharedPathsAtConnEnds,true);
router.setRoutingParameter(A.RoutingParameter.shapeBufferDistance,1.27);
router.setRoutingOption(A.RoutingOption.nudgeSharedPathsWithCommonEndPoint,false);
const ports=new Map(),sides=new Map(),ends=new Map(),kept=[];
for(const n of g.children){
 const shape=new A.ShapeRef(router,new A.Rectangle(new A.Point(n.x,n.y),new A.Point(n.x+n.width,n.y+n.height)));kept.push(shape);
 for(const [i,p] of (n.ports||[]).entries()){
  const side=p.layoutOptions?.['elk.port.side'];
  ports.set(p.id,{x:n.x+p.x,y:n.y+p.y});sides.set(p.id,side);
  const pin=new A.ShapeConnectionPin(shape,i+1,p.x,p.y,false,0,{NORTH:1,SOUTH:2,WEST:4,EAST:8}[side]||15);pin.setExclusive(false);kept.push(pin);ends.set(p.id,new A.ConnEnd(shape,i+1));

 }
}
const connections=[];
for(const e of g.edges||[]){
 e.sections=[];
 for(const source of e.sources)for(const target of e.targets){
  const a=ports.get(source),b=ports.get(target);if(!a||!b)throw Error('Unknown terminal');
  const ref=new A.ConnRef(router,ends.get(source),ends.get(target));
  ref.setRoutingType(A.ConnType.ConnType_Orthogonal);ref.setHateCrossings(true);connections.push({e,ref,a,b});
 }
}
router.processTransaction();
for(const {e,ref,a,b} of connections){
 const line=ref.displayRoute(),pts=[];for(let i=0;i<line.size();i++){const p=line.at(i);pts.push({x:p.x,y:p.y});}
 if(pts.length<2)throw Error('No route found');
 if(Math.hypot(pts[0].x-a.x,pts[0].y-a.y)>.001||Math.hypot(pts.at(-1).x-b.x,pts.at(-1).y-b.y)>.001)throw Error('Router moved a fixed electrical terminal');
 for(let i=1;i<pts.length;i++)if(Math.abs(pts[i].x-pts[i-1].x)>.001&&Math.abs(pts[i].y-pts[i-1].y)>.001)throw Error('Nonorthogonal route');
 e.sections.push({startPoint:pts[0],bendPoints:pts.slice(1,-1),endPoint:pts.at(-1)});
}
// A shared net may use a straight horizontal trunk plus perpendicular taps.
// This is topology-driven and preserves the exact endpoint set.
const components=[];
for(const e of g.edges||[]){let ids=new Set([...e.sources,...e.targets]),es=[e];let again=true;
 while(again){again=false;for(let i=components.length-1;i>=0;i--)if([...components[i].ids].some(k=>ids.has(k))){for(const k of components[i].ids)ids.add(k);es.push(...components[i].es);components.splice(i,1);again=true;}}
 components.push({ids,es});}
function clear(a,b){return !g.children.some(n=>{const x0=n.x+.02,x1=n.x+n.width-.02,y0=n.y+.02,y1=n.y+n.height-.02;
 return Math.abs(a.y-b.y)<.001 ? a.y>y0&&a.y<y1&&Math.max(a.x,b.x)>x0&&Math.min(a.x,b.x)<x1 : a.x>x0&&a.x<x1&&Math.max(a.y,b.y)>y0&&Math.min(a.y,b.y)<y1;});}
for(const {ids,es} of components){const hs=[...ids].filter(k=>['WEST','EAST'].includes(sides.get(k))).map(k=>ports.get(k)).sort((a,b)=>a.x-b.x);
 if(hs.length<2||hs.some(p=>Math.abs(p.y-hs[0].y)>.01))continue;
 const left=hs[0],right=hs.at(-1),segments=[[left,right]];let valid=clear(left,right);
 for(const k of ids)if(!['WEST','EAST'].includes(sides.get(k))){const p=ports.get(k),tap={x:p.x,y:left.y};if(p.x<left.x||p.x>right.x||!clear(tap,p))valid=false;segments.push([tap,p]);}
 if(valid){for(const e of es)e.sections=[];es[0].sections=segments.map(([a,b])=>({startPoint:a,endPoint:b}));}
}
g.routingEngine='libavoid';fs.writeFileSync(process.argv[3],JSON.stringify(g,null,2));

