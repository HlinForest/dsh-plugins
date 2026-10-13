"""Independent output verifier. Reads model output; writes only a separate audit dir."""
import argparse,collections,hashlib,json,math,statistics,subprocess,shutil
from pathlib import Path
import xml.etree.ElementTree as ET
import sexpdata as sx
import pcbnew as pcb
import wx
from dependencies import library_dependencies
from graphics import check_graphics, hidden
from associations import check_associations, check_object_ids, native_source_file
from models import check_model_assets
# KiCad may emit a modal warning when loading legacy pours. Keep the warning in
# stderr so automated verification cannot hang waiting for an invisible dialog.
logTarget=wx.LogStderr()
previousLogTarget=wx.Log.SetActiveTarget(logTarget)
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--project',required=True);p.add_argument('--out',required=True);p.add_argument('--cli',required=True);p.add_argument('--stage',choices=['schematic','full'],default='full');a=p.parse_args()
inp=Path(a.input); project=Path(a.project); out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
CLI=a.cli
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def dump(n,x):(out/n).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf-8')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def xy(v):return [v.x,v.y]
def poly(p):
 def contour(c):return [xy(c.CPoint(i)) for i in range(c.PointCount())]
 return [[contour(p.COutline(i)),[contour(p.CHole(i,j)) for j in range(p.HoleCount(i))]] for i in range(p.OutlineCount())]
def boardgeom(b):
 footprints=list(b.GetFootprints())
 return {'placements':[{'ref':f.GetReference(),'pos':xy(f.GetPosition()),'angle':f.GetOrientationDegrees(),'layer':f.GetLayer()} for f in footprints],
 'pads':[{'pos':xy(p.GetPosition()),'size':xy(p.GetSize()),'drill':xy(p.GetDrillSize()),'shape':int(p.GetShape()),'attribute':int(p.GetAttribute()),'angle':p.GetOrientationDegrees(),'net':p.GetNetname(),'layers':list(p.GetLayerSet().Seq()),'copper':{str(l):poly(p.GetEffectivePolygon(l)) for l in (pcb.F_Cu,pcb.B_Cu) if p.IsOnLayer(l)}} for f in footprints for p in f.Pads()],
 'tracks':[{'start':xy(t.GetStart()),'end':xy(t.GetEnd()),'width':t.GetWidth(),'layer':t.GetLayer(),'kind':t.GetClass(),'net':t.GetNetname(),'mid':xy(t.GetMid()) if t.GetClass()=='PCB_ARC' else None} for t in b.GetTracks()],
 'zones':[{'outline':poly(z.Outline()),'layers':list(z.GetLayerSet().Seq()),'ruleArea':z.GetIsRuleArea(),'net':z.GetNetname(),'fill':{str(l):poly(z.GetFilledPolysList(l)) for l in (pcb.F_Cu,pcb.B_Cu) if z.HasFilledPolysForLayer(l)}} for z in b.Zones()]}
def multiset(rows):return collections.Counter(json.dumps(x,sort_keys=True,ensure_ascii=False) for x in rows)
def tag(v):return str(v[0]) if isinstance(v,list) and v else ''
def kids(x,t):return [v for v in x if tag(v)==t]
def kid(x,t,default=None):return next(iter(kids(x,t)),default)
def value(x,t,default=None):
 c=kid(x,t);return c[1] if c and len(c)>1 else default
def props(x):return {c[1]:c[2] for c in kids(x,'property')}
def raw(f,k):return float(f.get(k,0))+float(f.get(k+'_Frac',0))/100000
def call(name,args):
 r=subprocess.run([CLI,*args],capture_output=True,timeout=180)
 d={'argv':[CLI,*args],'returncode':r.returncode,'stdout':r.stdout.decode('utf-8','replace'),'stderr':r.stderr.decode('utf-8','replace')};dump(name+'.command.json',d);report.setdefault('toolRuns',[]).append({'name':name,'returncode':r.returncode});return d
