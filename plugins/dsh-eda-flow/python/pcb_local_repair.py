"""Bounded native repair of declared bridges and isolated filter returns.
Only current board copper, actual net assignments and visible process roles are used.
Every candidate remains provisional until full native DRC/parity and copper audit pass.
"""
import sys,json,math,heapq,time,shutil,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
import pcbnew as p
from record_io import read_json,write_json
from pcb_trace_simplification import polygon,union,intersects,contained,alternatives,shorten_tracks
from pcb_power_routes import _path,_tracks,reserve_power_routes
from pcb_route_cleanup import route_metrics,remove_redundant_tracks,merge_collinear_tracks
from pcb_process import placement_report,native_process

def copper_networks(board,layer):
 """Physical connectivity from filled copper, without a second geometry runtime.

 Union each net's actual tracks, pads and filled islands on one copper layer.
 A pad must touch exactly one island. No zone outline or pad name is evidence
 of connectivity. Native DRC remains independent and mandatory.
 """
 groups={};keepers=[];facts=[]
 for fp in board.GetFootprints():
  for pad in fp.Pads():
   if pad.GetNetCode()>0 and pad.IsOnLayer(layer):groups.setdefault(pad.GetNetCode(),[]).append(pad)
 for net,pads in sorted(groups.items()):
  shapes=[polygon(q,layer,inside=True) for q in pads]
  shapes.extend(polygon(t,layer,inside=True) for t in board.GetTracks() if t.GetNetCode()==net and t.IsOnLayer(layer))
  shapes.extend(p.SHAPE_POLY_SET(z.GetFilledPolysList(layer)) for z in board.Zones() if not z.GetIsRuleArea() and z.GetNetCode()==net and z.GetLayerSet().Contains(layer))
  copper=union(shapes);islands=[copper.UnitSet(i) for i in range(copper.OutlineCount())];keepers.extend(shapes+[copper]+islands)
  members=[[] for _ in islands];ambiguous=[]
  for pad in pads:
   shape=polygon(pad,layer,inside=True);keepers.append(shape)
   hits=[i for i,island in enumerate(islands) if intersects(shape,island)]
   row={'ref':pad.GetParentFootprint().GetReference(),'pin':pad.GetNumber(),'uuid':pad.m_Uuid.AsString()}
   if len(hits)!=1:ambiguous.append(row)
   for i in hits:members[i].append(row)
  occupied=[{'members':m} for m in members if m]
  facts.append({'net':pads[0].GetNetname(),'physicalPads':len(pads),'connectedPadGroups':occupied,
                'ambiguousPads':ambiguous,'allPhysicalPadsConnected':not ambiguous and len(occupied)==1 and len(occupied[0]['members'])==len(pads)})
 board._eda_local_copper_keepalive=keepers
 return {'method':'native union of actual single-layer tracks, pads and filled copper; no outline-based connectivity',
         'allPhysicalPadNetworksConnected':all(row['allPhysicalPadsConnected'] for row in facts),'networks':facts}


def compatibility_identity(board,protected_refs=()):
 # Normalize each footprint pose, retaining physical pad shape and assignment.
 # UUIDs identify instances within one board and are not geometry identities.
 def ring(shape):
  pts=[(round(p.ToMM(shape.CPoint(i).x),5),round(p.ToMM(shape.CPoint(i).y),5)) for i in range(shape.PointCount())]
  if not pts:return []
  options=[]
  for seq in (pts,list(reversed(pts))):
   start=min(range(len(seq)),key=lambda i:seq[i]);options.append(seq[start:]+seq[:start])
  return min(options)
 def polygons(shape):
  return sorted((ring(shape.COutline(i)),sorted(ring(shape.CHole(i,h)) for h in range(shape.HoleCount(i)))) for i in range(shape.OutlineCount()))
 components=[];keepers=[];protected=[]
 for original in board.GetFootprints():
  if original.IsLocked() or original.GetReference() in protected_refs:
   protected.append((original.GetReference(),xy(original.GetPosition()),original.GetOrientationDegrees(),original.IsLocked()))
  fp=p.FOOTPRINT(original);fp.SetOrientationDegrees(0);fp.SetPosition(p.VECTOR2I(0,0));keepers.append(fp);pads=[]
  for pad in fp.Pads():
   geometry=[]
   for layer in (p.F_Cu,p.B_Cu):
    if pad.IsOnLayer(layer):
     shape=polygon(pad,layer,inside=True);keepers.append(shape);geometry.append((layer,polygons(shape)))
   pads.append((pad.GetNumber(),pad.GetNetname(),pad.GetAttribute(),pad.GetShape(),xy(pad.GetSize()),xy(pad.GetDrillSize()),geometry))
  ident=fp.GetFPID();components.append((fp.GetReference(),fp.GetValue(),str(ident.GetLibNickname())+':'+str(ident.GetLibItemName()),fp.GetLayer(),sorted(pads)))
 outline=p.SHAPE_POLY_SET();board.GetBoardPolygonOutlines(outline,False);keepers.append(outline)
 board._eda_history_identity_keepalive=keepers
 return {'components':sorted(components),'outline':polygons(outline),'thickness':board.GetDesignSettings().GetBoardThickness(),'protectedPoses':sorted(protected)}

