import record_io
from erc_report import parse_report
"""Frozen electrical input -> presentation only -> independent native/PDF checks."""
import sys
sys.dont_write_bytecode=True
import json,collections,hashlib,subprocess,csv,math,tempfile,shutil
from pathlib import Path
import xml.etree.ElementTree as ET
import precise_mcp as pm
import fixed_components as fc
import functional_layout as geom
from native_schematic import parse,signature,canonical
from layout_motifs import generate

def read(p):return record_io.read_json(p)
def write(p,v):record_io.write_json(p,v)

def validate(lib,design):
    errors=[];refs=[c['ref'] for c in lib['objects']]
    if len(refs)!=len(set(refs)):errors.append('Duplicate component reference')
    pins={c['ref']+'.'+str(p['number']) for c in lib['objects'] for p in c['pins']}
    seen=[];names=[]
    for n in design.get('nets',[]):
        name=n.get('name');nodes=n.get('nodes',[])
        if not isinstance(name,str) or not name.strip() or not nodes:errors.append('Empty network name/members')
        names.append(name);seen.extend(nodes)
    if not names or len(names)!=len(set(names)):errors.append('Missing/duplicate network names')
    seen+=design.get('nc',[])
    if len(seen)!=len(set(seen)):errors.append('Pin appears in more than one net or NC')
    if set(seen)!=pins:errors.append('Pin coverage mismatch: '+str({'missing':sorted(pins-set(seen)),'unknown':sorted(set(seen)-pins)}))
    supplied=design.get('supplied_nets',[])
    if len(supplied)!=len(set(supplied)) or set(supplied)-set(names):errors.append('Unknown/duplicate supplied rail')
    if errors:raise ValueError('; '.join(errors))

def frozen_state(lib):
    s={'name':'Frozen','uuid':'e27b90b3-6687-4aa0-bc93-086cc26f10d5','paper':'A4','items':{},'symbols':{}}
    for c in lib['objects']:
        sym,item=fc.place(c,{'at':[0,0,0]});s['symbols'][sym['name']]=sym;s['items'][item['id']]=item
    return s

def export(out,cli,sch):
    # KiCad/wxWidgets cannot reliably export through extended Windows paths.
    # Export an exact copy in a short owned directory; never edit circuit identity.
    logs=[];source_hash=hashlib.sha256(sch.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='eda-export-') as temp:
        work=Path(temp)/'project';shutil.copytree(out,work)
        staged=work/sch.name
        if hashlib.sha256(staged.read_bytes()).hexdigest()!=source_hash:raise ValueError('Export staging changed schematic')
        target=Path(temp)/'exports';target.mkdir()
        for args in [['sch','export','netlist','--format','kicadxml','-o',str(target/'actual.net.xml'),str(staged)],
                     ['sch','export','pdf','-o',str(target/(sch.stem+'.pdf')),str(staged)],
                     ['sch','export','svg','-o',str(target/'svg'),str(staged)],
                     ['sch','erc','--format','report','--severity-all','-o',str(target/'erc.rpt'),str(staged)]]:
            r=subprocess.run([cli]+args,cwd=work,capture_output=True,encoding='utf8',errors='replace',timeout=120)
            logs.append({'args':args,'code':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'sourceSchematicSha256':source_hash,'staging':'byte-identical short-path project copy'})
            if r.returncode:raise RuntimeError(str(logs[-1]))
        if hashlib.sha256(sch.read_bytes()).hexdigest()!=source_hash or hashlib.sha256(staged.read_bytes()).hexdigest()!=source_hash:raise ValueError('Schematic changed during export')
        for name in ['actual.net.xml',sch.stem+'.pdf','erc.rpt']:
            if not (target/name).is_file():raise ValueError('Export did not produce '+name)
        if not list((target/'svg').glob('*.svg')):raise ValueError('Export did not produce SVG')
        shutil.copytree(target,out,dirs_exist_ok=True)
        write(out/'erc.json',parse_report((target/'erc.rpt').read_text(encoding='utf-8-sig')))
    write(out/'kicad-commands.json',logs)