report={'status':'PARTIAL','project':str(project),'independentOfGenerator':True,'completeOneToOneVerified':False,'sourceIntegrity':[],'checks':{},'limitations':['Missing native Altium compiler/PDF/BOM and rules reports','Same-vendor PCB import comparison cannot prove every Altium primitive converted correctly','Complete schematic symbol/typography/page equivalence requires separate object and visual review']}
verifierDir=out/'verifier';verifierDir.mkdir(exist_ok=True)
report['verifierCode']=[]
for name in ['audit.py','dependencies.py','graphics.py','curves.py','associations.py','models.py']:
 source=Path(__file__).parent/name;shutil.copyfile(source,verifierDir/name);report['verifierCode'].append({'path':name,'sha256':sha(verifierDir/name)})
for item in read(inp/'manifest.json')['files']:
 actual=sha(inp/item['path']);report['sourceIntegrity'].append({'path':item['path'],'match':actual==item['sha256']})
sch=project.with_suffix('.kicad_sch');boardpath=project.with_suffix('.kicad_pcb')
target_to_source={}
native=read(inp/'02_extracted/native_schematic/components.json')
if sch.exists():
 report['schematicSHA256']=sha(sch)
 tree=sx.load(sch.open(encoding='utf-8'));syms=kids(tree,'symbol');byref={props(s).get('Reference'):s for s in syms}
 report['checks']['schematicObjectIdentity']=check_object_ids(tree)
 report['checks']['libraryDependencies']=library_dependencies(project,tree)
 # No guessed renumbering: an explicit unique source-id property is required.
 aliases={}
 for c in native:
  if c['reference'] in byref:continue
  uid=c['raw_fields'].get('UniqueID')
  matches=[ref for ref,s in byref.items() if uid and uid in props(s).values()]
  if len(matches)==1:aliases[c['reference']]=matches[0]
 getref=lambda r:aliases.get(r,r)
 target_to_source={v:k for k,v in aliases.items()}
 missingFootprints=[]
 for component in native:
  implementations=[i.get('fields',{}) for i in component.get('implementations',[]) if i.get('fields',{}).get('ModelType','').upper()=='PCBLIB']
  placed=byref.get(getref(component['reference']))
  if implementations and placed is not None and not props(placed).get('Footprint'):
   missingFootprints.append({'reference':component['reference'],'nativeModels':[i.get('ModelName') for i in implementations]})
 report['checks']['footprintAssignments']={'match':not missingFootprints,'missingAssignments':missingFootprints,'limit':'Detects lost assignment only; exact model choice and mapped footprint geometry need separate verification'}
 missing=[];params=[];anchor=[]
 for c in native:
  r=c['reference'];s=byref.get(getref(r))
  if s is None:missing.append(r);continue
  pr=props(s)
  for param in c['parameters']:
   name=param['name'];expected=param['value'];key={'Designator':'Reference','Comment':'Value'}.get(name,name)
   actual=pr.get(key)
   if key=='Reference' and aliases.get(str(expected))==actual:continue
   if str(actual)!=str(expected):params.append({'reference':r,'field':name,'expected':expected,'actual':actual})
  f=c['raw_fields'];at=kid(s,'at')
  if at:anchor.append({'reference':r,'native':[raw(f,'Location.X'),raw(f,'Location.Y')],'output':[float(at[1]),float(at[2])],'nativeOrientation':int(f.get('Orientation',0)),'outputAngle':float(at[3]) if len(at)>3 else 0})
 report['checks']['components']={'expected':len(native),'actualNonPower':len([r for r in byref if r and not r.startswith('#')]),'missing':missing,'unexpected':[r for r in byref if r and not r.startswith('#') and target_to_source.get(r,r) not in {c['reference'] for c in native}],'aliases':aliases}
 report['checks']['parameters']={'differences':params,'match':not missing and not params}
 if anchor:
  tx=statistics.median(x['output'][0]-x['native'][0]*.254 for x in anchor);ty=statistics.median(x['output'][1]+x['native'][1]*.254 for x in anchor)
  convert=lambda x,y:[round(x*.254+tx,6),round(-y*.254+ty,6)]
  for v in anchor:v['residualMm']=math.dist(v['output'],convert(*v['native']))
  report['checks']['placement']={'method':'Fit only global translation, fixed native unit and Y inversion; absolute page origin remains unverified','translationMm':[tx,ty],'maxResidualMm':max(v['residualMm'] for v in anchor),'objects':anchor}
  records=read(inp/'02_extracted/native_schematic/FileHeader.records.json')['records'];segments=[]
  report['checks'].update(check_graphics(records,native,tree,[tx,ty],aliases))
  def all_texts(node):
   found=[]
   if not isinstance(node,list):return found
   if tag(node)=='text' and len(node)>1:found.append(str(node[1]))
   for x in node:
    if isinstance(x,list):found.extend(all_texts(x))
   return found
  nativeTexts=[r['fields'].get('%UTF8%Text',r['fields'].get('Text','')) for r in records if r['fields'].get('RECORD')=='4' and r['fields'].get('IsHidden')!='T']
  sourceLibraries={str(v[1]):v for v in kids(kid(tree,'lib_symbols',[]),'symbol')}
  outputTexts=all_texts([v for v in tree if tag(v) not in ['lib_symbols','symbol']])
  for symbol in syms:
   definition=sourceLibraries.get(str(value(symbol,'lib_id')),[])
   unit=str(value(symbol,'unit',1))
   for body in kids(definition,'symbol'):
    suffix=str(body[1]).rsplit('_',2)
    if len(suffix)==3 and suffix[-2] in ['0',unit] and suffix[-1] in ['0','1']:outputTexts+=all_texts(body)
  missingTexts=collections.Counter(nativeTexts)-collections.Counter(outputTexts)
  report['checks']['sourceGraphicText']={'sourceVisibleTextRecords':len(nativeTexts),'outputTextObjects':len(outputTexts),'missingText':list(missingTexts.elements()),'match':not missingTexts,'limit':'Checks text content presence only; text location, visibility and symbol shape coverage need separate review'}
  for record in records:
   f=record['fields']
   if f.get('RECORD')=='27':
    pts=[convert(raw(f,'X'+str(i)),raw(f,'Y'+str(i))) for i in range(1,int(f['LocationCount'])+1)];segments.extend(zip(pts,pts[1:]))
  def segmentkey(ps):return tuple(sorted(tuple(round(float(q),5) for q in pt) for pt in ps))
  actual=[segmentkey([v[1:] for v in kids(kid(w,'pts',[]),'xy')]) for w in kids(tree,'wire')]
  expected=[segmentkey(s) for s in segments]
  report['checks']['wireGeometry']={'expectedSegments':len(expected),'actualSegments':len(actual),'match':collections.Counter(expected)==collections.Counter(actual)}
  for nativeType,targetType in [('22','no_connect'),('29','junction')]:
   expectedPoints=[tuple(convert(raw(r['fields'],'Location.X'),raw(r['fields'],'Location.Y'))) for r in records if r['fields'].get('RECORD')==nativeType]
   actualPoints=[tuple(round(float(q),6) for q in kid(v,'at')[1:3]) for v in kids(tree,targetType)]
   report['checks'][targetType]={'expected':len(expectedPoints),'actual':len(actualPoints),'match':collections.Counter(expectedPoints)==collections.Counter(actualPoints)}
  libraries={str(x[1]):x for x in kids(kid(tree,'lib_symbols',[]),'symbol')};pinDiff=[];pinCount=0;pinGeometry=[];pinVisual=[]
  electric={'0':'input','1':'bidirectional','2':'output','3':'open_collector','4':'passive','5':'tri_state','6':'open_emitter','7':'power_in'}
  sourcePins=read(inp/'02_extracted/native_schematic/pins.json');sourceEndpoints={(x['ref'],x['pin']):x['endpoint'] for x in read(inp/'02_extracted/native_schematic/recomputed_connectivity.json')['pins']}
  for c in native:
   s=byref.get(getref(c['reference']))
   if s is None:continue
   lib=libraries.get(str(value(s,'lib_id')))
   if lib is None:pinDiff.append({'reference':c['reference'],'issue':'embedded symbol definition missing'});continue
   unit=int(value(s,'unit',1));pins=[]
   for sub in kids(lib,'symbol'):
    suffix=str(sub[1]).rsplit('_',2)
    if len(suffix)==3 and suffix[-2] in ['0',str(unit)] and suffix[-1] in ['0','1']:pins+=kids(sub,'pin')
   numberMap={str(value(x,'number')):x for x in pins};pinCount+=len(pins)
   for sp in [x for x in sourcePins if x['reference']==c['reference']]:
    dest=numberMap.get(str(sp['pin']));sf=sp['fields']
    if dest is None:pinDiff.append({'reference':c['reference'],'pin':sp['pin'],'issue':'pin missing'});continue
    flags=int(sf.get('PinConglomerate',0));showName=sf.get('ShowName')=='T' if 'ShowName' in sf else bool(flags&8);showNumber=sf.get('ShowDesignator')=='T' if 'ShowDesignator' in sf else bool(flags&16)
    actualName=not hidden(kid(lib,'pin_names',[])) and not hidden(kid(dest,'name',[]));actualNumber=not hidden(kid(lib,'pin_numbers',[])) and not hidden(kid(dest,'number',[]))
    if showName!=actualName or showNumber!=actualNumber:pinVisual.append({'reference':c['reference'],'pin':sp['pin'],'expectedNameVisible':showName,'actualNameVisible':actualName,'expectedNumberVisible':showNumber,'actualNumberVisible':actualNumber})
    expectedName=sf.get('%UTF8%Name',sf.get('Name',''));expectedType=electric.get(sf.get('Electrical'))
    if str(value(dest,'name',''))!=expectedName or expectedType and str(dest[1])!=expectedType:pinDiff.append({'reference':c['reference'],'pin':sp['pin'],'expectedName':expectedName,'outputName':str(value(dest,'name','')),'expectedType':expectedType,'outputType':str(dest[1])})
    sa=kid(s,'at');pa=kid(dest,'at');ep=sourceEndpoints.get((c['reference'],sp['pin']))
    if sa and pa and ep:
     if kid(s,'mirror'):pinGeometry.append({'reference':c['reference'],'pin':sp['pin'],'status':'mirror transform not implemented by verifier'});continue
     angle=math.radians(float(sa[3]) if len(sa)>3 else 0);px,py=float(pa[1]),float(pa[2]);gx=float(sa[1])+px*math.cos(angle)-py*math.sin(angle);gy=float(sa[2])-px*math.sin(angle)-py*math.cos(angle)
     expectedPoint=convert(*ep);pinGeometry.append({'reference':c['reference'],'pin':sp['pin'],'expected':expectedPoint,'actual':[gx,gy],'residualMm':math.dist([gx,gy],expectedPoint)})
  report['checks']['pinDefinitions']={'expected':len(sourcePins),'actual':pinCount,'differences':pinDiff,'match':pinCount==len(sourcePins) and not pinDiff}
  report['checks']['pinTextVisibility']={'match':not pinVisual,'differences':pinVisual,'limit':'Original ShowName/ShowDesignator fields or PinConglomerate bits versus library/per-pin visibility. Does not establish text metrics or arbitrary pin glyph appearance.'}
  report['checks']['pinEndpoints']={'expected':len(sourcePins),'compared':len(pinGeometry),'differences':[x for x in pinGeometry if x.get('residualMm',1)>.00001],'match':len(pinGeometry)==len(sourcePins) and all(x.get('residualMm',1)<=.00001 for x in pinGeometry)}
 net=out/'netlist.xml';netrun=call('netlist',['sch','export','netlist','--format','kicadxml','--output',str(net),str(sch)])
 if netrun['returncode']==0 and net.exists():
  compiled=ET.parse(net).getroot();parts=[];netnames={}
  for n in compiled.findall('./nets/net'):
   nodes=tuple(sorted((target_to_source.get(e.attrib['ref'],e.attrib['ref']),e.attrib['pin']) for e in n.findall('node')))
   if nodes:parts.append(nodes);netnames[nodes]=n.attrib.get('name','')
  ng=read(inp/'02_extracted/native_schematic/recomputed_connectivity.json')['nets'];expected=[tuple(sorted(tuple(n) for n in g['nodes'])) for g in ng]
  missingparts=[x for x in expected if x not in parts];extraparts=[x for x in parts if x not in expected]
  nameDiff=[{'nodes':g['nodes'],'sourceLabels':g['labels'],'outputName':netnames.get(tuple(sorted(tuple(n) for n in g['nodes'])))} for g in ng if g.get('labels') and netnames.get(tuple(sorted(tuple(n) for n in g['nodes'])),'').lstrip('/') not in g['labels']]
  report['checks']['connectivity']={'match':collections.Counter(expected)==collections.Counter(parts),'expectedPinGroups':len(expected),'actualPinGroups':len(parts),'missingGroups':missingparts,'unexpectedGroups':extraparts,'netNameDifferences':nameDiff,'basis':'Native geometric recomputation, not native Altium compiler'}
 call('erc',['sch','erc','--format','json','--output',str(out/'erc.json'),str(sch)])
 call('schematic-pdf',['sch','export','pdf','--output',str(out/'schematic.pdf'),str(sch)])
 call('schematic-svg',['sch','export','svg','--output',str(out/'schematic-svg'),str(sch)])
