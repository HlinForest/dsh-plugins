import sys
sys.dont_write_bytecode=True
from pathlib import Path
import copy,json,shutil
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'mcp'))
import native_resources as nr
from generic_layout import main,read,write,audit,export,normalize_layout,children,child,form,number,wire
OUT=ROOT.parent/'verification';results=[]
base=read(OUT/'rc-filter/request.json');design=read(base['design']);resources=read(base['library']);layout=normalize_layout(base['layout'],design)
def result(name,value,expected='passed'):
 results.append({'test':name,'expected':expected,'actual':value['status'],'errors':value.get('errors',[])});print(name,value['status'],flush=True)
result('base',main(base))
spaced=copy.deepcopy(base);spaced['layout']['gapMm']=12.7;spaced['output']=str(OUT/'spacing/project');result('spacing-only',main(spaced))
renamed=copy.deepcopy(design);mapping={c['ref']:'X_'+c['ref'] for c in design['components']}
def node(k):r,p=k.rsplit('.',1);return mapping[r]+'.'+p
for c in renamed['components']:c['ref']=mapping[c['ref']];c['id']='new-'+c['id']
for n in renamed['nets']:n['name']='ALT_'+n['name'];n['nodes']=[node(k) for k in n['nodes']]
renamed['nc']=[node(k) for k in renamed['nc']]
dest=OUT/'renamed';write(dest/'design.json',renamed);main({'operation':'snapshot','libraryRoot':'D:/Kicad/share/kicad','design':renamed,'snapshot':str(dest/'symbols.json')})
req={**base,'design':str(dest/'design.json'),'library':str(dest/'symbols.json'),'output':str(dest/'project'),'layout':{**base['layout'],'rotations':{mapping[r]:v for r,v in base['layout']['rotations'].items()}}};result('renamed-refs-and-nets',main(req))
result('repeated-native-block',main(read(OUT/'repeated-block/request.json')))
for name in ['short','nc-removed','symbol-changed','field-hidden','wire-removed','footprint-changed']:
 out=OUT/name/'project';shutil.copytree(base['output'],out,dirs_exist_ok=True);ast=nr.parse((out/'Circuit.kicad_sch').read_text(encoding='utf8'))
 if name=='short':
  rb=read(out/'readback.json');ast.append(wire(rb['pins']['R1.1'],rb['pins']['R1.2']))
 if name=='nc-removed':ast[:]=[x for x in ast if not isinstance(x,list) or x[0]!='no_connect']
 if name=='symbol-changed':
  lib=child(ast,'lib_symbols');sym=children(lib,'symbol')[0];unit=next(x for x in children(sym,'symbol') if children(x,'pin'));child(children(unit,'pin')[0],'length')[1]=number(99)
 if name=='field-hidden':child(child(children(ast,'symbol')[0],'property'),'effects').append(form('hide',nr.Atom('yes')))
 if name=='wire-removed':
  raw=children(ast,'wire')[0];ast.remove(raw)
 if name=='footprint-changed':next((out/'footprints').glob('*/*.kicad_mod')).write_text('(footprint "tampered")',encoding='utf8')
 (out/'Circuit.kicad_sch').write_text(nr.dump(ast),encoding='utf8');export(out,base['cli'],out/'Circuit.kicad_sch');result(name,audit(resources,design,out,layout),'failed')
for name,mutate in [('bad-pins',lambda d:d['components'][0]['pins'][0].update(name='invented')),('unknown-footprint',lambda d:d['components'][0].update(footprint='No:SuchPart')),('bad-nc',lambda d:d['nc'].append('J1.1'))]:
 bad=copy.deepcopy(design);mutate(bad)
 try:main({'operation':'snapshot','libraryRoot':'D:/Kicad/share/kicad','design':bad,'snapshot':str(OUT/name/'symbols.json')});result(name,{'status':'passed'},'failed')
 except Exception as e:result(name,{'status':'failed','errors':[str(e)]},'failed')
write(OUT/'regression-report.json',{'passed':all(r['expected']==r['actual'] for r in results),'cases':results})
if any(r['expected']!=r['actual'] for r in results):sys.exit(1)
