"""Bind model assets to native body records, including repeated STEP instances."""
import collections,hashlib,json,math,struct
from pathlib import Path
from associations import children,value,props

def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def mm(text):
    text=str(text).strip()
    if text.endswith('mil'):return float(text[:-3])*.0254
    if text.endswith('mm'):return float(text[:-2])
    raise ValueError('Unspecified native coordinate unit: '+text)

def body_component_index(data,record):
    start=int(record['offset']);length=int(record['length'])
    if start<0 or start+5+length>len(data) or data[start]!=12 or length<9:
        raise ValueError('Invalid native component body boundary')
    if struct.unpack_from('<I',data,start+1)[0]!=length:raise ValueError('Native component body length mismatch')
    return struct.unpack_from('<H',data,start+12)[0]

def check_model_assets(inp,project,board,target_to_source=None):
    target_to_source=target_to_source or {};inp=Path(inp);base=Path(project).resolve().parent
    pcb=inp/'02_extracted/native_pcb'
    body_records=read(pcb/'ComponentBodies6_Data.records.json')['records']
    components=read(pcb/'Components6_Data.records.json')['records']
    stream=next(s for s in read(pcb/'stream_index.json')['streams'] if s['source_locator']=='ComponentBodies6/Data')
    stream_path=(inp/stream['output']).resolve()
    if not stream_path.is_relative_to(inp.resolve()):raise ValueError('Native stream escapes input')
    data=stream_path.read_bytes();assets=collections.defaultdict(set)
    for asset in read(inp/'04_assets/native_models/manifest.json'):
        assets[asset['metadata']['ID']].add(asset['sha256'])
    targets=[]
    for fp in children(board,'footprint'):
        ref=target_to_source.get(props(fp).get('Reference'),props(fp).get('Reference'))
        for model in children(fp,'model'):
            path=str(model[1]);file=Path(path.replace('${KIPRJMOD}',str(base)))
            if not file.is_absolute():file=base/file
            digest=hashlib.sha256(file.read_bytes()).hexdigest() if file.resolve().is_relative_to(base) and file.is_file() else None
            offset=children(model,'offset');xyz=children(offset[0],'xyz')[0][1:] if offset else [0,0,0]
            targets.append({'ref':ref,'path':path,'sha256':digest,'offset':list(map(float,xyz))})
    used=set();rows=[]
    for record in body_records:
        index=body_component_index(data,record);component=components[index]['fields'];fields=record['fields']
        ref=component['SOURCEDESIGNATOR'];theta=math.radians(float(component['ROTATION']))
        dx=mm(fields['MODEL.2D.X'])-mm(component['X']);dy=mm(fields['MODEL.2D.Y'])-mm(component['Y'])
        x=dx*math.cos(theta)+dy*math.sin(theta);y=-dx*math.sin(theta)+dy*math.cos(theta)
        if component['LAYER']=='BOTTOM':y=-y
        candidates=[(math.dist([x,y],t['offset'][:2]),i) for i,t in enumerate(targets) if t['ref']==ref and i not in used]
        deviation,i=min(candidates,default=(math.inf,None));target=targets[i] if i is not None else {}
        hash_match=target.get('sha256') in assets.get(fields.get('MODELID'),set())
        matched=deviation<=.0001 and hash_match
        if i is not None:used.add(i)
        rows.append({'reference':ref,'nativeComponentIndex':index,'nativeRecord':record['index'],'nativeModel':fields.get('MODEL.NAME'),'nativeModelId':fields.get('MODELID'),'nativeLocalXY':[x,y],'output':target.get('path'),'outputLocalXY':target.get('offset',[])[:2],'assetHashMatch':hash_match,'xyDeviationMm':deviation if math.isfinite(deviation) else None,'match':matched})
    return {'match':all(r['match'] for r in rows) and len(used)==len(targets),'expected':len(rows),'actual':len(targets),'objects':rows,'unexpectedModels':[t for i,t in enumerate(targets) if i not in used],
            'limit':'Native body ownership from binary stream; local STEP bytes by model ID and XY offsets within 0.0001 mm. Z/rotation are compared to independent import separately; full 3D native rendering remains unverified.'}