else:report['checks']['schematic']={'missing':True}
if boardpath.exists() and a.stage=='full':
 report['pcbSHA256']=sha(boardpath)
 b=pcb.LoadBoard(str(boardpath));fps=list(b.GetFootprints());pads=[pad for f in fps for pad in f.Pads()]
 report['checks']['pcbObjects']={'footprints':len(fps),'pads':len(pads),'tracks':len(list(b.GetTracks())),'zones':len(list(b.Zones())),'drawings':len(list(b.GetDrawings())),'copperLayers':b.GetCopperLayerCount()}
 dep=[]
 boardTree=sx.load(boardpath.open(encoding='utf-8'))
 report['checks']['pcbObjectIdentity']=check_object_ids(boardTree)
 if sch.exists():
  nativeBoardComponents=read(inp/'02_extracted/native_pcb/Components6_Data.records.json')['records']
  report['checks']['schematicPcbAssociation']=check_associations(native,nativeBoardComponents,tree,boardTree,aliases)
  tablePath=project.parent/'fp-lib-table';fpLibraries={};libraryRows=[]
  if tablePath.exists():
   for lib in kids(sx.loads(tablePath.read_text(encoding='utf-8')),'lib'):
    uri=str(value(lib,'uri','')).replace('${KIPRJMOD}',str(project.parent));folder=Path(uri)
    if not folder.is_absolute():folder=project.parent/folder
    if folder.resolve().is_relative_to(project.parent.resolve()):fpLibraries[str(value(lib,'name'))]=folder
  def padSignature(p):return {'number':p.GetNumber(),'size':xy(p.GetSize()),'drill':xy(p.GetDrillSize()),'shape':int(p.GetShape()),'attribute':int(p.GetAttribute())}
  for f in fps:
   symbol=byref.get(f.GetReference());assignment=props(symbol).get('Footprint','') if symbol else ''
   if not assignment or ':' not in assignment:continue
   name,item=assignment.split(':',1);folder=fpLibraries.get(name);loaded=None
   if folder:
    try:loaded=pcb.FootprintLoad(str(folder),item)
    except Exception:pass
   expectedPads=multiset([padSignature(p) for p in f.Pads()]);actualPads=multiset([padSignature(p) for p in loaded.Pads()]) if loaded else collections.Counter()
   expectedGraphics=len(list(f.GraphicalItems()));actualGraphics=len(list(loaded.GraphicalItems())) if loaded else 0
   libraryRows.append({'reference':f.GetReference(),'assignment':assignment,'match':loaded is not None and expectedPads==actualPads and expectedGraphics==actualGraphics,'boardPads':sum(expectedPads.values()),'libraryPads':sum(actualPads.values()),'boardGraphics':expectedGraphics,'libraryGraphics':actualGraphics})
  report['checks']['libraryFootprintGeometry']={'match':all(row['match'] for row in libraryRows),'objects':libraryRows,'limit':'Compares each linked board footprint to its assigned local library using pad numbers/shapes/dimensions/drills and graphic counts. Detailed local placement, graphics and model geometry still require review.'}
 nativeRules=read(inp/'02_extracted/native_pcb/Rules6_Data.records.json')['records']
 projectSettings=read(project)
 configured=projectSettings.get('board',{}).get('design_settings',{}).get('rules',{})
 classes=projectSettings.get('net_settings',{}).get('classes',[])
 customRules=project.with_suffix('.kicad_dru')
 customText=customRules.read_text(encoding='utf-8') if customRules.exists() else ''
 report['checks']['ruleConfiguration']={'match':bool(configured or classes or '(rule ' in customText) or not nativeRules,'nativeRules':len(nativeRules),'configuredValues':configured,'netClassCount':len(classes),'customRulesPresent':'(rule ' in customText,'limit':'Rejects total loss of rule configuration; rule priorities, scopes and cross-CAD semantics require a documented mapping and review.'}
 embeddedNames={str(value(f,'name')) for f in kids(kid(boardTree,'embedded_files',[]),'file') if kid(f,'data')}
 for f in fps:
  for m in f.Models():
   if m.m_Filename.startswith('kicad-embed://'):
    dep.append({'ref':f.GetReference(),'path':m.m_Filename,'exists':m.m_Filename.removeprefix('kicad-embed://') in embeddedNames,'basis':'Board-level embedded payload presence; no full STEP geometry comparison'});continue
   target=Path(m.m_Filename.replace('${KIPRJMOD}',str(boardpath.parent)))
   if not target.is_absolute():target=boardpath.parent/target
   local=target.resolve().is_relative_to(boardpath.parent.resolve())
   dep.append({'ref':f.GetReference(),'path':m.m_Filename,'exists':target.is_file() and local,'sha256':sha(target) if target.is_file() and local else None,'local':local})
 report['checks']['modelDependencies']=dep
 try:report['checks']['modelAssetAndPlacement']=check_model_assets(inp,project,boardTree,target_to_source)
 except (KeyError,ValueError,StopIteration,IndexError,OSError) as exc:report['checks']['modelAssetAndPlacement']={'match':False,'error':str(exc),'limit':'Unable to establish original model identity/placement'}
 original=native_source_file(inp,read(inp/'manifest.json'),'.PcbDoc');basepath=out/'independent-native-import.kicad_pcb'
 importSource=out/'import-source'/'native.PcbDoc';importSource.parent.mkdir(exist_ok=True);shutil.copyfile(original,importSource)
 assert sha(original)==sha(importSource)
 for attempt in range(3):
  basepath=out/('independent-native-import-'+str(attempt)+'.kicad_pcb')
  importRun=call('independent-import-'+str(attempt),['pcb','import','--format','altium','--report-format','json','--report-file',str(out/('import-report-'+str(attempt)+'.json')),'--output',str(basepath),str(importSource)])
  if importRun['returncode']==0 and basepath.exists():break
 report['checks']['independentImport']={'returncode':importRun['returncode'],'sourceSHA256':sha(original),'copySHA256':sha(importSource),'outputExists':basepath.exists()}
 if importRun['returncode']==0 and basepath.exists():
  importedBoard=pcb.LoadBoard(str(basepath));base=boardgeom(importedBoard);actual=boardgeom(b)
  originalModels=collections.Counter(f.GetReference() for f in importedBoard.GetFootprints() for m in f.Models())
  actualModels=collections.Counter(target_to_source.get(f.GetReference(),f.GetReference()) for f in b.GetFootprints() for m in f.Models())
  report['checks']['modelReferenceCoverage']={'match':originalModels==actualModels,'expected':dict(originalModels),'actual':dict(actualModels),'limit':'Per-footprint model reference counts against official import, not original STEP/body equivalence'}
  for row in actual['placements']:row['ref']=target_to_source.get(row['ref'],row['ref'])
  report['checks']['pcbImportedGeometry']={k:{'sourceCount':len(base[k]),'outputCount':len(actual[k]),'matches':multiset(base[k])==multiset(actual[k]),'missing':sum((multiset(base[k])-multiset(actual[k])).values()),'extra':sum((multiset(actual[k])-multiset(base[k])).values())} for k in base}
  def clean(v):
   if not isinstance(v,list):return str(v) if isinstance(v,sx.Symbol) else v
   return [clean(x) for x in v if not isinstance(x,list) or tag(x) not in ['uuid','tstamp']]
  baseTree=sx.load(basepath.open(encoding='utf-8'));targetTree=sx.load(boardpath.open(encoding='utf-8'))
  def modelPoses(t,aliases=None):
   aliases=aliases or {};return [{'ref':aliases.get(props(f).get('Reference'),props(f).get('Reference')),'pose':clean(m[2:])} for f in kids(t,'footprint') for m in kids(f,'model')]
  sourcePoses=multiset(modelPoses(baseTree));outputPoses=multiset(modelPoses(targetTree,target_to_source))
  report['checks']['modelPosePreservation']={'match':sourcePoses==outputPoses,'sourceModels':sum(sourcePoses.values()),'outputModels':sum(outputPoses.values()),'missing':sum((sourcePoses-outputPoses).values()),'extra':sum((outputPoses-sourcePoses).values()),'limit':'Exact scale/offset/rotation fields compared to independent official import; native 3D rendering still needs review.'}
  def graphics(t):return [clean(x) for x in t if tag(x).startswith('gr_') or tag(x)=='dimension']
  bg=multiset(graphics(baseTree));tg=multiset(graphics(targetTree))
  report['checks']['pcbBoardGraphics']={'sourceCount':sum(bg.values()),'outputCount':sum(tg.values()),'match':bg==tg,'missing':sum((bg-tg).values()),'extra':sum((tg-bg).values())}
 call('drc',['pcb','drc','--format','json','--schematic-parity','--output',str(out/'drc.json'),str(boardpath)])
 for l in ['F.Cu','B.Cu','F.SilkS','B.SilkS','Edge.Cuts']:
  call('layer-'+l,['pcb','export','svg','--exclude-drawing-sheet','--layers',l,'--output',str(out/'pcb-svg'/l),str(boardpath)])
