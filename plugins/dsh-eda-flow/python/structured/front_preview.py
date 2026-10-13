"""Export the front layer plot and a separate, explicitly labelled reading view."""
import argparse,datetime,hashlib,json,subprocess,sys,xml.etree.ElementTree as ET
from pathlib import Path

NS='{http://www.w3.org/2000/svg}'
SHAPES={'path','circle','line','polyline','polygon','rect','ellipse'}
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def style_values(element,inherited=None):
    values=dict(inherited or {})
    for part in element.get('style','').split(';'):
        if ':' in part:
            key,value=part.split(':',1);values[key.strip()]=value.strip()
    for key in ['stroke','stroke-width']:
        if element.get(key) is not None:values[key]=element.get(key)
    return values

def make_reading_view(source,output,board_width,board_height):
    tree=ET.parse(source);root=tree.getroot();width=max(board_width,float(root.get('viewBox').split()[2]));height=max(board_height,float(root.get('viewBox').split()[3]))
    margin=1.;view=[-margin,-margin,width+2*margin,height+2*margin]
    root.set('viewBox',' '.join(format(v,'.8g') for v in view));root.set('width','1200');root.set('height',str(round(1200*view[3]/view[2])))
    root.set('style','background:white;max-width:100%;height:auto')
    changed=0
    def visit(element,inherited=None):
        nonlocal changed
        values=style_values(element,inherited)
        if element.tag.split('}')[-1] in SHAPES:
            stroke=values.get('stroke','none');line_width=float(values.get('stroke-width','1'))
            if stroke!='none' and 0<line_width<.05:
                element.set('vector-effect','non-scaling-stroke');element.set('style',element.get('style','')+';stroke-width:0.9px;');changed+=1
        for child in element:visit(child,values)
    visit(root)
    title=root.find(NS+'title')
    if title is None:title=ET.SubElement(root,NS+'title')
    title.text='显示板正面 · 阅读版（细轮廓以0.9屏幕像素显示；真实工程线宽见原比例图）'
    desc=root.find(NS+'desc')
    if desc is None:desc=ET.SubElement(root,NS+'desc')
    desc.text='For screen reading only. PCB coordinates and physical line widths are unchanged. Use pcb-top-true-width.svg for actual plotted line widths.'
    tree.write(output,encoding='utf-8',xml_declaration=True)
    return {'enhanced_primitives':changed,'minimum_thin_stroke_px':.9,'viewBox':view}

def export_front(project,cli,call):
    import pcbnew as p
    project=Path(project);pcb=next(project.glob('*.kicad_pcb'));previews=project/'previews';previews.mkdir(exist_ok=True)
    cad_files=[f for f in project.glob('*.kicad_*') if f.is_file()]
    before={f.name:digest(f) for f in cad_files}
    plot=previews/'pcb-top-raw.svg';true_width=previews/'pcb-top-true-width.svg';reading=previews/'pcb-top.svg'
    for label,output,bw in [('front original color plot',plot,False),('front true-width plot',true_width,True)]:
        args=[cli,'pcb','export','svg','--mode-single','--page-size-mode','2','--exclude-drawing-sheet','--layers','F.Cu,F.SilkS,Edge.Cuts','--output',output]
        if bw:args.append('--black-and-white')
        call(label,[*args,pcb])
    board=p.LoadBoard(str(pcb));box=board.GetBoardEdgesBoundingBox()
    result=make_reading_view(true_width,reading,p.ToMM(box.GetWidth()),p.ToMM(box.GetHeight()))
    after={f.name:digest(f) for f in cad_files};assert before==after,'Preview refresh changed design files'
    result.update({'purpose':'screen reading only','cad_changed':False,'design_hashes':before,'files':{f.name:digest(f) for f in [plot,true_width,reading]},'updated_at':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat()})
    (project/'checks').mkdir(exist_ok=True)
    (project/'checks/front-preview.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--project',type=Path,required=True);ap.add_argument('--kicad-cli',type=Path,default=Path(sys.executable).with_name('kicad-cli.exe'));a=ap.parse_args();calls=[]
    def call(label,args):
        args=list(map(str,args));r=subprocess.run(args,capture_output=True,encoding='utf-8',errors='replace')
        calls.append({'stage':label,'command':args,'exit_code':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
        if r.returncode:raise RuntimeError(r.stderr+r.stdout)
    result=export_front(a.project,a.kicad_cli,call)
    (a.project/'checks/front-preview-execution.json').write_text(json.dumps(calls,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