def audit(out,lib,design):
    sch=out/'DisplayBoard_ELK_A4.kicad_sch';ast,state=parse(sch)
    # Expected geometry is independently read from frozen symbol serialization.
    expected_path=out/'frozen-symbol-reference.txt'
    expected_path.write_text(pm.render(frozen_state(lib)),encoding='utf8')
    _,bs=parse(expected_path)
    baseline={i['reference']:(i,bs['symbols'][i['symbol']]) for i in bs['items'].values() if i['kind']=='component'}
    comps=[i for i in state['items'].values() if i['kind']=='component']
    actual={i['reference']:i for i in comps};errors=[]
    if len(actual)!=len(comps):errors.append('Duplicate native component reference')
    if set(actual)!=set(baseline)|{f'#PWR{i+1:02}' for i,_ in enumerate(design.get('supplied_nets',[]))}:errors.append('Native component set changed')
    for ref,(b,s) in baseline.items():
        c=actual.get(ref)
        if c is None:errors.append('Missing '+ref);continue
        t=state['symbols'][c['symbol']]
        if signature(s)!=signature(t) or canonical(s['pins'])!=canonical(t['pins']):errors.append(ref+': native symbol/pins changed')
        bp={p['name']:(p['value'],p['visible'],p['font']['size']) for p in b['properties']}
        cp={p['name']:(p['value'],p['visible'],p['font']['size']) for p in c['properties']}
        if bp!=cp:errors.append(ref+': native material/visibility/font changed')
        if any(c[k]!=b[k] for k in ['in_bom','on_board','dnp']) or c.get('mirror'):errors.append(ref+': assembly flags/mirror changed')
    xml=ET.parse(out/'actual.net.xml').getroot();observed=collections.Counter();nc=set();netnames={};helpers={}
    for n in xml.findall('./nets/net'):
        members=[]
        for x in n.findall('node'):
            ref=x.get('ref');key=ref+'.'+x.get('pin')
            if ref.startswith('#PWR'):helpers[ref]=n.get('name','').removeprefix('/');continue
            members.append(key)
            if 'no_connect' in x.get('pintype',''):nc.add(key)
        if members:observed[frozenset(members)]+=1;netnames[frozenset(members)]=n.get('name','').removeprefix('/')
    expected=collections.Counter(frozenset(n['nodes']) for n in design['nets'])
    expected.update(frozenset([p]) for p in design['nc'])
    if observed!=expected:errors.append('Actual KiCad net partitions changed')
    if nc!=set(design['nc']):errors.append('Actual KiCad NC set changed')
    for n in design['nets']:
        if netnames.get(frozenset(n['nodes']))!=n['name']:errors.append('Network name changed: '+n['name'])
    for i,net in enumerate(design.get('supplied_nets',[])):
        ref=f'#PWR{i+1:02}';c=actual.get(ref,{})
        nodes=next(n['nodes'] for n in design['nets'] if n['name']==net)
        pinpos=[]
        for key in nodes:
            r,num=key.rsplit('.',1);part=actual[r];sym=state['symbols'][part['symbol']]
            pinpos.append(geom.world(part,next(p['at'] for p in sym['pins'] if p['number']==num)))
        if not any(math.dist(c.get('at',[999,999])[:2],xy)<.0002 for xy in pinpos) or c.get('in_bom',True) or c.get('on_board',True) or state['symbols'].get(c.get('symbol'),{}).get('pins',[{}])[0].get('type')!='power_out':errors.append('ERC helper changed: '+ref)
    # NC marker positions must correspond exactly, not merely produce singleton nets.
    pins={c['reference']+'.'+p['number']:geom.world(c,p['at']) for c in comps for p in state['symbols'][c['symbol']]['pins']}
    markers=[i['at'] for i in state['items'].values() if i['kind']=='no_connect']
    if len(markers)!=len(design['nc']) or any(not any(math.dist(pins[k],a)<.0002 for a in markers) for k in design['nc']):errors.append('NC marker positions changed')
    erc=read(out/'erc.json');viol=[v for s in erc['sheets'] for v in s['violations']]
    erc_errors=sum(v['severity']=='error' for v in viol);warnings=sum(v['severity']=='warning' for v in viol)
    if erc_errors:errors.append(f'ERC errors: {erc_errors}')
    pdf=fc.audit_layout(out,state,str(out/(sch.stem+'.pdf')));write(out/'pdf-geometry.json',pdf)
    errors.extend(pdf['errors'])
    physical,segs=geom.physical_graph(state)
    # Local motif edges must remain actual wires, even if labels preserve connectivity.
    from layout_motifs import obligations
    required=obligations(lib,design)
    for group in required:
        if len({physical.get(k,k) for k in group})!=1:errors.append('Required local wires missing: '+str(group))
    if state['page_size_mm']!=[297,210] or 'portrait' in next((x for x in ast if isinstance(x,list) and x and x[0]=='paper'),[]):errors.append('A4 landscape required')
    for c in comps:
        if c['reference'].startswith('#'):continue
        b=geom.part_bounds(c,state['symbols'][c['symbol']])
        if b[0]<10 or b[1]<10 or b[2]>287 or b[3]>200:errors.append('Object outside printable area: '+c['reference'])
        if b[0]<287 and b[2]>170 and b[1]<200 and b[3]>164:errors.append('Object intrudes title area: '+c['reference'])
    # Export BOM from read-back native data, with all fields; no model-written BOM.
    fields=sorted({p['name'] for c in comps if c['in_bom'] for p in c['properties']})
    with (out/'bom.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields+['DNP','OnBoard']);w.writeheader()
        for c in comps:
            if c['in_bom']:w.writerow({**{p['name']:p['value'] for p in c['properties']},'DNP':c['dnp'],'OnBoard':c['on_board']})
    report={'status':'failed' if errors else 'passed','errors':errors,'symbols':len(baseline),'pins':sum(len(s['pins']) for _,s in baseline.values()),'nets':len(design['nets']),'nc':sorted(nc),
        'erc':{'errors':erc_errors,'warnings':warnings,'violations':viol},'layout':{'textOverlaps':len(pdf.get('collisions',[])),'wireBodyCrossings':len(pdf.get('wireBodyCrossings',[])),'wireTextCrossings':len(pdf.get('wireTextCrossings',[])),'bodyTextOverlaps':len(pdf.get('bodyTextOverlaps',[])),'localWireGroups':len(required),'wireLengthMm':round(sum(math.dist(a,b) for a,b in segs),2),'pageMm':state['page_size_mm']},
        'scope':'Recognized reviewed motifs; native schematic/netlist/NC/PDF validation. PDF bounding-box checks need visual review. Original footprint identifiers preserved; PCB/purchasing/production not certified.'}
    write(out/'audit.json',report)
    pin_details={c['reference']+'.'+p['number']:{'name':p['name'],'type':p['type']} for c in comps for p in state['symbols'][c['symbol']]['pins']}
    write(out/'readback.json',{'components':comps,'pins':pins,'pinDetails':pin_details,'nets':design['nets'] if expected==observed else [],'nc':sorted(nc)})
    return report

def main(req):
    lib=read(req['library']);design=read(req['design']);validate(lib,design)
    if req['operation']=='validate':return {'status':'passed','pins':sum(len(c['pins']) for c in lib['objects'])}
    out=Path(req['output']);out.mkdir(parents=True,exist_ok=True)
    if req['operation']=='generate':generate(lib,design,out,req.get('gap',5.08),req.get('node','node'))
    elif req['operation']!='verify':raise ValueError('Unsupported operation')
    export(out,req['cli'],out/'DisplayBoard_ELK_A4.kicad_sch')
    return audit(out,lib,design)

if __name__=='__main__':
    try:write(sys.argv[2],main(read(sys.argv[1])))
    except Exception as e:write(sys.argv[2],{'status':'failed','errors':[str(e)]});raise