elif a.stage=='full':report['checks']['pcb']={'missing':True}
for name in ['erc','drc']:
 f=out/(name+'.json')
 if f.exists():
  j=read(f);violations=j.get('violations',[])+[v for s in j.get('sheets',[]) for v in s.get('violations',[])];report['checks'][name]={k:len(j.get(k,[])) for k in ['unconnected_items','schematic_parity']};report['checks'][name]['violations']=len(violations);report['checks'][name]['severities']=dict(collections.Counter(v.get('severity') for v in violations));report['checks'][name]['ignoredChecks']=j.get('ignored_checks',[])
failures=[]
if any(r['returncode']!=0 for r in report.get('toolRuns',[]) if not r['name'].startswith('independent-import-')):failures.append('toolExecution')
if sch.exists() and 'connectivity' not in report['checks']:failures.append('connectivityUnavailable')
importCheck=report['checks'].get('independentImport')
if importCheck and (importCheck['returncode']!=0 or not importCheck['outputExists']):failures.append('independentImportUnavailable')
if not all(x['match'] for x in report['sourceIntegrity']):failures.append('sourceIntegrity')
for k,v in report['checks'].items():
 if isinstance(v,dict) and (v.get('match') is False or v.get('missing') is True):failures.append(k)
 if k=='components' and (v['missing'] or v['unexpected']):failures.append(k)
 if k=='placement' and v['maxResidualMm']>.00001:failures.append(k)
 if k=='connectivity' and v['netNameDifferences']:failures.append('netNames')
 if k=='pcbImportedGeometry' and any(not row['matches'] for row in v.values()):failures.append(k)
 if k=='modelDependencies' and any(not row['exists'] for row in v):failures.append(k)
report['failedChecks']=sorted(set(failures))
if failures:report['status']='FAIL'
dump('independent-verification.json',report)
print(json.dumps({'out':str(out),'status':report['status'],'checks':{k:v for k,v in report['checks'].items() if k not in ['placement','parameters','modelDependencies']}},ensure_ascii=False))
