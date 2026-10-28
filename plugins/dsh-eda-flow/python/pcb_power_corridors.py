"""Placement-time native copper corridors from current declared owners only."""
import pcbnew as pcb
from pcb_trace_simplification import polygon,union,intersects
from pcb_power_routes import reserve_power_routes
class PowerCorridors:
    def __init__(self,board,process,plan):
        self.board=board;self.process=process;self.plan=plan;self.reports=[];self.done=set();self.keepalive=[];self.generated=[];self.layer=pcb.B_Cu if plan.get('activeLayers')==['B.Cu'] else pcb.F_Cu
        self.enabled=len(plan.get('activeLayers',[]))==1
    def placed(self,ref,placed):
        if not self.enabled:return
        for relation in self.process.get('relations',[]):
            if relation['ref']!=ref or ref in self.done:continue
            if relation['anchor']['ref'] not in placed or relation['return']['ref'] not in placed:continue
            self.done.add(ref)
            before={t.m_Uuid.AsString() for t in self.board.GetTracks()}
            result=reserve_power_routes(self.board,{'relations':[relation],
                'routeRoles':relation.get('routeRoles',['return','anchor'])},self.plan)
            for track in self.board.GetTracks():
                if track.m_Uuid.AsString() not in before:
                    self.generated.append((track.GetNetname(),track.GetLayer(),track.GetStart().x,track.GetStart().y,track.GetEnd().x,track.GetEnd().y))
            self.keepalive.extend(getattr(self.board,'_eda_power_routes_keepalive',[]));self.reports.append(result)
    def constraints(self):
        tracks=list(self.board.GetTracks());by_net={}
        self.keepalive.extend(tracks);self.keepalive.append(by_net)
        def foreign(net):
            if net not in by_net:
                by_net[net]=union(polygon(t,self.layer,pcb.FromMM(self.plan['clearanceMm']+.003)) for t in tracks if t.GetNetCode()!=net and t.GetLayer()==self.layer)
            return by_net[net]
        lines=[((pcb.ToMM(t.GetStart().x),pcb.ToMM(t.GetStart().y)),(pcb.ToMM(t.GetEnd().x),pcb.ToMM(t.GetEnd().y)),t.GetNetname()) for t in tracks if t.GetLayer()==self.layer]
        return foreign,lines
    def pad_shapes(self,fp):
        result=[(p.GetNetCode(),polygon(p,self.layer)) for p in fp.Pads() if p.IsOnLayer(self.layer)]
        self.keepalive.extend(poly for _,poly in result);return result
    def blocked(self,shapes,foreign,x,y):
        delta=pcb.VECTOR2I(pcb.FromMM(x),pcb.FromMM(y))
        for net,shape in shapes:
            obstacle=foreign(net)
            if obstacle.OutlineCount()==0:continue
            shifted=pcb.SHAPE_POLY_SET(shape);shifted.Move(delta)
            if shifted.BBox().Intersects(obstacle.BBox()) and intersects(shifted,obstacle):return True
        return False

    def release_generated_locks(self):
        """Release only this placement pass's wires after the global router."""
        released=0
        for track in self.board.GetTracks():
            if not track.IsLocked() or isinstance(track,(pcb.PCB_VIA,pcb.PCB_ARC)):continue
            a,b=track.GetStart(),track.GetEnd()
            for net,layer,x1,y1,x2,y2 in self.generated:
                if track.GetNetname()!=net or track.GetLayer()!=layer:continue
                near=lambda p,x,y:abs(p.x-x)<=200 and abs(p.y-y)<=200
                if (near(a,x1,y1) and near(b,x2,y2)) or (near(a,x2,y2) and near(b,x1,y1)):
                    track.SetLocked(False);released+=1;break
        return {'reservedSegments':len(self.generated),'releasedGeneratedLocks':released,
                'scope':'only internally generated pre-route corridors; unrelated locked items preserved'}
