"""Prove missing/mistyped filter SGND changes the actual exported netlist."""
import copy,sys,tempfile,subprocess,xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
import native_resources as nr
from generic_layout import io_path
from design_audit import child,children
from native_schematic import parse
import functional_layout as geom
ast=nr.parse(io_path(sys.argv[1]).read_text(encoding='utf8'))
labels=[l for l in children(ast,'label') if l[1]=='SGND']
_,state=parse(io_path(sys.argv[1]))
cap=next(c for c in state['items'].values() if c.get('reference')=='C5')
pin=next(p for p in state['symbols'][cap['symbol']]['pins'] if p['number']=='1')
cx,cy=geom.world(cap,pin['at'])
target=min(labels,key=lambda l:(float(child(l,'at')[1])-cx)**2+(float(child(l,'at')[2])-cy)**2)
expected={'C5.1','C6.1','C7.1','U1.14'}
with tempfile.TemporaryDirectory(prefix='eda-ground-label-') as folder:
    root=Path(folder)
    for fault in ('baseline','missing','wrong-name'):
        doc=copy.deepcopy(ast);label=next(l for l in children(doc,'label') if l==target)
        if fault=='missing':doc.remove(label)
        elif fault=='wrong-name':label[1]='SGND_MISTYPED'
        sch=root/(fault+'.kicad_sch');xml=root/(fault+'.xml')
        sch.write_text(nr.dump(doc),encoding='utf8')
        subprocess.run([sys.argv[2],'sch','export','netlist','--format','kicadxml','-o',str(xml),str(sch)],check=True,capture_output=True)
        nets=[{n.get('ref')+'.'+n.get('pin') for n in net.findall('node')} for net in ET.parse(xml).getroot().findall('./nets/net')]
        connected=any(expected<=net for net in nets)
        assert connected==(fault=='baseline'),(fault,'Ground label fault escaped netlist check')
print({'status':'passed','actualKiCadExports':3,'missingAndWrongLabelsDetected':True})
