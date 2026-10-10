"""Create four-component KiCad teaching fixtures; run with KiCad's Python."""
from pathlib import Path
import json, uuid, re, subprocess, shutil
import pcbnew

ROOT = Path(__file__).resolve().parents[1]
KICAD = Path(pcbnew.__file__).resolve().parents[1]
if not (KICAD/'share/kicad').exists(): KICAD=Path('D:/Kicad')
uid=lambda text: str(uuid.uuid5(uuid.NAMESPACE_URL, 'dsh-independent-demo/'+text))
q=lambda value: json.dumps(str(value),ensure_ascii=False)
def write(path,text):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(text.encode('utf-8'))
def extract(lib,name):
    source=(KICAD/'share/kicad/symbols'/f'{lib}.kicad_sym').read_text(encoding='utf-8')
    begin=source.index('(symbol '+q(name)+'\n'); quoted=False;escaped=False;depth=0
    for i in range(begin,len(source)):
        c=source[i]
        if quoted:
            if escaped:escaped=False
            elif c=='\\':escaped=True
            elif c=='"':quoted=False
        elif c=='"':quoted=True
        elif c=='(':depth+=1
        elif c==')':
            depth-=1
            if depth==0:return source[begin:i+1].replace('(symbol '+q(name), '(symbol '+q(lib+':'+name),1)
    raise ValueError(name)

def schematic(kind,corrected=False):
    project='FilterReview' if kind=='pcb' else 'DividerChange'
    root=uid(project); symbols=[];labels=[]
    parts=[('J1','Connector_Generic:Conn_01x02','INPUT',60,75,['VIN','GND']),
           ('J2','Connector_Generic:Conn_01x02','OUTPUT',140,75,['SIGNAL','GND']),
           ('R1','Device:R','1k' if kind=='pcb' else ('20k' if corrected else '10k'),90,90,['VIN','SIGNAL']),
           ('C1' if kind=='pcb' else 'R2','Device:C' if kind=='pcb' else 'Device:R','100nF' if kind=='pcb' else ('15k' if corrected else '10k'),115,90,['SIGNAL','GND'])]
    for ref,lib,val,x,y,nets in parts:
        x=round(round(x/1.27)*1.27,2);y=round(round(y/1.27)*1.27,2)
        footprint=('Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical' if ref[0]=='J' else 'Capacitor_SMD:C_0805_2012Metric' if ref[0]=='C' else 'Resistor_SMD:R_0805_2012Metric')
        symbols.append(f'''(symbol (lib_id {q(lib)}) (at {x} {y} 0) (unit 1)
          (in_bom yes) (on_board yes) (dnp {'yes' if kind=='pcb' and ref=='C1' and not corrected else 'no'})
          (uuid {q(uid(project+'/'+ref))})
          (property "Reference" {q(ref)} (at {x+5} {y-2} 0) (effects (font (size 1.27 1.27))))
          (property "Value" {q(val)} (at {x+6} {y+2} 0) (effects (font (size 1.27 1.27))))
          (property "Footprint" {q(footprint)} (at {x} {y} 0) (effects (font (size 1.27 1.27)) (hide yes)))
          (pin "1" (uuid {q(uid(project+'/'+ref+'/1'))})) (pin "2" (uuid {q(uid(project+'/'+ref+'/2'))}))
          (instances (project {q(project)} (path {q('/'+root)} (reference {q(ref)}) (unit 1)))))''')
        endpoints=[(x-5.08,y),(x-5.08,y+2.54)] if ref[0]=='J' else [(x,y-3.81),(x,y+3.81)]
        for pin,((px,py),net) in enumerate(zip(endpoints,nets),1):
            px=round(px,2);py=round(py,2);wx=round(px-7.62,2)
            labels.append(f'(wire (pts (xy {wx} {py}) (xy {px} {py})) (stroke (width 0) (type default)) (uuid {q(uid(project+ref+str(pin)+"wire"))}))')
            labels.append(f'(label {q(net)} (at {wx} {py} 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid {q(uid(project+ref+str(pin)+"label"))}))')
    libs='\n'.join(extract(*lib.split(':')) for lib in sorted(set(p[1] for p in parts)))
    drawn='\n'.join(symbols+labels)
    return f'''(kicad_sch (version 20250114) (generator "eeschema")
      (uuid {q(root)}) (paper "A4")
      (title_block (title {q(project+' - independent teaching fixture')}) (rev "A")
        (comment 1 "Teaching circuit only. PCB is intentionally unrouted."))
      (lib_symbols {libs})
      (text {q('RC input review: C1 is omitted in the baseline.' if kind=='pcb' else 'Change only R1 and R2. Compare, verify, apply and roll back.')} (at 60 55 0) (effects (font (size 1.6 1.6)) (justify left)))
      {drawn}
      (sheet_instances (path "/" (page "1"))))\n'''