def compare_candidate_geometry(source,expected,request):
 name=Path(request['schematic']).stem+'.kicad_pcb'
 old=p.LoadBoard(str(source/name));fresh=p.LoadBoard(str(expected/name))
 return {'compatible':compatibility_identity(old,request['plan'].get('placements',{}))==compatibility_identity(fresh,request['plan'].get('placements',{})),'scope':'values, footprint identity, assembly sides, actual normalized pad copper, nets, board outline and thickness'}

def copy_project(source,dest):
 dest.mkdir(parents=True,exist_ok=True)
 for item in source.iterdir():
  if item.is_dir() and item.suffix=='.pretty':shutil.copytree(item,dest/item.name,dirs_exist_ok=True)
  elif item.suffix in ('.kicad_pro','.kicad_sch','.kicad_dru') or item.name in ('fp-lib-table','sym-lib-table'):
   shutil.copyfile(item,dest/item.name)

def native_check(folder,request):
 name=Path(request['schematic']).stem;dest=folder/'repair-drc.json'
 result=subprocess.run([request['cli'],'pcb','drc','--format','json','--schematic-parity','--severity-all','-o',str(dest.resolve()),str((folder/(name+'.kicad_pcb')).resolve())],capture_output=True,timeout=60)
 if result.returncode not in (0,5) or not dest.exists():raise ValueError('Native repair check failed: '+result.stderr.decode('utf8',errors='replace')[-1000:])
 data=read_json(dest);counts={k:len(data.get(k,[])) for k in ('violations','unconnected_items','schematic_parity')}
 return {'counts':counts,'passed':not any(counts.values()),'diagnostics':data}

def eligible_filters(request,audit):
 roles={c['ref']:c.get('electricalRole') for c in request.get('components',[])}
 protected=set(request['plan'].get('placements',{}))
 for relation in request.get('process',{}).get('relations',[]):
  protected.add(relation['ref'])
  protected.update(relation[key]['ref'] for key in ('anchor','return') if key in relation)
 refs=set()
 for net in audit['networks']:
  if net['allPhysicalPadsConnected']:continue
  ordered=sorted(net['connectedPadGroups'],key=lambda g:len(g['members']))
  for group in ordered[:-1]:
   refs.update(m['ref'] for m in group['members'] if roles.get(m['ref'])=='interface-filter' and m['ref'] not in protected)
 return sorted(refs)

