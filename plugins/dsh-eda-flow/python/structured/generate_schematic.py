"""Build schematic objects from stage inputs, without reading a native CAD file."""
import argparse, copy, math
from common import *

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--inputs',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    inp=a.inputs.resolve();out=a.out.resolve();out.mkdir(parents=True,exist_ok=True)
    cfg=read(inp/'01_task/requirements.json');components=read(inp/'03_components/components.json')
    records=read(inp/'04_schematic/FileHeader.records.json')['records'];byindex={r['index']:r for r in records}
    owned=collections.defaultdict(list)
    for r in records:
        if 'OwnerIndex' in r['fields']:owned[int(r['fields']['OwnerIndex'])+1].append(r)
    scale=cfg['schematic_unit_mm'];yorigin=cfg['schematic_y_origin_mm'];stem=cfg['stem'];root_id=uid('schematic-root')
    layer=read(inp/'07_adjustments/approved_changes.json');library='DisplayBoard_Native';fplib='DisplayBoard_Placed'
    fonts={int(f['font_id']):f for f in read(inp/'04_schematic/source_tables/sch_document_settings.json')['fonts']}
    def mm(v):return round(v*scale,6)
    def position(f):x,y=source_point(f);return [mm(x),round(yorigin-mm(y),6)]
    def effects(size=1.27,hidden=False,justify=None,bold=False):
        e=node('effects',node('font',node('face',cfg['schematic_style']['font_face']),node('size',size,size)))
        if bold:child(e,'font').append(node('bold',S('yes')))
        if justify:e.append(node('justify',*[S(v) for v in justify]))
        if hidden:e.append(S('hide'))
        return e
    def font_size(f):return round(float(fonts.get(int(f.get('FontID',1)),{'size':10})['size'])*.127,6)
    def property_(name,value,f=None,at=None,hidden=False):
        f=f or {};angle=int(f.get('Orientation',0))%2*90
        return node('property',name,value,node('at',*(at if at is not None else position(f)),angle),effects(font_size(f),hidden,['left','bottom'] if at is None else None))
    def linewidth(f):return cfg['schematic_style']['line_width_mm']
    def stroke(f):return node('stroke',node('width',linewidth(f)),node('type',S('default')))
    def fill(f):return node('fill',node('type',S('background' if f.get('IsSolid')=='T' else 'none')))
    def geometry(r,origin):
        f=r['fields'];kind=f.get('RECORD');bx,by=origin
        def local(x,y):return [mm(x-bx),mm(y-by)]
        def loc(kx,ky):return local(number(f,kx),number(f,ky))
        if kind=='14':return node('rectangle',node('start',*loc('Location.X','Location.Y')),node('end',*loc('Corner.X','Corner.Y')),stroke(f),fill(f))
        if kind in {'6','7','13','10'}:
            if kind=='13':pts=[loc('Location.X','Location.Y'),loc('Corner.X','Corner.Y')]
            elif kind=='10':
                x0,x1=sorted([number(f,'Location.X'),number(f,'Corner.X')]);y0,y1=sorted([number(f,'Location.Y'),number(f,'Corner.Y')])
                radius=lambda key:float(f.get(key,0)) if cfg['schematic_style']['rounded_radius_integer_fields'] else number(f,key)
                rx=min(radius('CornerXRadius'),(x1-x0)/2);ry=min(radius('CornerYRadius'),(y1-y0)/2)
                pts=[]
                for cx,cy,start in [(x1-rx,y1-ry,0),(x0+rx,y1-ry,90),(x0+rx,y0+ry,180),(x1-rx,y0+ry,270)]:
                    pts.extend(local(cx+rx*math.cos(math.radians(start+j*7.5)),cy+ry*math.sin(math.radians(start+j*7.5))) for j in range(13))
                pts.append(pts[0])
            else:
                pts=[loc('X'+str(i),'Y'+str(i)) for i in range(1,int(f['LocationCount'])+1)]
                if kind=='7' and pts[-1]!=pts[0]:pts.append(pts[0])
            return node('polyline',node('pts',*[node('xy',*v) for v in pts]),stroke(f),fill(f) if kind in {'7','10'} else node('fill',node('type',S('none'))))
        if kind=='12':
            x,y=source_point(f);rad=number(f,'Radius');start=float(f.get('StartAngle',0));end=float(f.get('EndAngle',360));sweep=(end-start)%360
            def pt(t):return local(x+rad*math.cos(math.radians(t)),y+rad*math.sin(math.radians(t)))
            return node('arc',node('start',*pt(start)),node('mid',*pt(start+sweep/2)),node('end',*pt(start+sweep)),stroke(f),node('fill',node('type',S('none'))))
        if kind=='4':return node('text',text(f),node('at',*loc('Location.X','Location.Y'),int(f.get('Orientation',0))*90),effects(font_size(f),False,['left','bottom']))
        raise ValueError('Unhandled symbol geometry '+str(kind))
    sch=node('kicad_sch',node('version',20250114),node('generator',S('eeschema')),node('uuid',root_id),node('paper',cfg['paper']))
    lib_symbols=node('lib_symbols');lib_file=node('kicad_symbol_lib',node('version',20231120),node('generator',S('kicad_symbol_editor')))
    instances=[];symbol_map={};bom=[];graphics_count=0
    footprints={prop(decode(r['data'])).get('Reference',''):decode(r['data'])[1] for r in read(inp/'05_footprints/instances.json')}
    patterns={c['designator']:c['pattern'] for c in read(inp/'06_pcb/native_tables/pcb_native_components.json')['components']}
    for c in components:
        ref=c['reference'];index=c['source_locator']['record_index'];rows=owned[index];f=c['raw_fields'];base=source_point(f)
        name='Source_'+safe(ref)+'_'+str(index);full=library+':'+name;params={p['name']:p['value'] for p in c['parameters']};value=params.get('Comment',f.get('LibReference',''))
        fpname=safe(ref)+'_Original';fp=fplib+':'+fpname if ref in footprints and ref else ''
        original_fp=next((text(x['fields'],'ModelName') for x in c['implementations'] if x['fields'].get('IsCurrent')=='T'),'')
        pins=[r for r in rows if r['fields'].get('RECORD')=='2'];pinflags=[int(r['fields'].get('PinConglomerate',0)) for r in pins]
        lib=node('symbol',full,node('pin_names',node('offset',cfg['schematic_style']['pin_name_offset_mm'])),node('in_bom',S('yes')),node('on_board',S('no' if ref in layer['schematic_only'] else 'yes')))
        if pins and not any(v&8 for v in pinflags):child(lib,'pin_names').append(S('hide'))
        if pins and not any(v&16 for v in pinflags):lib.append(node('pin_numbers',S('hide')))
        if ref in layer['jumper_references']:lib.append(node('jumper_pin_groups',['1','2']))
        designator=next(r['fields'] for r in rows if r['fields'].get('RECORD')=='34');valfield=next((p['raw_fields'] for p in c['parameters'] if p['name']=='Comment'),{})
        properties=[property_('Reference',ref,designator),property_('Value',value,valfield,hidden=valfield.get('IsHidden')=='T'),
                    property_('Footprint',fp,at=position(f),hidden=True),property_('Datasheet','',at=position(f),hidden=True)]
        for p in c['parameters']:
            if p['name']=='Comment':continue
            properties.append(property_(p['name'],p['value'],p['raw_fields'],hidden=p['raw_fields'].get('IsHidden')=='T'))
        metadata=[('Altium_SourceUniqueID',f.get('UniqueID','')),('Altium_LibReference',f.get('LibReference','')),('Altium_RecordIndex',str(index)),('Altium_OriginalFootprint',original_fp)]
        metadata.append(('Altium_PCBPattern',patterns[ref]) if ref in patterns else ('Restoration_Note','原理图有此对象，原 PCB 无放置实例。'))
        for key,val in metadata:properties.append(property_(key,val,at=position(f),hidden=True))
        for p in properties[:4]:
            q=copy.deepcopy(p);child(q,'at')[1:]=[0,0,0];eff=child(q,'effects');eff[:]=[v for v in eff if tag(v)!='justify']
            if q[1]!='Reference' and S('hide') not in eff:eff.append(S('hide'))
            lib.append(q)
        graphics=node('symbol',name+'_0_1')
        for r in rows:
            if r['fields'].get('RECORD') in {'6','7','10','12','13','14','4'}:graphics.append(geometry(r,base));graphics_count+=1
        lib.append(graphics);pinunit=node('symbol',name+'_1_1')
        for p in pins:
            pf=p['fields'];px,py=source_point(pf);length=number(pf,'PinLength');direction=int(pf.get('PinConglomerate',0))%4;dx,dy=[(1,0),(0,1),(-1,0),(0,-1)][direction]
            pinunit.append(node('pin',S('passive'),S('line'),node('at',mm(px+dx*length-base[0]),mm(py+dy*length-base[1]),[180,270,0,90][direction]),node('length',mm(length)),
                                node('name',text(pf,'Name'),effects(1.27)),node('number',text(pf,'Designator'),effects(1.27))))
        lib.append(pinunit);lib_symbols.append(lib);standalone=copy.deepcopy(lib);standalone[1]=name;lib_file.append(standalone)
        ident=uid('symbol/'+ref);symbol_map[ref]=ident
        inst=node('symbol',node('lib_id',full),node('at',*position(f),0),node('unit',1),node('in_bom',S('yes')),node('on_board',S('no' if ref in layer['schematic_only'] else 'yes')),node('dnp',S('no')),node('uuid',ident),*properties)
        for p in pins:inst.append(node('pin',text(p['fields'],'Designator'),node('uuid',uid('pin/'+ref+'/'+text(p['fields'],'Designator')))))
        inst.append(node('instances',node('project',stem,node('path','/'+root_id,node('reference',ref),node('unit',1)))))
        instances.append(inst);bom.append([ref,value,original_fp,fp,params.get('物料编码',''),params.get('物料描述',''),params.get('优选等级',''),params.get('装配类型',''),int(ref not in layer['schematic_only']),json.dumps(params,ensure_ascii=False)])
    sch.append(lib_symbols)
    counts=collections.Counter()
    for r in records:
        f=r['fields'];kind=f.get('RECORD');index=r['index'];pos=position(f)
        if kind=='27':
            pts=[[mm(number(f,'X'+str(i))),round(yorigin-mm(number(f,'Y'+str(i))),6)] for i in range(1,int(f['LocationCount'])+1)]
            for j,(start,end) in enumerate(zip(pts,pts[1:])):
                sch.append(node('wire',node('pts',node('xy',*start),node('xy',*end)),node('stroke',node('width',0),node('type',S('default'))),node('uuid',uid(f'wire/{index}/{j}'))));counts['wires']+=1
        elif kind=='29':sch.append(node('junction',node('at',*pos),node('diameter',0),node('color',0,0,0,0),node('uuid',uid('junction/'+str(index)))));counts['junctions']+=1
        elif kind=='22':sch.append(node('no_connect',node('at',*pos),node('uuid',uid('nc/'+str(index)))));counts['nc']+=1
        elif kind in {'17','25'}:sch.append(node('label',text(f),node('at',*pos,0 if int(f.get('Style',0)) else int(f.get('Orientation',0))*90),effects(1.27,False,['left','bottom']),node('uuid',uid('label/'+str(index)))));counts['labels']+=1
        elif kind=='4' and 'OwnerIndex' not in f:sch.append(node('text',text(f),node('at',*pos,int(f.get('Orientation',0))%2*90),effects(font_size(f),False,['left','bottom'],bool(fonts[int(f.get('FontID',1))]['bold_bool'])),node('uuid',uid('text/'+str(index)))));counts['texts']+=1
    sch.extend(instances);sch.append(node('embedded_fonts',S('no')))
    save_sexp(out/(stem+'.kicad_sch'),sch);save_sexp(out/(library+'.kicad_sym'),lib_file)
    save_sexp(out/'sym-lib-table',node('sym_lib_table',node('lib',node('name',library),node('type','KiCad'),node('uri','${KIPRJMOD}/'+library+'.kicad_sym'),node('options',''),node('descr','Original source symbols'))))
    table(out/'BOM_逐位号.csv',['位号','值','原理图原封装','工程封装','物料编码','物料描述','优选等级','装配类型','在PCB上','全部原始参数'],bom)
    write(out/'checks/schematic-build.json',{'source_records':len(records),'components':len(components),'pins':sum(len(c['pins']) for c in components),'graphics':graphics_count,**counts,'root_uuid':root_id,'symbols':symbol_map,'reads':READS,'generated_by':'Codex-authored data-to-KiCad generator'})
    print(json.dumps({'stage':'schematic','components':len(components),**counts}))

if __name__=='__main__':main()