def board(corrected=False):
    b=pcbnew.BOARD()
    nets={}
    for name in ['VIN','SIGNAL','GND']:
        net=pcbnew.NETINFO_ITEM(b,name);b.Add(net);nets[name]=net
    parts=[('J1','Connector_PinHeader_2.54mm','PinHeader_1x02_P2.54mm_Vertical','INPUT',55,55,['VIN','GND']),
           ('J2','Connector_PinHeader_2.54mm','PinHeader_1x02_P2.54mm_Vertical','OUTPUT',80,55,['SIGNAL','GND']),
           ('R1','Resistor_SMD','R_0805_2012Metric','1k',65,55,['VIN','SIGNAL']),
           ('C1','Capacitor_SMD','C_0805_2012Metric','100nF',78 if corrected else 65,55 if corrected else 65,['SIGNAL','GND'])]
    for ref,lib,part,val,x,y,pins in parts:
        fp=pcbnew.FootprintLoad(str(KICAD/'share/kicad/footprints'/f'{lib}.pretty'),part)
        assert fp
        fp.SetReference(ref);fp.SetValue(val);fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x),pcbnew.FromMM(y)))
        fp.SetDNP(ref=='C1' and not corrected)
        for pad in fp.Pads():
            if pad.GetNumber() in ['1','2']:pad.SetNet(nets[pins[int(pad.GetNumber())-1]])
        b.Add(fp)
    for start,end in [((50,50),(85,50)),((85,50),(85,72)),((85,72),(50,72)),((50,72),(50,50))]:
        edge=pcbnew.PCB_SHAPE();edge.SetShape(pcbnew.SHAPE_T_SEGMENT);edge.SetLayer(pcbnew.Edge_Cuts);edge.SetWidth(pcbnew.FromMM(.05))
        edge.SetStart(pcbnew.VECTOR2I(*map(pcbnew.FromMM,start)));edge.SetEnd(pcbnew.VECTOR2I(*map(pcbnew.FromMM,end)));b.Add(edge)
    return b

def main():
    for state,corrected in [('before',False),('after',True)]:
        folder=ROOT/'02-pcb'/state;folder.mkdir(parents=True,exist_ok=True)
        write(folder/'FilterReview.kicad_sch',schematic('pcb',corrected))
        write(folder/'FilterReview.kicad_pro','{}\n')
        pcbnew.SaveBoard(str(folder/'FilterReview.kicad_pcb'),board(corrected))
        commands=[['sch','export','netlist','--format','kicadxml','-o',str(folder/'netlist.xml'),str(folder/'FilterReview.kicad_sch')],['pcb','export','pos','--format','csv','--units','mm','--side','both','-o',str(folder/'positions.csv'),str(folder/'FilterReview.kicad_pcb')]]
        for args in commands:subprocess.run([str(KICAD/'bin/kicad-cli.exe'),*args],check=True,capture_output=True)
        manifest={'schemaVersion':1,'project':'四器件 RC 输入评审演示','format':'kicad-xml','netlistPath':'netlist.xml','positionsPath':'positions.csv','context':{'signals':[{'ref':'J2','pin':'1','kind':'analog','groundNet':'/GND','capacitorPolicy':'required','basis':'本演示设计要求：输出采样节点必须装配对地滤波电容。不是所有输入端的通用规则。'}],'proximity':[{'ref':'C1','nearRef':'J2','maxMm':3,'basis':'本演示布局目标：C1 与 J2 封装参考点距离不超过 3 mm。不是铜皮走线长度或安规限值。'}]}}
        write(folder/'project.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    for state,corrected in [('baseline',False),('target',True)]:
        folder=ROOT/'03-schematic'/state
        write(folder/'DividerChange.kicad_sch',schematic('schematic',corrected));write(folder/'DividerChange.kicad_pro','{}\n')
    write(ROOT/'03-schematic/修改要求.txt','R1 改为 20k；R2 改为 15k\n')
    folder=ROOT/'03-schematic/current';folder.mkdir(parents=True,exist_ok=True)
    for p in (ROOT/'03-schematic/baseline').iterdir():shutil.copy2(p,folder/p.name)
    print('Independent KiCad fixtures created.')

if __name__=='__main__':main()