def filter_poses(source,dest,request):
 plan=request['plan'];layer=p.B_Cu if plan['activeLayers']==['B.Cu'] else p.F_Cu
 board=p.LoadBoard(str(source/(Path(request['schematic']).stem+'.kicad_pcb')));audit=copper_networks(board,layer)
 footprints={f.GetReference():f for f in board.GetFootprints()};zone_nets={z.GetNetCode() for z in board.Zones() if not z.GetIsRuleArea()};rows=[];keepers=[]
 outline=p.SHAPE_POLY_SET();board.GetBoardPolygonOutlines(outline,False)
 for ref in eligible_filters(request,audit):
  fp=footprints[ref];moving=list(fp.Pads())
  if fp.IsLocked() or len(moving)!=2:continue
  origin=xy(fp.GetPosition());angle=fp.GetOrientationDegrees();signals={q.GetNetCode() for q in moving if q.GetNetCode() not in zone_nets}
  if len(signals)!=1 or 0 in signals:continue
  if any(t.GetNetCode() in signals and t.IsLocked() for t in board.GetTracks()):continue
  others=[(box(f),f.GetLayer()) for f in footprints.values() if f!=fp]
  fixedpads=[q for f in footprints.values() if f!=fp for q in f.Pads()]
  items=fixedpads+[t for t in board.GetTracks() if t.GetNetCode() not in signals]
  items += [g for f in footprints.values() if f!=fp for g in f.GraphicalItems() if g.IsOnCopperLayer()]
  items += [g for g in board.GetDrawings() if g.IsOnCopperLayer()]
  obstacles={q.GetNumber():union(polygon(i,layer,p.FromMM(plan['clearanceMm']+.003)) for i in items if i.IsOnLayer(layer) and (not hasattr(i,'GetNetCode') or i.GetNetCode()!=q.GetNetCode())) for q in moving}
  for z in board.Zones():
   if z.GetIsRuleArea() and z.GetLayerSet().Contains(layer) and z.GetDoNotAllowPads():
    for obstacle in obstacles.values():obstacle.BooleanAdd(z.Outline())
  keepers.append(obstacles)
  # A bounded local neighbourhood, independent of any board/reference pose.
  for da in (0,180,90,270):
   fp.SetOrientationDegrees((angle+da)%360)
   for dx in range(-8,9):
    for dy in range(-8,9):
     if not (dx or dy or da):continue
     fp.SetPosition(p.VECTOR2I(origin[0]+p.FromMM(dx*.5),origin[1]+p.FromMM(dy*.5)));bounds=box(fp)
     if any(side==fp.GetLayer() and overlaps(bounds,ob,p.FromMM(plan['componentGapMm'])) for ob,side in others):continue
     if any(intersects(polygon(q,layer),obstacles[q.GetNumber()]) or not contained(polygon(q,layer,p.FromMM(.503)),outline) for q in moving):continue
     rows.append({'ref':ref,'offsetMm':[dx*.5,dy*.5],'angleDelta':da,'distanceSquared':(dx*dx+dy*dy)*.25})
  fp.SetOrientationDegrees(angle);fp.SetPosition(p.VECTOR2I(*origin))
 rows.sort(key=lambda row:(row['distanceSquared'],row['ref'],row['angleDelta'],row['offsetMm']))
 write_json(dest,{'audit':audit,'poses':rows});return rows

def filter_candidate(source,dest,request,pose):
 name=Path(request['schematic']).stem;board=p.LoadBoard(str(source/(name+'.kicad_pcb')))
 fps={f.GetReference():f for f in board.GetFootprints()};fp=fps[pose['ref']];pads=list(fp.Pads());zone_nets={z.GetNetCode() for z in board.Zones() if not z.GetIsRuleArea()}
 signals={q.GetNetCode() for q in pads if q.GetNetCode() not in zone_nets};removed=[]
 if len(pads)!=2 or len(signals)!=1 or fp.IsLocked():raise ValueError('Ineligible local filter repair')
 fp.SetOrientationDegrees((fp.GetOrientationDegrees()+pose['angleDelta'])%360);at=fp.GetPosition()
 fp.SetPosition(p.VECTOR2I(at.x+p.FromMM(pose['offsetMm'][0]),at.y+p.FromMM(pose['offsetMm'][1])))
 for track in list(board.GetTracks()):
  if track.GetNetCode() in signals:
   if track.IsLocked():raise ValueError('Local repair cannot remove protected copper')
   board.Remove(track);removed.append(track)
 relations=[]
 for net in signals:
  targets=[q for f in fps.values() for q in f.Pads() if q.GetNetCode()==net];tree=targets[:1];pending=targets[1:]
  while pending:
   a,b=min(((a,b) for a in tree for b in pending),key=lambda pair:math.dist(xy(pair[0].GetPosition()),xy(pair[1].GetPosition())))
   relations.append({'ref':a.GetParentFootprint().GetReference(),'kind':'signal-repair','supplyPad':a.GetNumber(),'_sourcePhysicalUuid':a.m_Uuid.AsString(),
                     'anchor':{'ref':b.GetParentFootprint().GetReference(),'pad':b.GetNumber(),'_physicalUuid':b.m_Uuid.AsString()}})
   tree.append(b);pending.remove(b)
 routed=reserve_power_routes(board,{'relations':relations,'routeRoles':['anchor']},request['plan'],lock=False)
 board.BuildConnectivity();p.ZONE_FILLER(board).Fill(board.Zones());copy_project(source,dest);p.SaveBoard(str(dest/(name+'.kicad_pcb')),board)
 audit=copper_networks(board,p.B_Cu if request['plan']['activeLayers']==['B.Cu'] else p.F_Cu);check=native_check(dest,request)
 result={'pose':pose,'routes':routed,'quality':route_metrics(board),'copper':audit,'native':check,'passed':check['passed'] and audit['allPhysicalPadNetworksConnected']}
 write_json(dest/'repair-result.json',result);return result

