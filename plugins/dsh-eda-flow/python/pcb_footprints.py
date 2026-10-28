"""Compile host-selected source geometry into project-local KiCad footprints.
No component positions, net definitions, or reference-board data are accepted.
"""
import json, hashlib, copy, math
from pathlib import Path
from native_resources import parse, dump, Atom
from native_schematic import child, children

def q(value): return json.dumps(str(value), ensure_ascii=False)
def nums(values): return ' '.join(str(x) for x in values)

def normalized_geometry(spec):
    """Move metadata-only custom anchors inside copper, preserving polygon XY.
    KiCad unions the anchor with the polygon. A nanometre anchor on a vertex
    can quantize to a disconnected island. Never widen/add connecting copper.
    """
    geometry=copy.deepcopy(spec['geometry']);changes=[]
    for pad in geometry['pads']:
        if pad['shape']!='custom':continue
        points=pad['polygon'];edges=list(zip(points,points[1:]+points[:1]))
        cross=[a[0]*b[1]-b[0]*a[1] for a,b in edges];area=sum(cross)
        if abs(area)<1e-12:raise ValueError('Degenerate custom copper polygon')
        candidates=[(sum((a[0]+b[0])*c for (a,b),c in zip(edges,cross))/(3*area),sum((a[1]+b[1])*c for (a,b),c in zip(edges,cross))/(3*area))]
        candidates += [tuple(sum(t[k] for t in [points[i-1],points[i],points[(i+1)%len(points)]])/3 for k in [0,1]) for i in range(len(points))]
        def inside(x,y):
            hits=0
            for (ax,ay),(bx,by) in edges:
                if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:hits+=1
            return hits%2==1
        def clearance(x,y):
            values=[]
            for (ax,ay),(bx,by) in edges:
                dx,dy=bx-ax,by-ay;den=dx*dx+dy*dy
                t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/den)) if den else 0
                values.append(math.hypot(x-ax-t*dx,y-ay-t*dy))
            return min(values)
        # Only metadata anchors (not functional pads) can be relocated.
        if inside(0,0) and clearance(0,0)>math.hypot(*pad['size'])/2+.000002:continue
        if max(pad['size'])>.000001:raise ValueError('Custom copper anchor has physical area; explicit support required')
        valid=[(clearance(x,y),x,y) for x,y in candidates if inside(x,y)]
        if not valid or max(valid)[0]<.00001:raise ValueError('No safe interior anchor for custom copper')
        _,dx,dy=max(valid);dx,dy=round(dx,6),round(dy,6)
        x,y,angle=pad['at'];rad=math.radians(angle)
        # KiCad positive pad rotation is counterclockwise in board coordinates.
        pad['at']=[round(x+dx*math.cos(rad)+dy*math.sin(rad),6),round(y-dx*math.sin(rad)+dy*math.cos(rad),6),angle]
        pad['polygon']=[[round(px-dx,6),round(py-dy,6)] for px,py in points]
        changes.append({'pad':pad['number'],'sourceAt': [x,y,angle],'nativeAt':pad['at'],'localTranslation':[dx,dy],'copperVerticesPreserved':True,'coordinateResolutionMm':.000001})
    return geometry,changes

def assembly_attribute(spec):
    """Use electrical terminal construction, never reference/value or board pose.
    Duplicate surface copper on a plated terminal does not turn a THT part
    into an SMD part. Copper-only/unnumbered features give no placement claim.
    """
    terminals=[pad for pad in spec['geometry']['pads'] if pad['number']]
    if any(pad['type']=='thru_hole' for pad in terminals):return 'through_hole'
    if terminals and all(pad['type']=='smd' for pad in terminals) and any(any(layer.endswith('.Paste') for layer in pad['layers']) for pad in terminals):return 'smd'
    return None

def synchronize_imported_assembly(board,imports):
    """Refresh known imported type bits after historical geometry is verified.
    Preserve DNP/exclusions, positions, pads and all electrical information.
    Validate all identities before applying any attribute changes.
    """
    import pcbnew as pcb
    types={'smd':pcb.FP_SMD,'through_hole':pcb.FP_THROUGH_HOLE}
    mask=pcb.FP_SMD|pcb.FP_THROUGH_HOLE;pending=[];seen=set()
    for spec in imports:
        if spec['ref'] in seen:raise ValueError('Duplicate imported assembly reference '+spec['ref'])
        seen.add(spec['ref']);matches=[fp for fp in board.GetFootprints() if fp.GetReference()==spec['ref']]
        if len(matches)!=1:raise ValueError('Imported assembly reference is not unique '+spec['ref'])
        fp=matches[0];actual=str(fp.GetFPID().GetLibNickname())+':'+str(fp.GetFPID().GetLibItemName())
        if actual!=spec['id']:raise ValueError('Imported assembly footprint identity changed '+spec['ref'])
        attr=assembly_attribute(spec)
        if attr is None:continue
        before=fp.GetAttributes();after=(before & ~mask)|types[attr]
        if before!=after:pending.append((fp,after,{'ref':spec['ref'],'beforeBits':before & mask,'after':attr,'basis':'current evidence pad construction'}))
    for fp,after,_ in pending:fp.SetAttributes(after)
    return [row for _,_,row in pending]

