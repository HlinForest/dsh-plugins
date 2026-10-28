"""Score existing legal capacitor poses by native local supply and return paths.

Candidate locations come from current footprints and board rules; no reference
board is read. This is a placement proxy, never post-route acceptance.
"""
import math
import pcbnew as pcb
from pcb_power_routes import reserve_power_routes
class PowerPoseScore:
    def __init__(self,board,process,plan,footprints):
        self.board=board;self.process=process;self.plan=plan;self.footprints=footprints;self.reports=[];self.keepalive=[]
    def score(self,ref,choices,relation,move,side):
        if relation.get('kind') not in ('decoupling','storage') or len(self.plan.get('activeLayers',[]))!=1:return choices
        owner=self.footprints[relation['anchor']['ref']];center=owner.GetPosition();ox,oy=pcb.ToMM(center.x),pcb.ToMM(center.y)
        buckets={};fp=self.footprints[ref]
        for cost,x,y,rotation in choices:
            move(ref,x,y,rotation,side)
            distances=[]
            for role,pin in [('anchor','supplyPad'),('return','returnPad')]:
                end=relation[role];aa=[p for p in fp.Pads() if p.GetNumber()==relation[pin]];bb=[p for p in self.footprints[end['ref']].Pads() if p.GetNumber()==end['pad']]
                distances.append(min(math.hypot(pcb.ToMM(a.GetPosition().x-b.GetPosition().x),pcb.ToMM(a.GetPosition().y-b.GetPosition().y)) for a in aa for b in bb))
            dx,dy=x-ox,y-oy;quadrant=('right' if dx>=0 else 'left') if abs(dx)>=abs(dy) else ('bottom' if dy>=0 else 'top');key=(quadrant,rotation)
            rank=(sum(distances),cost,x,y,rotation)
            if key not in buckets or rank<buckets[key]:buckets[key]=rank
        selected=[];probes=[]
        for _,cost,x,y,rotation in sorted(buckets.values()):
            move(ref,x,y,rotation,side);before={t.m_Uuid.AsString() for t in self.board.GetTracks()}
            try:
                result=reserve_power_routes(self.board,{'relations':[relation],'joinExistingTree':False},self.plan)
                ok=len(result['routes'])==2 and all(row['adopted'] for row in result['routes'])
                length=sum(row.get('newLengthMm',0) for row in result['routes'])
                probes.append({'xMm':x,'yMm':y,'rotation':rotation,'bothPathsFound':ok,'localPathLengthMm':length,'routes':result['routes']})
            finally:
                self.keepalive.extend(getattr(self.board,'_eda_power_routes_keepalive',[]))
                temporary=[t for t in self.board.GetTracks() if t.m_Uuid.AsString() not in before]
                for track in temporary:self.board.Remove(track)
                self.keepalive.extend(temporary);self.board.BuildConnectivity()
            if ok:selected.append((30*length+.0001*rotation,x,y,rotation))
        self.reports.append({'ref':ref,'candidates':probes,'scope':'bounded current-geometry local routing score; final full-board routes must be measured'})
        return selected or choices