def board_facts(source,request):
 name=Path(request['schematic']).stem;board=p.LoadBoard(str(source/(name+'.kicad_pcb')))
 layer=p.B_Cu if request['plan']['activeLayers']==['B.Cu'] else p.F_Cu
 footprints={f.GetReference():f for f in board.GetFootprints()};identity=[];poses={};locked=[]
 for ref,fp in sorted(footprints.items()):
  pads=sorted((q.m_Uuid.AsString(),q.GetNumber(),q.GetNetname(),q.GetShape(),q.GetAttribute(),xy(q.GetSize()),xy(q.GetDrillSize())) for q in fp.Pads())
  ident=fp.GetFPID();footprint_id=str(ident.GetLibNickname())+':'+str(ident.GetLibItemName())
  identity.append((ref,fp.GetValue(),footprint_id,pads));poses[ref]={'at':xy(fp.GetPosition()),'angle':fp.GetOrientationDegrees(),'side':fp.GetLayer(),'locked':fp.IsLocked()}
 for track in board.GetTracks():
  if track.IsLocked():locked.append((track.m_Uuid.AsString(),track.GetNetname(),track.GetLayer(),track.GetWidth(),xy(track.GetStart()),xy(track.GetEnd())))
 return {'identity':identity,'poses':poses,'lockedCopper':sorted(locked),'trackIds':[t.m_Uuid.AsString() for t in board.GetTracks()],'quality':route_metrics(board),
         'layers':sorted(set(p.LayerName(t.GetLayer()) for t in board.GetTracks() if not isinstance(t,p.PCB_VIA))),
         'vias':sum(isinstance(t,p.PCB_VIA) for t in board.GetTracks()),'copper':copper_networks(board,layer)}

def simplify_candidate(source,dest,request):
 name=Path(request['schematic']).stem;board=p.LoadBoard(str(source/(name+'.kicad_pcb')))
 layer=p.B_Cu if request['plan']['activeLayers']==['B.Cu'] else p.F_Cu
 before=route_metrics(board)
 cleanup=remove_redundant_tracks(board);collinear=merge_collinear_tracks(board)
 proposal=shorten_tracks(board,request['plan']['clearanceMm'],.5,connectivity_check=lambda b:copper_networks(b,layer)['allPhysicalPadNetworksConnected'])
 copy_project(source,dest);p.SaveBoard(str(dest/(name+'.kicad_pcb')),board);check=native_check(dest,request)
 after=route_metrics(board)
 result={'proposal':proposal,'cleanup':cleanup,'collinear':collinear,'before':before,'after':after,'native':check,
         'passed':check['passed'] and all(after[k]<=before[k] for k in ('trackLengthMm','segments','shortSegmentsUnder05mm','degree2Bends'))}
 write_json(dest/'simplification-result.json',result);return result

