"""Assemble a new PCB from explicit object inputs and approved adjustments."""
import argparse, copy, math, shutil, xml.etree.ElementTree as ET
from common import *
import pcbnew as p

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--inputs',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();inp=a.inputs.resolve();out=a.out.resolve()
    cfg=read(inp/'01_task/requirements.json');changes=read(inp/'07_adjustments/approved_changes.json');stem=cfg['stem']
    schmap=read(out/'checks/schematic-build.json');graph=read(inp/'04_schematic/recomputed_connectivity.json')
    compiled={tuple(sorted((n.get('ref'),n.get('pin')) for n in net.findall('node'))):net.get('name') for net in ET.parse(out/'checks/compiled.xml').findall('./nets/net')}
    assert set(compiled)=={tuple(map(tuple,n['nodes'])) for n in graph['nets']},'Schematic connectivity differs from input'
    node_to_net={pair:name for group,name in compiled.items() for pair in group}
    nc_pins={tuple(pair) for n in graph['nets'] if n['nc'] for pair in n['nodes']}
    components=read(inp/'03_components/components.json');props_by_ref={c['reference']:{r['name']:r['value'] for r in c['parameters']} for c in components}
    patterns={c['designator']:c['pattern'] for c in read(inp/'06_pcb/native_tables/pcb_native_components.json')['components']}
    pins_by_ref={(pin['reference'],pin['pin']):text(pin['fields'],'Name') for pin in read(inp/'03_components/pins.json')}
    model_rows=read(inp/'08_dependencies/native_models/manifest.json');models={r['metadata']['ID']:r for r in model_rows}
    outmodels=out/'models';outmodels.mkdir(exist_ok=True)
    for row in model_rows:
        path=inp/row['path'];assert digest(path)==row['sha256'];shutil.copyfile(path,outmodels/path.name)
    byref=collections.defaultdict(list)
    for row in changes['model_links']:byref[row['ref']].append(row)
    layers={'User.Drawings':'Dwgs.User','User.Comments':'Cmts.User','User.Eco1':'Eco1.User','User.Eco2':'Eco2.User'}
    moves={r['source_index']:layers.get(r['to'],r['to']) for r in changes['layer_moves']}
    instances=read(inp/'05_footprints/instances.json');settings=read(inp/'06_pcb/settings.json');drawings=read(inp/'06_pcb/drawings.json')
    tracks=read(inp/'06_pcb/tracks.json');zones=read(inp/'06_pcb/zones.json')
    # This begins as an empty KiCad root and materializes each input object separately.
    boardtree=node('kicad_pcb');object_log=[]
    for row in settings+instances+drawings+tracks+zones:
        obj=decode(row['data']);kind=tag(obj);index=row['source_index']
        if kind=='footprint':
            fields=prop(obj);ref=fields.get('Reference','');params=props_by_ref.get(ref,{})
            fpname=safe(ref)+'_Original' if ref else 'AUX_'+str(index).zfill(4);obj[1]='DisplayBoard_Placed:'+fpname
            if ref:
                for field in children(obj,'property'):
                    if field[1]=='Value':field[2]=params.get('Comment',field[2])
                original_lib=next((text(r['fields'],'ModelName') for r in next(c for c in components if c['reference']==ref)['implementations'] if r['fields'].get('IsCurrent')=='T'),'')
                comp=next(c for c in components if c['reference']==ref);raw=comp['raw_fields']
                preserved={k:v for k,v in params.items() if k!='Comment'}
                preserved.update({'Altium_SourceUniqueID':raw.get('UniqueID',''),'Altium_LibReference':raw.get('LibReference',''),'Altium_RecordIndex':str(comp['source_locator']['record_index']),'Altium_OriginalFootprint':original_lib,'Altium_PCBPattern':patterns[ref]})
                for name,value in preserved.items():
                    obj.append(node('property',name,value,node('at',0,0,0),node('layer','B.SilkS' if child(obj,'layer')[1]=='B.Cu' else 'F.SilkS'),node('hide',S('yes')),node('effects',node('font',node('size',1.27,1.27)))))
                for field in children(obj,'path'):field[1]='/'+schmap['root_uuid']+'/'+schmap['symbols'][ref]
                for field in children(obj,'sheetfile'):field[1]=stem+'.kicad_sch'
                obj[:]=[v for v in obj if tag(v)!='sheetname']
                if cfg['lock_named_footprints'] and child(obj,'locked') is None:obj.append(node('locked',S('yes')))
                if not comp['pins']:
                    attr=child(obj,'attr')
                    if attr is None:attr=node('attr');obj.append(attr)
                    if S('exclude_from_pos_files') not in attr:attr.append(S('exclude_from_pos_files'))
            else:
                attr=child(obj,'attr')
                if attr is None:attr=node('attr');obj.append(attr)
                for name,enabled in cfg['auxiliary_footprints'].items():
                    if enabled and S(name) not in attr:attr.append(S(name))
            if ref in changes['jumper_references']:obj.append(node('jumper_pad_groups',['1','2']))
            links=sorted(byref.get(ref,[]),key=lambda x:x['body_index']);modelnodes=children(obj,'model')
            for link in links:
                assert link['model_id'] in models
                filename=Path(models[link['model_id']]['path']).name
                m=modelnodes[link['body_index']];m[1]='${KIPRJMOD}/models/'+filename
                child(child(m,'offset'),'xyz')[1:]=link['offset_mm'];child(child(m,'rotate'),'xyz')[1:]=link['rotation_deg']
            for fontfix in changes['font_changes']:
                if fontfix['ref']!=ref:continue
                for txt in children(obj,'fp_text'):
                    if len(txt)>2 and txt[2]==fontfix['text']:
                        font=child(child(txt,'effects'),'font');face=child(font,'face')
                        if face:face[1]=fontfix['after']
                        else:font.insert(1,node('face',fontfix['after']))
                        txt[:]=[v for v in txt if tag(v)!='render_cache']
            for pad in children(obj,'pad'):
                key=(ref,pad[1])
                if key in pins_by_ref:
                    for name,value in [('pinfunction',pins_by_ref[key]),('pintype','no_connect' if key in nc_pins else 'passive')]:
                        old=child(pad,name)
                        if old:old[1]=value
                        else:pad.append(node(name,value))
        elif kind.startswith('gr_') or kind=='dimension':
            layer=child(obj,'layer')
            if layer and layer[1]=='Edge.Cuts':layer[1]='Eco1.User'
            elif layer and index in moves:layer[1]=moves[index]
            if kind=='dimension' and index in moves:
                for textnode in children(obj,'gr_text'):
                    txtlayer=child(textnode,'layer')
                    if txtlayer:txtlayer[1]=moves[index]
        # Stable IDs are freshly derived from source locators, preserving same-object references.
        def refresh(x):
            if isinstance(x,list):return [refresh(v) for v in x]
            if isinstance(x,sx.Symbol):return x
            if isinstance(x,str):return re.sub(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',lambda m:uid('pcb/'+m[0]),x)
            return x
        # Schematic references were deliberately assigned above and must not be rewritten.
        savedpath=copy.deepcopy(child(obj,'path'));obj=refresh(obj)
        if savedpath:child(obj,'path')[1]=savedpath[1]
        boardtree.append(obj);object_log.append({'input_group':kind,'source_index':index,'output_uuid':child(obj,'uuid',['',None])[1]})
    pcbpath=out/(stem+'.kicad_pcb');save_sexp(pcbpath,boardtree)
    # Start project settings from KiCad's own defaults; native converted rules are in .kicad_dru.
    write(out/(stem+'.kicad_pro'),{})
    board=p.LoadBoard(str(pcbpath));fps={fp.GetReference():fp for fp in board.GetFootprints() if fp.GetReference()}
    sourcegroups=collections.defaultdict(set)
    for ref,fp in fps.items():
        for pad in fp.Pads():
            pair=(ref,pad.GetNumber())
            if pair in node_to_net:sourcegroups[pad.GetNetname()].add(pair)
    aliases={name:compiled[tuple(sorted(nodes))] for name,nodes in sourcegroups.items()}
    assert set(aliases)==set(changes['net_aliases_for_audit']) and aliases==changes['net_aliases_for_audit'],'Native/compiler net aliases disagree with approved evidence'
    nets={}
    for name in sorted(set(aliases.values())):
        net=p.NETINFO_ITEM(board,name);board.Add(net);nets[name]=net
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            old=pad.GetNetname()
            if old in aliases and (old or (fp.GetReference(),pad.GetNumber()) in node_to_net):pad.SetNet(nets[aliases[old]])
    for item in list(board.GetTracks())+list(board.Zones()):
        old=item.GetNetname()
        if old in aliases and old:item.SetNet(nets[aliases[old]])
    repaired=[]
    for spec in changes['pad_assignments']:
        fp=fps[spec['ref']];x,y=spec['position_mm'];candidates=[pad for pad in fp.Pads() if not pad.GetNumber() and math.hypot(p.ToMM(pad.GetPosition().x)-x,p.ToMM(pad.GetPosition().y)-y)<.002]
        assert len(candidates)==1,(spec,len(candidates))
        pad=candidates[0];pad.SetNumber(spec['pin']);pad.SetNet(nets[node_to_net[spec['ref'],spec['pin']]]);repaired.append(spec)
        pad.SetPinFunction(pins_by_ref[(spec['ref'],spec['pin'])]);pad.SetPinType('passive')
    def pt(x,y):return p.VECTOR2I(round(x*1000000),round(y*1000000))
    bounds=cfg['outline'];left,top=bounds['left_top_mm'];width,height=bounds['nominal_mm'];r=bounds['corner_radius_mm'];right=left+width;bottom=top+height
    for i,(a1,a2) in enumerate([((left+r,top),(right-r,top)),((right,top+r),(right,bottom-r)),((right-r,bottom),(left+r,bottom)),((left,bottom-r),(left,top+r))]):
        item=p.PCB_SHAPE(board);item.SetShape(p.SHAPE_T_SEGMENT);item.SetStart(pt(*a1));item.SetEnd(pt(*a2));item.SetLayer(p.Edge_Cuts);item.SetWidth(p.FromMM(.05));item.SetUuid(p.KIID(uid('outline/line/'+str(i))));board.Add(item)
    for i,(cx,cy,start) in enumerate([(right-r,top+r,-90),(right-r,bottom-r,0),(left+r,bottom-r,90),(left+r,top+r,180)]):
        point=lambda angle:pt(cx+r*math.cos(math.radians(angle)),cy+r*math.sin(math.radians(angle)))
        item=p.PCB_SHAPE(board);item.SetShape(p.SHAPE_T_ARC);item.SetArcGeometry(point(start),point(start+45),point(start+90));item.SetLayer(p.Edge_Cuts);item.SetWidth(p.FromMM(.05));item.SetUuid(p.KIID(uid('outline/arc/'+str(i))));board.Add(item)
    ds=cfg['dimension_style']
    for i,(start,end,h) in enumerate([((left,bottom),(right,bottom),ds['horizontal_offset_mm']),((left,top),(left,bottom),ds['vertical_offset_mm'])]):
        dim=p.PCB_DIM_ALIGNED(board);dim.SetStart(pt(*start));dim.SetEnd(pt(*end));dim.SetHeight(p.FromMM(h));dim.SetLayer(p.Dwgs_User);dim.SetUnitsMode(p.DIM_UNITS_MODE_MM);dim.SetUnitsFormat(p.DIM_UNITS_FORMAT_BARE_SUFFIX);dim.SetPrecision(2);dim.SetTextSize(pt(ds['text_size_mm'],ds['text_size_mm']));dim.SetLineThickness(p.FromMM(ds['line_width_mm']));dim.SetTextThickness(p.FromMM(ds['text_thickness_mm']));dim.SetArrowLength(p.FromMM(ds['arrow_length_mm']));dim.SetUuid(p.KIID(uid('dimension/'+str(i))));dim.Update();board.Add(dim)
    board.BuildConnectivity();p.SaveBoard(str(pcbpath),board)
    # Extract only from this newly generated board, to create this run's own editable library.
    lib=out/'DisplayBoard_Placed.pretty';lib.mkdir(exist_ok=True);io=p.PCB_IO_MGR.FindPlugin(p.PCB_IO_MGR.KICAD_SEXP)
    for fp in board.GetFootprints():io.FootprintSave(str(lib),fp)
    save_sexp(out/'fp-lib-table',node('fp_lib_table',node('lib',node('name','DisplayBoard_Placed'),node('type','KiCad'),node('uri','${KIPRJMOD}/DisplayBoard_Placed.pretty'),node('options',''),node('descr','Original instance geometry'))))
    assert p.GetSettingsManager().SaveProject(str(out/(stem+'.kicad_pro')))
    rules=read(inp/'06_pcb/native_tables/pcb_native_rules.json')['records'];rulemap={r['raw_fields'].get('NAME'):r['raw_fields'] for r in rules}
    def length(v):return float(v[:-3])*.0254 if v.endswith('mil') else float(v.replace('mm',''))
    def constraint(t,**values):return '('+t+' '+ ' '.join('('+k+' '+format(v,'.12g')+'mm)' for k,v in values.items())+')'
    def rule(name,cons,condition=None):
        return '(rule '+json.dumps(name)+(' (condition '+json.dumps(condition)+')' if condition else '')+' '+ ' '.join('(constraint '+c[1:] for c in cons)+')'
    converted=[rule('NET TO ALL',[constraint('clearance',min=length(rulemap['NET TO ALL']['GAP']))]),
        rule('Width',[constraint('track_width',min=length(rulemap['Width']['MINLIMIT']),opt=length(rulemap['Width']['PREFEREDWIDTH']),max=length(rulemap['Width']['MAXLIMIT']))]),
        rule('HoleSize',[constraint('hole_size',min=length(rulemap['HoleSize']['MINLIMIT']),max=length(rulemap['HoleSize']['MAXLIMIT']))],"A.Type == 'Pad' || A.Type == 'Via'"),
        rule('RoutingVias',[constraint('via_diameter',min=length(rulemap['RoutingVias']['MINWIDTH']),max=length(rulemap['RoutingVias']['MAXWIDTH'])),constraint('hole_size',min=length(rulemap['RoutingVias']['MINHOLEWIDTH']),max=length(rulemap['RoutingVias']['MAXHOLEWIDTH']))],"A.Type == 'Via'")]
    (out/(stem+'.kicad_dru')).write_text('(version 1)\n'+'\n'.join(converted)+'\n',encoding='utf-8')
    write(out/'checks/pcb-build.json',{'objects':object_log,'net_aliases':aliases,'pad_repairs':repaired,'model_links':len(changes['model_links']),'counts':{'footprints':len(list(board.GetFootprints())),'pads':sum(len(list(fp.Pads())) for fp in board.GetFootprints()),'tracks':len(list(board.GetTracks())),'zones':len(list(board.Zones()))},'reads':READS,'native_import_called':False,'historical_complete_board_read':False})
    print(json.dumps({'stage':'pcb',**read(out/'checks/pcb-build.json')['counts'],'repaired_pads':len(repaired)}))

if __name__=='__main__':main()