def native_footprint(spec):
    name=spec['id'].split(':',1)[1]; g,_=normalized_geometry(spec)
    rows=[f'(footprint {q(name)} (version 20260101) (generator "dsh_eda_flow") (layer "F.Cu")',
          '(property "Reference" "REF**" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))',
          f'(property "Value" {q(name)} (at 0 0) (layer "F.Fab") (hide yes) (effects (font (size 1 1) (thickness 0.15))))']
    attribute=assembly_attribute(spec)
    if attribute:rows.append(f'(attr {attribute})')
    x0,y0,x1,y1=g['envelope']
    # An evidence-defined envelope reserves placement area; it is not a body
    # drawing, a guessed courtyard expansion, or a manufacturer's tolerance.
    rows.append(f'(fp_rect (start {x0} {y0}) (end {x1} {y1}) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))')
    for p in g['pads']:
        row=f'(pad {q(p["number"])} {p["type"]} {p["shape"]} (at {nums(p["at"])}) (size {nums(p["size"])}) (layers {" ".join(map(q,p["layers"]))})'
        if p['type']=='thru_hole':
            a,b=p['drill']; row+=f' (drill {a})' if a==b else f' (drill oval {a} {b})'
        if p['shape']=='roundrect':row+=f' (roundrect_rratio {p["roundrectRatio"]})'
        if p['shape']=='custom':
            row+=' (options (clearance outline) (anchor rect)) (primitives (gr_poly (pts '+''.join(f'(xy {nums(point)})' for point in p['polygon'])+') (width 0) (fill yes)))'
        rows.append(row+')')
    rows.append(')');return '\n'.join(rows)+'\n'

def bind_imports(project,sch,imports,components):
    """Change only instance Footprint properties in the PCB's schematic copy."""
    if not imports:return []
    ast=parse(sch.read_text(encoding='utf-8'));byref={c['ref']:c for c in components};changed=[]
    for spec in imports:
        c=byref[spec['ref']]
        if c['footprint']:raise ValueError('Cannot replace frozen footprint '+c['ref'])
        expected={str(p['pad']) for p in c['pins']}
        pads={p['number'] for p in spec['geometry']['pads'] if p['number']}
        if pads!=expected:raise ValueError('Footprint pin coverage changed '+c['ref'])
        instances=[s for s in children(ast,'symbol') if any(p[1]=='Reference' and p[2]==c['ref'] for p in children(s,'property'))]
        if len(instances)!=1:raise ValueError('Ambiguous schematic reference '+c['ref'])
        prop=next((p for p in children(instances[0],'property') if p[1]=='Footprint'),None)
        if prop is None or prop[2]:raise ValueError('Expected deferred footprint '+c['ref'])
        prop[2]=spec['id']
        lib,name=spec['id'].split(':',1)
        if lib!='EvidencePkg' or not name.startswith('FP_') or any(x in name for x in ['..','/','\\']):raise ValueError('Unsafe footprint ID')
        directory=project/(lib+'.pretty');directory.mkdir(exist_ok=True)
        text=native_footprint(spec);(directory/(name+'.kicad_mod')).write_text(text,encoding='utf-8')
        changed.append({**spec,'assemblyAttribute':assembly_attribute(spec),'nativeSha256':hashlib.sha256(text.encode('utf8')).hexdigest(),'anchorNormalization':normalized_geometry(spec)[1]})
    sch.write_text(dump(ast)+'\n',encoding='utf-8')
    return changed

def electrical_identity(comps,nets):
    # The only permitted late binding change is the Footprint property.
    return {'components':sorted((c['ref'],c['value'],c['uuid']) for c in comps),
            'nets':sorted((n['name'],sorted(n['nodes'])) for n in nets)}

def verify_pad_assignments(board,expected):
    """Verify EVERY physical pad, including duplicates; never collapse to dict."""
    count=0;seen=set()
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            key=(fp.GetReference(),pad.GetNumber())
            if key in expected:
                if pad.GetNetname()!=expected[key]:raise ValueError('PCB net mapping changed: '+'.'.join(key))
                count+=1;seen.add(key)
            elif pad.GetNetCode()!=0:raise ValueError('Unexpected connected pad: '+'.'.join(key))
    if seen!=set(expected):raise ValueError('PCB source pad missing')
    return count