def refine_bridge_candidate(source,dest,request,options):
 name=Path(request['schematic']).stem;board=p.LoadBoard(str(source/(name+'.kicad_pcb')))
 fp=next(f for f in board.GetFootprints() if f.GetReference()==options['ref']);nets={q.GetNetCode() for q in fp.Pads()}
 before=route_metrics(board);original=set(options['originalTrackIds']);removed=[]
 for track in list(board.GetTracks()):
  if track.GetNetCode() in nets and track.m_Uuid.AsString() not in original and not track.IsLocked():board.Remove(track);removed.append(track)
 relations=[]
 for a in fp.Pads():
  others=[q for f in board.GetFootprints() if f.GetReference()!=fp.GetReference() for q in f.Pads() if q.GetNetCode()==a.GetNetCode()]
  if not others:raise ValueError('Bridge terminal has no existing external target')
  b=min(others,key=lambda q:(q.GetParentFootprint().GetReference(),q.GetNumber(),q.m_Uuid.AsString()))
  relations.append({'ref':fp.GetReference(),'kind':'routing-bridge','supplyPad':a.GetNumber(),'_sourcePhysicalUuid':a.m_Uuid.AsString(),
                    'anchor':{'ref':b.GetParentFootprint().GetReference(),'pad':b.GetNumber(),'_physicalUuid':b.m_Uuid.AsString()}})
 routed=reserve_power_routes(board,{'relations':relations,'routeRoles':['anchor']},request['plan'],lock=False)
 board.BuildConnectivity();p.ZONE_FILLER(board).Fill(board.Zones());copy_project(source,dest);p.SaveBoard(str(dest/(name+'.kicad_pcb')),board)
 check=native_check(dest,request);after=route_metrics(board);audit=copper_networks(board,p.B_Cu if request['plan']['activeLayers']==['B.Cu'] else p.F_Cu)
 result={'routes':routed,'before':before,'after':after,'native':check,'copper':audit,
         'passed':check['passed'] and audit['allPhysicalPadNetworksConnected'] and all(after[k]<=before[k] for k in ('trackLengthMm','segments','shortSegmentsUnder05mm','degree2Bends'))}
 write_json(dest/'tree-result.json',result);return result

def xy(v):return (v.x,v.y)
def box(f):
 items=list(f.Pads())+[g for g in f.GraphicalItems() if g.IsOnCopperLayer() or g.GetLayer() in (p.F_CrtYd,p.B_CrtYd,p.F_Fab,p.B_Fab)]
 if not items:items=[f]
 b=[i.GetBoundingBox() for i in items];m=p.FromMM(.35)
 return (min(q.GetX() for q in b)-m,min(q.GetY() for q in b)-m,max(q.GetRight() for q in b)+m,max(q.GetBottom() for q in b)+m)
def overlaps(a,b,gap=0):return a[0]<b[2]+gap and a[2]>b[0]-gap and a[1]<b[3]+gap and a[3]>b[1]-gap

def connected(board,pads):
 board.BuildConnectivity();c=board.GetConnectivity();pending=[pads[0]];seen=set()
 while pending:
  a=pending.pop();u=a.m_Uuid.AsString()
  if u in seen:continue
  seen.add(u);pending.extend(x for x in list(c.GetConnectedTracks(a))+list(c.GetConnectedPads(a)) if x.GetNetCode()==pads[0].GetNetCode())
 return all(q.m_Uuid.AsString() in seen for q in pads)

