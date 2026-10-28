"""Read-only schematic selection regions; these are never placement inputs."""
import sys,json,math,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from design_audit import sexpr,child,children
from native_schematic import graphic

def value(row,key,default=''):return child(row,key,[key,default])[1]
def numbers(row):return [float(x) for x in row[1:]] if row else []
def selection_map(schematic,svg):
    ast=sexpr(Path(schematic).read_text(encoding='utf8'))
    view=re.search(r'viewBox="([^"]+)"',Path(svg).read_text(encoding='utf8'))
    if not view:raise ValueError('SVG has no reliable view box')
    viewport=[float(x) for x in view[1].split()]
    if len(viewport)!=4 or not all(math.isfinite(x) for x in viewport) or min(viewport[2:])<=0:raise ValueError('Invalid SVG view box')
    libraries={s[1]:s for s in children(child(ast,'lib_symbols',[]),'symbol')}
    targets=[]
    def box(points):return [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
    for instance in children(ast,'symbol'):
        properties={p[1]:p[2] for p in children(instance,'property')}
        ref=properties.get('Reference','')
        if not ref or ref.startswith('#'):continue
        lib=libraries.get(value(instance,'lib_id'))
        if lib is None:continue
        at=numbers(child(instance,'at'));unit=int(value(instance,'unit','1'));angle=math.radians(at[2] if len(at)>2 else 0)
        regions=[];points=[]
        # Mirrored symbols retain precise field targets until their body transform
        # has an independently verified native convention.
        if not child(instance,'mirror'):
            def world(p):return [at[0]+p[0]*math.cos(angle)-p[1]*math.sin(angle),at[1]-p[0]*math.sin(angle)-p[1]*math.cos(angle)]
            for part in children(lib,'symbol'):
                suffix=re.search(r'_(\d+)_(\d+)$',part[1])
                if suffix and (int(suffix[1]) not in (0,unit) or int(suffix[2]) not in (0,1)):continue
                for row in part[2:]:
                    if not isinstance(row,list) or not row:continue
                    if row[0] in ('rectangle','polyline','arc','circle'):
                        g=graphic(row);local=list(g.get('points',[]))+[g[k] for k in ('start','mid','end') if k in g]
                        if g['kind']=='circle':
                            x,y=g['center'];r=g['radius'];local += [[x-r,y-r],[x+r,y+r]]
                        points.extend(world(p) for p in local)
            if points:
                x0,y0,x1,y1=box(points);regions.append([x0-.7,y0-.7,x1+.7,y1+.7])
        # Visible field targets also make tiny passives and unusual symbols selectable.
        for prop in children(instance,'property'):
            if prop[1] not in ('Reference','Value') or not prop[2]:continue
            effects=child(prop,'effects',[])
            if 'hide' in prop or 'hide' in effects or child(effects,'hide') or child(prop,'hide'):continue
            pos=numbers(child(prop,'at'));font=child(effects,'font',[]);size=numbers(child(font,'size',['size','1.27','1.27']))
            width=max(2.0,sum(1 if ord(c)>255 else .72 for c in prop[2])*size[0]);height=max(2.0,size[1]*1.8)
            regions.append([pos[0]-width/2-.5,pos[1]-height/2-.5,pos[0]+width/2+.5,pos[1]+height/2+.5])
        if regions:targets.append({'id':value(instance,'uuid'),'ref':ref,'value':properties.get('Value',''),'symbol':value(instance,'lib_id'),'unit':unit,'regions':regions})
    return {'viewBox':viewport,'targets':targets,'scope':'selection only; never sent as placement coordinates'}
if __name__=='__main__':
    from record_io import write_json
    write_json(sys.argv[3],selection_map(sys.argv[1],sys.argv[2]))
