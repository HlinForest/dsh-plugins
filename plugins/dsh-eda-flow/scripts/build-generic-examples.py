"""Build auditable engineering examples; these are not manufacturer-approved designs."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import json,copy,shutil
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'mcp'))
import native_resources as nr
from generic_layout import main,write,read
LIB=Path(sys.argv[1] if len(sys.argv)>1 else 'D:/Kicad/share/kicad')
CLI=sys.argv[2] if len(sys.argv)>2 else 'D:/Kicad/bin/kicad-cli.exe'
OUT=Path(sys.argv[3]).resolve() if len(sys.argv)>3 else ROOT.parent/'verification'
def component(ref,symbol,value,footprint):return {'id':ref,'ref':ref,'librarySymbol':symbol,'value':value,'mpn':'','footprint':footprint,'dnp':False,'in_bom':True,'on_board':True,'pins':nr.symbol(LIB,symbol)['pins']}
def connector(ref,n,value):return component(ref,'Connector_Generic:Conn_01x0'+str(n),value,f'Connector_PinHeader_2.54mm:PinHeader_1x0{n}_P2.54mm_Vertical')
def capacitor(ref,value):return component(ref,'Device:C',value,'Capacitor_SMD:C_0805_2012Metric')
def resistor(ref,value):return component(ref,'Device:R',value,'Resistor_SMD:R_0805_2012Metric')
def design(cs,nets,nc=[]):return {'components':cs,'nets':[{'name':k,'nodes':v} for k,v in nets.items()],'nc':nc,'supplied_nets':[],'functions':[],'unresolved':['工程示例：采购型号、额定值和实物性能未认证。']}
examples={
 'power-decoupling':(design([connector('J1',2,'POWER'),capacitor('C1','100n'),capacitor('C2','1u')],{'VCC':['J1.1','C1.1','C2.1'],'GND':['J1.2','C1.2','C2.2']}),{'J1':180}),
 'uart-series':(design([connector('J1',3,'HOST'),resistor('R1','47'),resistor('R2','47'),connector('J2',3,'DEVICE')],{'TX_HOST':['J1.1','R1.1'],'TX_DEVICE':['R1.2','J2.1'],'RX_HOST':['J1.2','R2.1'],'RX_DEVICE':['R2.2','J2.2'],'GND':['J1.3','J2.3']}),{'J1':180,'R1':90,'R2':90}),
 'rc-filter':(design([connector('J1',3,'INPUT'),resistor('R1','1k'),capacitor('C1','100n'),connector('J2',2,'OUTPUT')],{'IN':['J1.1','R1.1'],'OUT':['R1.2','C1.1','J2.1'],'GND':['J1.2','C1.2','J2.2']},['J1.3']),{'J1':180,'R1':90})}
index=[];results=[]
for name,(d,rotations) in examples.items():
 out=OUT/name;out.mkdir(parents=True,exist_ok=True);write(out/'design.json',d)
 main({'operation':'snapshot','libraryRoot':str(LIB),'design':d,'snapshot':str(out/'symbols.json')})
 req={'operation':'generate','design':str(out/'design.json'),'library':str(out/'symbols.json'),'output':str(out/'project'),'cli':CLI,'node':'node','layout':{'template':'generic-v1','paper':'A4-landscape','gapMm':7.62,'rotations':rotations}}
 write(out/'request.json',req);r=main(req);results.append({'name':name,'status':r['status'],'errors':r['errors'],'layout':r['layout']});print(name,r['status'],r['errors'],flush=True)
 if r['status']!='passed':continue
 if name=='rc-filter':continue
 target=ROOT/'libraries'/'blocks';target.mkdir(parents=True,exist_ok=True)
 rel='engineering.kicad_blocks/'+name+'.kicad_block/'+name+'.kicad_sch';file=target/rel;file.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(out/'project'/'Circuit.kicad_sch',file)
 write(file.with_suffix('.json'),{'description':'Static-verified engineering example; no procurement or electrical rating approval','keywords':name.replace('-',' '),'fields':{}})
 box=read(out/'project'/'page-output.json')['children'][0]
 block={'id':name,'version':'1.0.0','description':'电源并联去耦示例' if name=='power-decoupling' else 'UART双向串联电阻接口示例','interfaces':[n['name'] for n in d['nets']],'design':d,'fragment':rel,'fragmentSha256':nr.sha(file.read_text(encoding='utf8')),'width':box['width'],'height':box['height'],'origin':[10,10],
 'validation':{'nativeSymbols':'passed','netlist':'passed','NC':'passed','pdfGeometry':'passed','electricalRatings':'not-validated','hardwareTest':'not-run','reviewStatus':'engineering-example'},
 'limitations':['需要确认实际电压、电流、接口电平、信号速率和器件额定值。','示例值不是通用推荐值；更换参数或器件需建立新模块版本。','尚未纳入企业内部优选物料。'],
 'sources':[{'url':'https://docs.kicad.org/9.0/en/eeschema/eeschema.html#schematic-design-blocks','purpose':'native reusable fragment format, not electrical endorsement'},{'url':'https://klc.kicad.org/','purpose':'library convention, not circuit performance specification'}]}
 write(target/(name+'.json'),block);index.append({k:block[k] for k in ['id','version','description','validation']})
write(ROOT/'libraries'/'blocks'/'index.json',index);write(OUT/'examples-report.json',results)
if any(r['status']!='passed' for r in results):sys.exit(1)