def bridge_candidates(source,dest,request,selected_ref=None):
 source=Path(source);dest=Path(dest);dest.mkdir(parents=True,exist_ok=True)
 plan=request['plan'];name=Path(request['schematic']).stem;board=p.LoadBoard(str(source/(name+'.kicad_pcb')))
 layer=p.B_Cu if plan['activeLayers']==['B.Cu'] else p.F_Cu
 if len(plan['activeLayers'])!=1:raise ValueError('local native repair currently supports one routing layer')
 fs={f.GetReference():f for f in board.GetFootprints()};pads=[q for f in fs.values() for q in f.Pads()];nets={}
 for q in pads:
  if q.GetNetCode()>0:nets.setdefault(q.GetNetCode(),[]).append(q)
 zonenets={z.GetNetCode() for z in board.Zones()}
 failed={n for n,ps in nets.items() if n not in zonenets and not connected(board,ps)}
 protected=set(plan.get('placements',{}))
 for relation in request.get('process',{}).get('relations',[]):
  protected.add(relation['ref']);protected.update(relation[k]['ref'] for k in ('anchor','return') if k in relation)
 refs=[r for r in sorted(request['process'].get('jumpers',[])) if (selected_ref is None or r==selected_ref) and r not in protected and r in fs and not fs[r].IsLocked() and len(list(fs[r].Pads()))==2 and any(q.GetNetCode() in failed for q in fs[r].Pads())]
 print(json.dumps({'failedNets':[nets[n][0].GetNetname() for n in failed],'bridges':refs}),flush=True)
 report={'geometrySource':'current generated PCB only','failedNets':[nets[n][0].GetNetname() for n in failed],'candidates':[],'accepted':False}
 if not refs:report['reason']='no eligible declared bridge on failed signal';write_json(dest/'result.json',report);return report
 fp=fs[refs[0]];moving=list(fp.Pads());ref=fp.GetReference();original=xy(fp.GetPosition());rot=fp.GetOrientationDegrees();removed=[];keepers=[]
 # A branch may end in several overlapping physical pads. Remove its tracks
 # only if the remaining physical terminal set still connects without them.
 for pad in moving:
  external=[q for q in nets[pad.GetNetCode()] if q.GetParentFootprint().GetReference()!=ref]
  old=[t for t in board.GetTracks() if t.GetNetCode()==pad.GetNetCode() and not t.IsLocked()]
  for t in old:board.Remove(t)
  if external and connected(board,external):removed.extend(old)
  else:
   for t in old:board.Add(t)
  keepers.extend(old)
 report['removedSegments']=len(removed);report['removedLengthMm']=sum(p.ToMM(t.GetLength()) for t in removed)
 board.BuildConnectivity();outline=p.SHAPE_POLY_SET();board.GetBoardPolygonOutlines(outline,False)
 width=p.FromMM(plan['trackWidthMm']);clear=p.FromMM(plan['clearanceMm']);safety=p.FromMM(.003)
 area=p.SHAPE_POLY_SET(outline);area.Inflate(-(width//2+p.FromMM(.5)+safety),p.CORNER_STRATEGY_ROUND_ALL_CORNERS,p.FromMM(.001))
 b=area.BBox();bounds=(b.GetX(),b.GetY(),b.GetRight(),b.GetBottom());step=p.FromMM(.25);gw=(bounds[2]-bounds[0])//step+1;gh=(bounds[3]-bounds[1])//step+1
 if gw*gh>300000:raise ValueError('Local repair lattice exceeds bounded search budget')
 def point(k):j,i=divmod(k,gw);return (bounds[0]+i*step,bounds[1]+j*step)
 def cells(pt):
  i,j=round((pt[0]-bounds[0])/step),round((pt[1]-bounds[1])/step)
  for y in range(max(0,j-2),min(gh,j+3)):
   for x in range(max(0,i-2),min(gw,i+3)):yield y*gw+x
 env={};fixedpads=[q for q in pads if q.GetParentFootprint().GetReference()!=ref];fixeditems=fixedpads+list(board.GetTracks())
 fixeditems += [g for f in fs.values() if f.GetReference()!=ref for g in f.GraphicalItems() if g.IsOnCopperLayer()]+[g for g in board.GetDrawings() if g.IsOnCopperLayer()]
 for pad in moving:
  net=pad.GetNetCode();foreign=[q for q in fixeditems if q.IsOnLayer(layer) and (not hasattr(q,'GetNetCode') or q.GetNetCode()!=net)]
  obs=union(polygon(q,layer,clear+width//2+safety) for q in foreign)
  padobs=union(polygon(q,layer,clear+safety) for q in foreign)
  for z in board.Zones():
   if z.GetIsRuleArea() and z.GetLayerSet().Contains(layer) and z.GetDoNotAllowTracks():
    zpoly=p.SHAPE_POLY_SET(z.Outline());zpoly.Inflate(width//2+safety,p.CORNER_STRATEGY_ROUND_ALL_CORNERS,p.FromMM(.001));obs.BooleanAdd(zpoly);keepers.append(zpoly)
  keepers.extend([obs,padobs])
  def free(pt,obs=obs):return area.Contains(p.VECTOR2I(*pt)) and not obs.Contains(p.VECTOR2I(*pt))
  def edge(a,b,obs=obs,free=free):return free(a) and free(b) and not obs.Collide(p.SEG(p.VECTOR2I(*a),p.VECTOR2I(*b)))
  goals={xy(q.GetPosition()) for q in nets[net] if q.GetParentFootprint().GetReference()!=ref}
  tracks=[t for t in board.GetTracks() if t.GetNetCode()==net and t.IsOnLayer(layer)]
  for t in tracks:goals.update([xy(t.GetStart()),xy(t.GetEnd())])
  # Multi-source shortest distances to the retained same-net tree, used to
  # reject unreachable poses before expensive full routing and native checks.
  distance={};qheap=[];avail={};edgecache={}
  for g in goals:
   for k in cells(g):
    pt=point(k)
    if edge(g,pt):
     d=math.dist(g,pt)
     if d<distance.get(k,math.inf):distance[k]=d;heapq.heappush(qheap,(d,k))
  expanded=0
  while qheap:
   d,k=heapq.heappop(qheap)
   if d>distance[k]:continue
   expanded+=1;j,i=divmod(k,gw)
   for di,dj in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
    ni,nj=i+di,j+dj
    if not(0<=ni<gw and 0<=nj<gh):continue
    nk=nj*gw+ni;nd=d+step*math.hypot(di,dj)
    if nd>=distance.get(nk,math.inf):continue
    if nk not in avail:avail[nk]=free(point(nk))
    if not avail[nk]:continue
    ek=tuple(sorted((k,nk)))
    if ek not in edgecache:edgecache[ek]=edge(point(k),point(nk))
    if edgecache[ek]:distance[nk]=nd;heapq.heappush(qheap,(nd,nk))
  env[pad.GetNumber()]={'net':net,'distance':distance,'free':free,'edge':edge,'obstacles':padobs,'goals':goals,'tracks':tracks}
  print(json.dumps({'net':pad.GetNetname(),'reachableCells':len(distance),'expanded':expanded}),flush=True)
 others=[(box(f),f.GetLayer()) for f in fs.values() if f.GetReference()!=ref];gap=p.FromMM(plan['componentGapMm']);choices=[];rejected={'body':0,'pad':0,'unreachable':0};tested=0
 through=[]
 for q in fixedpads:
  if q.IsOnLayer(layer) and q.GetParentFootprint().GetLayer()!=layer:
   qb=q.GetBoundingBox();through.append((qb.GetX(),qb.GetY(),qb.GetRight(),qb.GetBottom()))
 grid=p.FromMM(.5)
 # Broad phase uses translated native bounds and distance fields. Full polygon
 # and segment checks are deferred to the ranked candidate list.
 for angle in [0,90,180,270]:
  fp.SetOrientationDegrees(angle);fp.SetPosition(p.VECTOR2I(0,0));localbox=box(fp);offsets={q.GetNumber():xy(q.GetPosition()) for q in moving}
  for ix in range(math.ceil(bounds[0]/grid),math.floor(bounds[2]/grid)+1):
   for iy in range(math.ceil(bounds[1]/grid),math.floor(bounds[3]/grid)+1):
    pos=(ix*grid,iy*grid);bb=(localbox[0]+pos[0],localbox[1]+pos[1],localbox[2]+pos[0],localbox[3]+pos[1]);tested+=1
    if bb[0]<bounds[0] or bb[1]<bounds[1] or bb[2]>bounds[2] or bb[3]>bounds[3] or any(side==fp.GetLayer() and overlaps(bb,ob,gap) for ob,side in others) or any(overlaps(bb,ob,p.FromMM(.3)) for ob in through):rejected['body']+=1;continue
    score=0;ok=True
    for pin,offset in offsets.items():
     e=env[pin];pt=(pos[0]+offset[0],pos[1]+offset[1]);available=[e['distance'][k]+math.dist(point(k),pt) for k in cells(pt) if k in e['distance']]
     if not available:rejected['unreachable']+=1;ok=False;break
     score+=min(available)
    if ok:choices.append((score,math.dist(pos,original),angle,pos))
 print(json.dumps({'tested':tested,'feasible':len(choices),'rejected':rejected}),flush=True)
 report.update({'testedPoses':tested,'feasiblePoses':len(choices),'rejections':rejected})
 # Use actual routes for both terminals; flood distance is only a ranking.
 for ci,(score,movement,angle,pos) in enumerate(sorted(choices)[:1500]):
  fp.SetOrientationDegrees(angle);fp.SetPosition(p.VECTOR2I(*pos));added=[];routes=[];ok=True
  if any(intersects(polygon(pad,layer),env[pad.GetNumber()]['obstacles']) for pad in moving):continue
  for pad in moving:
   e=env[pad.GetNumber()];start=xy(pad.GetPosition());goals=set(e['goals'])
   for t in e['tracks']:
    a,z=xy(t.GetStart()),xy(t.GetEnd());dx,dy=z[0]-a[0],z[1]-a[1];den=dx*dx+dy*dy
    if den:
     u=max(0,min(1,((start[0]-a[0])*dx+(start[1]-a[1])*dy)/den));goals.add((round(a[0]+u*dx),round(a[1]+u*dy)))
   extra=union(polygon(t,layer,clear+width//2+safety) for t in added+moving if t.GetNetCode()!=e['net'])
   def free(pt,e=e,extra=extra):return e['free'](pt) and not extra.Contains(p.VECTOR2I(*pt))
   def edge(a,b,e=e,extra=extra):return e['edge'](a,b) and not extra.Collide(p.SEG(p.VECTOR2I(*a),p.VECTOR2I(*b)))
   path=None
   for goal in sorted(goals,key=lambda g:(math.dist(start,g),g)):
    option,method,expanded=_path(start,goal,free,edge,bounds,step,seconds=1)
    if option:
     # Establish a feasible terminal tree before optimizing it. Choosing a
     # shorter branch here can enclose a return island and remove otherwise
     # usable filter poses; optimize only with the complete copper check.
     path=option;break
   if path is None:ok=False;break
   new=_tracks(board,path,pad.GetNet(),layer,width)
   for t in new:t.SetLocked(False);board.Add(t);added.append(t)
   routes.append({'net':pad.GetNetname(),'lengthMm':sum(p.ToMM(t.GetLength()) for t in new),'segments':len(new)})
  candidate={'rank':ci,'ref':ref,'positionMm':[p.ToMM(v) for v in pos],'rotation':angle,'moveMm':p.ToMM(round(movement)),'routes':routes,'routed':ok}
  if ok:
   p.ZONE_FILLER(board).Fill(board.Zones());folder=dest/('candidate-'+str(ci));folder.mkdir(exist_ok=True);p.SaveBoard(str(folder/(name+'.kicad_pcb')),board);shutil.copyfile(source/(name+'.kicad_pro'),folder/(name+'.kicad_pro'));shutil.copyfile(source/(name+'.kicad_sch'),folder/(name+'.kicad_sch'));candidate['file']=str(folder/(name+'.kicad_pcb'))
  if ok:
   for lib in source.glob('*.pretty'):
    shutil.copytree(lib,folder/lib.name,dirs_exist_ok=True)
   if (source/'fp-lib-table').exists():shutil.copyfile(source/'fp-lib-table',folder/'fp-lib-table')
   drcfile=folder/'drc.json'
   cli=subprocess.run([request['cli'],'pcb','drc','--format','json','--schematic-parity','-o',str(drcfile.resolve()),str((folder/(name+'.kicad_pcb')).resolve())],capture_output=True,timeout=45)
   if drcfile.exists():
    d=json.loads(drcfile.read_text(encoding='utf8'));candidate['drc']={k:len(d.get(k,[])) for k in ['violations','unconnected_items','schematic_parity']};candidate['drc']['types']=[v['type'] for v in d.get('violations',[])];candidate['passed']=not any(candidate['drc'][k] for k in ['violations','unconnected_items','schematic_parity'])
   else:candidate['passed']=False;candidate['drcError']=cli.stderr.decode('utf8',errors='replace')[-1000:]
  report['candidates'].append(candidate);print(json.dumps(candidate),flush=True)
  write_json(dest/'result.json',report)
  for t in added:board.Remove(t)
  keepers.extend(added)
  if candidate.get('passed'):report['accepted']=True;break
  # Keep only a bounded frontier; a zero-geometry-error candidate with an
  # isolated plane return can be repaired by the next generic stage.
  if candidate.get('drc',{}).get('violations')==0 and candidate.get('drc',{}).get('schematic_parity')==0:break
  if sum(c['routed'] for c in report['candidates'])>=6:break
 (dest/'result.json').write_text(json.dumps(report,indent=2),encoding='utf8')
 return report

if __name__=='__main__':
 mode,request_file,source_arg,dest_arg=sys.argv[1:5];request=read_json(request_file);source=Path(source_arg);dest=Path(dest_arg)
 if mode=='compatible':write_json(dest,compare_candidate_geometry(source,Path(sys.argv[5]),request))
 elif mode=='bridges':bridge_candidates(source,dest,request,sys.argv[5] if len(sys.argv)>5 else None)
 elif mode=='filter-poses':filter_poses(source,dest,request)
 elif mode=='filter':filter_candidate(source,dest,request,read_json(sys.argv[5]))
 elif mode=='facts':write_json(dest,board_facts(source,request))
 elif mode=='simplify':simplify_candidate(source,dest,request)
 elif mode=='tree':refine_bridge_candidate(source,dest,request,read_json(sys.argv[5]))
 else:raise ValueError('Unknown local repair worker mode')
