import record_io
"""Single-sheet native KiCad compiler, with ELK routing and independent read-back gates."""
import sys
sys.dont_write_bytecode=True
import collections, copy, csv, json, math, subprocess, uuid, os, itertools, re
from datetime import date
from pathlib import Path
import xml.etree.ElementTree as ET
from wiring_policy import label_reserve, layer_spacing
from page_planning import pack_groups, signal_affinities
import native_resources as nr
from design_audit import child, children
from native_schematic import parse as read_native
import functional_layout as geom
import fixed_components as fc
from controlled_layout import export
from functional_groups import _blocked_net, _is_kind, _is_passive, _kind, decoupling_hints, interface_feed_nets

A=nr.Atom

# Generic layouts start on the requested sheet and grow only when the
# generated functional groups cannot be packed without clipping.  The caller
# still accepts the public A4/A3 request; the compiler may promote that
# request to the next landscape sheet after it has measured the actual
# symbol-and-wire bounds.  Keeping the sizes here (rather than in the model
# prompt) makes the decision deterministic and independent of reference
# designators or a particular project.
PAGE_SIZES={
    'A4-landscape':(297,210),
    'A3-landscape':(420,297),
    'A2-landscape':(594,420),
    'A1-landscape':(841,594),
    'A0-landscape':(1189,841),
}

def page_size(paper):
    try:return PAGE_SIZES[paper]
    except KeyError:raise ValueError('Unsupported landscape page: '+str(paper))

def page_candidates(requested):
    """Return requested and larger landscape sheets in engineering order."""
    names=list(PAGE_SIZES)
    try:start=names.index(requested)
    except ValueError:return [requested]
    return names[start:]

def io_path(p):
    """Use extended Windows paths for nested workflow evidence as well as CAD."""
    p=os.path.abspath(p)
    if os.name=='nt' and not p.startswith('\\\\?\\'):
        p='\\\\?\\UNC\\'+p[2:] if p.startswith('\\\\') else '\\\\?\\'+p
    return Path(p)
def read(p): return record_io.read_json(p)
def write(p,v):
    p=io_path(p);p.parent.mkdir(parents=True,exist_ok=True)
    record_io.write_json(p,v)
def uid(): return str(uuid.uuid4())
def form(key,*args): return [A(key),*args]
def snap(x): return round(round(float(x)/1.27)*1.27,4)

def number(x): return A(str(round(float(x),4)))
def at(x,y,angle=None): return form('at',number(x),number(y),*([number(angle)] if angle is not None else []))
def replace(row,key,value):
    for i,x in enumerate(row):
        if isinstance(x,list) and x[0]==key: row[i]=value;return
    row.append(value)

def _safe_terminal_lead(pos, direction, owner, body_boxes, nominal, reserved_end=None):
    """Keep an un-routed label lead outside nearby symbol bodies.

    Shared return nets intentionally use short open stubs instead of a
    page-wide rail.  A nominal vertical stub can nevertheless end inside a
    neighbouring serial resistor when the two functional rows share a
    column.  Shorten only that stub, preserving its pin, direction, and net;
    routed local paths and label anchors are otherwise unchanged.
    """
    dx,dy=(float(direction[0]),float(direction[1]))
    if reserved_end is not None:
        reserved=(float(reserved_end[0])-float(pos[0]))*dx+(float(reserved_end[1])-float(pos[1]))*dy
        if reserved<=0:raise ValueError('Terminal label has no outward reserved channel')
        nominal=min(float(nominal),reserved)
    step=1.27
    minimum=min(2.54,nominal)
    lengths=[float(nominal)-index*step for index in range(int(round((float(nominal)-minimum)/step))+1)]
    for length in lengths:
        candidate=[round(float(pos[0])+dx*length,4),round(float(pos[1])+dy*length,4)]
        if not any(
            ref!=owner and geom.intersects(pos,candidate,geom.grow(box,.5))
            for ref,box in body_boxes
        ):
            return candidate
    return [round(float(pos[0])+dx*float(nominal),4),round(float(pos[1])+dy*float(nominal),4)]

HELPER='(symbol "Host:SupplyDeclaration" (pin_names hide) (pin_numbers hide) (in_bom no) (on_board no) (symbol "SupplyDeclaration_1_1" (pin power_out line (at 0 0 0) (length 0) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))))'


def validate(d):
    pins={c['ref']+'.'+p['number'] for c in d['components'] for p in c['pins']}
    members=[k for n in d['nets'] for k in n['nodes']]+d['nc']
    names=[n['name'] for n in d['nets']]
    if len(members)!=len(set(members)) or set(members)!=pins: raise ValueError('Every pin must belong to exactly one net or NC')
    if len(names)!=len(set(names)) or any(not n or n.startswith('/') or '${' in n or '\n' in n for n in names): raise ValueError('Single-sheet net names must be unique, literal and not start with /')
    if set(d.get('supplied_nets',[]))-set(names) or len(d.get('supplied_nets',[]))!=len(set(d.get('supplied_nets',[]))): raise ValueError('Invalid supplied_nets')
    group={k:i for i,n in enumerate(d['nets']) for k in n['nodes']};group.update({k:len(d['nets'])+i for i,k in enumerate(d['nc'])})
    for f in d.get('functions',[]):
        for c in f['checks']:
            gs=[group.get(k) for k in c['nodes']]
            if None in gs or not (len(set(gs))==1 if c['kind']=='connected' else len(set(gs))==len(gs)): raise ValueError('Function condition contradicts design: '+f['requirementId'])

def document(resources,instances,paper='A4',extras=None,rootid=None,value_notes=None):
    return [A('kicad_sch'),form('version',A('20260101')),form('generator','dsh_controlled_native'),form('uuid',rootid or uid()),form('paper',paper),
            form('title_block',form('title',resources.get('title','Circuit design')),form('date',date.today().isoformat()),form('rev','1'),form('comment',A('1'),'Engineering requirements and component specifications'),*[form('comment',A(str(i+2)),note) for i,note in enumerate(value_notes or [])]),
            form('lib_symbols',*[nr.parse(v['native']) for v in resources['symbols'].values()],*([nr.parse(HELPER)] if extras and any(x[0]=='symbol' for x in extras) else [])),*instances,*(extras or [])]

def instance(c,resource,x=0,y=0,rotation=0):
    s=nr.parse(resource['native']); properties=copy.deepcopy([p for p in children(s,'property') if p[1] not in ('ki_keywords','ki_fp_filters')]); values={'Reference':c['ref'],'Value':c['value'],'Footprint':c['footprint'],'MPN':c['mpn'],'DesignId':c['id']}
    values.update({field:c[key] for key,field in [('originalFootprint','OriginalFootprint'),('materialCode','MaterialCode'),('materialDescription','MaterialDescription'),('assemblyType','AssemblyType'),('objectRole','ObjectRole')] if key in c})
    from value_selection import fields
    values.update(fields(c))
    for name,value in values.items():
        p=next((p for p in properties if p[1]==name),None)
        if p is None:
            p=form('property',name,value,at(0,0,0),form('effects',form('font',form('size',number(1.27),number(1.27))),*([form('hide',A('yes'))] if name not in ('Reference','Value') else [])));properties.append(p)
        p[2]=value
    return form('symbol',form('lib_id',c['librarySymbol']),at(x,y,rotation),form('unit',A('1')),form('in_bom',A('yes' if c['in_bom'] else 'no')),form('on_board',A('yes' if c['on_board'] else 'no')),form('dnp',A('yes' if c['dnp'] else 'no')),form('uuid',uid()),*properties)

def visible(p):
    hidden=lambda r: 'hide' in r or child(r,'hide') is not None and child(r,'hide')[1:]!=['no']
    return not hidden(p) and not hidden(child(p,'effects',[]))

def _pin_number_boxes(symbol, position, rotation):
    """Reserve visible pin-number lanes in page space for net labels."""
    if not symbol.get('pin_numbers_visible',True):return []
    boxes=[]
    item={'at':[position[0],position[1],rotation]}
    for pin in symbol.get('pins',[]):
        if not pin.get('visible',True) or pin.get('length',0)<=0:continue
        x,y,angle=pin['at'];theta=math.radians(angle)
        a=geom.world(item,[x,y]);b=geom.world(item,[x+math.cos(theta)*pin['length'],y+math.sin(theta)*pin['length']])
        font_height=max(pin.get('number_font',{}).get('size',[1.27,1.27]))
        margin=font_height+0.4
        if abs(a[1]-b[1])<.001:
            inset=min(.1,abs(a[0]-b[0])/4)
            boxes.append([min(a[0],b[0])+inset,a[1]-margin,max(a[0],b[0])-inset,a[1]+.4])
        elif abs(a[0]-b[0])<.001:
            inset=min(.1,abs(a[1]-b[1])/4)
            boxes.append([a[0]-margin,min(a[1],b[1])+inset,a[0]+.4,max(a[1],b[1])-inset])
        else:
            boxes.append([min(a[0],b[0])-margin,min(a[1],b[1])-margin,max(a[0],b[0])+margin,max(a[1],b[1])+margin])
    return boxes

def _compact_passive_fields(parts, shown, bounds, horizontal, rotation=0, column_text=False):
    """Place visible R/C fields around the symbol's real body bounds.

    Generic field placement used to put every visible field in one vertical
    stack on the same side of a two-terminal symbol.  That stack became part
    of the ELK obstacle, so a bank of horizontally oriented resistors was
    spaced by the field stack rather than by the actual symbol.  Keep both
    fields visible, but use the two free sides of the body for the common
    two-field case and return the exact conservative boxes used by placement.
    """
    boxes=[]
    # Symbol fields are authored in the instance's local frame.  A passive
    # whose pins are turned to the side (90/270 degrees) would therefore turn
    # an otherwise horizontal annotation with the body.  Keep annotations
    # readable in page coordinates by compensating the local field angle for
    # the frozen instance rotation.  ``% 180`` keeps the text upright while
    # avoiding an upside-down 180-degree variant.
    column_text=column_text and not horizontal and len(shown)<=2 and all(p[1] in ('Reference','Value') for p in shown)
    field_angle=(float(rotation)+(90 if column_text else 0))%180
    b0,b1,b2,b3=(float(v) for v in bounds)
    for index, prop in enumerate(shown):
        text=str(prop[2]);width=max(1.8,len(text)*1.15);height=1.8
        if column_text:
            # A bank of vertical input shunts occupies parallel columns.
            # Centered text following each body uses the two free sides and
            # avoids making the column pitch proportional to value length.
            # Reserve the full rotated text height; long values can still
            # move the bank outward, but never disappear or overlap pins.
            x=b0-2.54 if index==0 else b2+2.54
            y=(b1+b3)/2
            justify=()
            box=[x-height/2-.4,y-width/2-.4,x+height/2+.4,y+width/2+.4]
        elif horizontal and len(shown)<=2:
            # A horizontal passive is commonly repeated in a dense output
            # bank.  Keep both annotations in one lane just outside the body
            # and put them outside the pin axis, so the visible wire row
            # remains the dominant spacing constraint instead of a ref/value
            # stack.  The 0.5 mm body gap is deliberate: KiCad's stroke text
            # extends about 0.5--1.8 mm beyond the property anchor.  The old
            # 3.07 mm offset placed the glyphs in the first orthogonal route
            # below a top-mounted bypass capacitor even though its estimated
            # field box looked clear.
            y=b3+0.5
            if index==0:
                x=b0-1.27-width
            else:
                # A 90-degree field grows left from its anchor.  Keeping the
                # value just inside the terminal envelope leaves room for a
                # neighbouring input label at the next source row while the
                # glyph still remains outside the symbol body.
                x=b2-0.254 if field_angle==90 else b2+1.27
            justify=('left','bottom')
            # A 90 degree property angle is compensated for the rotated
            # instance above, but KiCad keeps the text justification in the
            # property frame.  Its actual PDF glyph direction therefore
            # depends on whether the parent instance is at 90 or 270
            # degrees.  Reserve that rendered envelope rather than the
            # unrotated local estimate.
            if field_angle==90:
                # The property angle is relative to the symbol instance.  A
                # 90-degree instance therefore renders this field leftward,
                # while a 270-degree instance renders the same local 90
                # degree property rightward.  Keep the two envelopes on the
                # side KiCad actually paints; otherwise the router can place
                # a vertical terminal path through the visible glyph (the
                # latter is especially easy to hit on a bypass capacitor).
                if int(round(float(rotation))) % 360 == 270:
                    box=[x-0.2,y-1.1,x+width+0.3,y+0.4]
                else:
                    box=[x-width-0.3,y+0.3,x+0.2,y+2.0]
            else:
                box=[x-0.2,y-1.1,x+width+0.2,y+0.4]
        elif horizontal:
            above=index%2==0
            lane=index//2
            if above:
                y=b1-2.54-lane*(height+1.27)
            else:
                y=b3+2.54+height+lane*(height+1.27)
            x=b0
            justify=('left','bottom')
            box=[x,y-height,x+width,y]
        else:
            left=index%2==0
            lane=index//2
            y=(b1+b3)/2+lane*(height+1.27)
            if left:
                x=b0-2.54-width
            else:
                x=b2+2.54
            # KiCad rotates field justification with a 180-degree parent.
            # Compensate it so the glyph still grows right/up from this
            # page-space anchor, matching the obstacle used by the router.
            justify=('right','top') if int(round(float(rotation)))%360==180 else ('left','bottom')
            box=[x-0.2,y-height-0.2,x+width+0.3,y+0.4]
        replace(prop,'at',at(x,y,field_angle))
        replace(child(prop,'effects'),'justify',form('justify',*(A(v) for v in justify)))
        boxes.append(box)
    return boxes

def wire(a,b): return form('wire',form('pts',form('xy',number(a[0]),number(a[1])),form('xy',number(b[0]),number(b[1]))),form('stroke',form('width',number(.18)),form('type',A('default'))),form('uuid',uid()))
def connected_label_point(pos,direction,routes,preferred):
    distances=[]
    for a,b in routes:
        if not geom.on(pos,a,b):continue
        for q in (a,b):
            delta=[q[0]-pos[0],q[1]-pos[1]]
            along=delta[0]*direction[0]+delta[1]*direction[1]
            cross=delta[0]*direction[1]-delta[1]*direction[0]
            if along>0 and abs(cross)<.0001:distances.append(along)
    if not distances:raise ValueError('No outward wire supports net label at '+str(pos))
    distance=min(preferred,max(distances))
    return [round(pos[i]+direction[i]*distance,4) for i in (0,1)]

def split_wire_vertices(routes, anchors=()):
    """Materialize T connections; leave interior/interior crossings unconnected."""
    segments={tuple(sorted((tuple(a),tuple(b)))) for a,b in routes if a!=b}
    vertices={p for edge in segments for p in edge}|{tuple(p) for p in anchors};result=set()
    for a,b in segments:
        points=sorted(p for p in vertices if geom.on(p,a,b))
        result.update(tuple(sorted((p,q))) for p,q in zip(points,points[1:]) if p!=q)
    return result

def prune_unanchored_wire_tails(routes, anchors):
    """Remove unused leaves while retaining every pin and visible net label."""
    protected={tuple(p) for p in anchors}
    segments=split_wire_vertices(routes,protected)
    while segments:
        degree=collections.Counter(p for edge in segments for p in edge)
        leaves={p for p,count in degree.items() if count==1 and p not in protected}
        discarded={edge for edge in segments if any(p in leaves for p in edge)}
        if not discarded:break
        segments.difference_update(discarded)
    return segments

def route_islands(routes):
    """Map wire vertices to physical islands before net-label deduplication."""
    adjacent=collections.defaultdict(set)
    for a,b in split_wire_vertices(routes):
        adjacent[a].add(b);adjacent[b].add(a)
    islands={}
    for start in sorted(adjacent):
        if start in islands:continue
        pending=[start];islands[start]=start
        while pending:
            point=pending.pop()
            for other in adjacent[point]:
                if other not in islands:islands[other]=start;pending.append(other)
    return islands

def supply_helpers(d):
    outputs={c['ref']+'.'+p['number'] for c in d['components'] for p in c['pins'] if p['type']=='power_out'}
    return {f'#PWR{i+1:02}':name for i,name in enumerate(d.get('supplied_nets',[])) if not outputs.intersection(next(n['nodes'] for n in d['nets'] if n['name']==name))}
def same_net_terminals(d):
    """A two-terminal part explicitly on one net uses two named stubs.
    Do not draw a misleading extra bypass loop around the fitted component.
    Both pins remain in the native netlist and independent topology audit.
    """
    netof={pin:n['name'] for n in d['nets'] for pin in n['nodes']}
    result=set()
    for c in d['components']:
        pins=[c['ref']+'.'+p['number'] for p in c['pins']]
        if len(pins)==2 and pins[0] in netof and netof.get(pins[1])==netof[pins[0]]:result.update(pins)
    return result


def _presentation_tree_edges(members, d, netof):
    """Return a topology-stable hub/trunk/tap tree for a local net.

    Electrical nets remain frozen hypernets.  This helper only chooses the
    visible presentation tree; choosing a root by pin role and then sorting
    the taps prevents serialized node order from becoming a long wire chain.
    """
    keys=sorted(set(members))
    if len(keys)<2:return []
    comps={c['ref']:c for c in d.get('components',[])}
    def rank(key):
        ref,num=key.rsplit('.',1);pin=next((p for p in comps[ref].get('pins',[]) if str(p.get('number'))==num),{})
        typ=str(pin.get('type') or '').lower()
        if typ in ('output','power_out'):return 0
        if len(comps[ref].get('pins',[]))>2:return 1
        if typ in ('power_in','input'):return 2
        return 3
    root=min(keys,key=lambda key:(rank(key),key))
    net_name=str(netof[root])
    safe=lambda value:re.sub(r'[^A-Za-z0-9_.-]+','_',str(value))
    return [
        {
            'id':'presentation-'+safe(net_name)+'-'+safe(root)+'-'+safe(key),
            'sources':[root],
            'targets':[key],
            'net':netof[key],
        }
        for key in keys if key!=root
    ]
def label(name,p,d,angle=0):
    just='right' if d[0]<0 else 'left'
    return form('label',name,at(*p,angle),form('effects',form('font',form('size',number(1),number(1))),form('justify',A(just),A('bottom'))),form('uuid',uid()))

def required_visual_groups(d,resources):
    """Keep evidenced functional circuits intact instead of hiding wires in labels."""
    if not resources:return []
    comps={c['ref']:c for c in d['components']};same=same_net_terminals(d);result=[]
    supplied=set(d.get('supplied_nets',[]))
    kind=lambda c:_kind(c,resources)
    netof={p:n for n in d['nets'] for p in n['nodes']}
    for hub in d['components']:
        if len(hub['pins'])<=2:continue
        branches=set()
        for pin in hub['pins']:
            if str(pin.get('type','')).lower()!='output':continue
            net=netof.get(hub['ref']+'.'+str(pin['number']))
            if not isinstance(net,dict) or _blocked_net(net.get('name'),supplied):continue
            for key in net.get('nodes',[]):
                ref=key.rsplit('.',1)[0];c=comps.get(ref)
                if c and len(c['pins'])==2 and _is_kind(kind(c),'resistor') and key not in same:branches.add(ref)
        # Connector pins may be typed output by interface direction.  That
        # does not make a shared connector the active owner of every module's
        # input conditioning chain.
        if len(branches)>=3 and not _is_kind(kind(hub),'connector'):
            result.append({hub['ref'],*branches})
        if _is_kind(kind(hub),'specified-receiver','infrared-receiver'):
            adjacent=set()
            for pin in hub['pins']:
                if str(pin.get('name','')).upper() in ('GND','VSS','SGND'):continue
                net=netof.get(hub['ref']+'.'+str(pin['number']))
                # A shared supply/return rail is not evidence that every
                # capacitor belongs to this receiver.  Explicit decoupling
                # ownership is handled by functional_groups; only a local
                # signal branch is required here.
                if not isinstance(net,dict) or _blocked_net(net.get('name'),supplied):continue
                for key in net.get('nodes',[]):
                    ref=key.rsplit('.',1)[0];c=comps.get(ref)
                    if c and len(c['pins'])==2 and _is_kind(kind(c),'specified-resistor','specified-capacitor','resistor','capacitor') and key not in same:adjacent.add(ref)
            if adjacent:result.append({hub['ref'],*adjacent})
    process={c['ref'] for c in d['components'] if c.get('objectRole')=='process'}
    if len(process)>1:result.append(process)
    # A validated ``functions[].layout`` decoupling hint is an explicit local
    # ownership decision.  Keep the owner and every named capacitor together
    # even when the model supplies otherwise sensible functional groups; the
    # hint is what disambiguates capacitors on a shared rail.
    for owner, members in decoupling_hints(d).items():
        member_refs = set(members) if isinstance(members, (list, tuple, set)) else set(members)
        if owner in comps and member_refs:
            result.append({owner, *member_refs})
    return result

def _grouping_design(d, resources):
    """Expose frozen resource blocks to the fallback grouping pass.

    ``functional_groups`` receives the reviewed design snapshot, while
    recognized resource blocks live beside it in ``resources``.  Keeping the
    latter out of the grouping input lets the fallback assign a block member
    to a signal or rail group before the later atomicity check can reject the
    result.  Add only a private copy of each resource block here; the frozen
    design and its netlist remain untouched.
    """

    resource_blocks = (resources or {}).get('blocks', [])
    if not resource_blocks:
        return d
    grouping = copy.deepcopy(d)
    instances = list(grouping.get('blockInstances') or [])
    known = set()
    for instance in instances:
        bindings = instance.get('bindings', {}) if isinstance(instance, dict) else {}
        if isinstance(bindings, dict):
            refs = frozenset(ref for ref in bindings.values() if isinstance(ref, str))
            if refs:
                known.add(refs)
    component_refs = {component.get('ref') for component in d.get('components', [])}
    for index, block in enumerate(resource_blocks):
        if not isinstance(block, dict):
            continue
        bindings = block.get('bindings') or {}
        if not isinstance(bindings, dict):
            continue
        refs = frozenset(
            ref for ref in bindings.values()
            if isinstance(ref, str) and ref in component_refs
        )
        if not refs or refs in known:
            continue
        instances.append({
            'blockId': str(
                block.get('blockId')
                or block.get('id')
                or 'resource-block-' + str(index + 1)
            ),
            'bindings': copy.deepcopy(bindings),
        })
        known.add(refs)
    grouping['blockInstances'] = instances
    return grouping

def normalize_layout(layout,d,resources=None):
    allowed={'template','paper','gapMm','groups','rotations','allowPaperPromotion'}
    if set(layout)-allowed or layout.get('template')!='generic-v1' or layout.get('paper') not in PAGE_SIZES: raise ValueError('Invalid presentation-only layout')
    if 'allowPaperPromotion' in layout and not isinstance(layout['allowPaperPromotion'],bool): raise ValueError('Invalid allowPaperPromotion')
    gap=layout.get('gapMm',7.62)
    if not isinstance(gap,(int,float)) or not 3.81<=gap<=25.4: raise ValueError('Invalid gapMm')
    refs=[c['ref'] for c in d['components']]
    groups=layout.get('groups')
    from functional_groups import groups as functional_groups
    suggested=functional_groups(_grouping_design(d, resources),resources or {})
    if not groups and suggested:groups=suggested
    if not groups:
        groups=[{'id':'block'+str(i),'title':b['blockId'],'references':list(b['bindings'].values())} for i,b in enumerate((resources or {}).get('blocks',d.get('blockInstances',[])))]
        used={r for g in groups for r in g['references']}
        if set(refs)-used:groups.append({'id':'circuit','title':'Circuit','references':[r for r in refs if r not in used]})
    if any(set(g)-{'id','title','references'} or not isinstance(g.get('id'),str) or not isinstance(g.get('title'),str) or not g.get('references') for g in groups): raise ValueError('Invalid visual groups')
    listed=[r for g in groups for r in g['references']]
    if len(set(g['id'] for g in groups))!=len(groups) or len(listed)!=len(set(listed)) or set(listed)!=set(refs): raise ValueError('Visual groups must cover every component exactly once')
    groupof={r:g['id'] for g in groups for r in g['references']}
    for circuit in required_visual_groups(d,resources):
        if len({groupof[r] for r in circuit})!=1:raise ValueError('Keep this functional circuit in one visual group; do not replace its wires with labels: '+', '.join(sorted(circuit)))
    for b in d.get('blockInstances',[]):
        if len({groupof[r] for r in b['bindings'].values()})!=1:raise ValueError('A frozen design block cannot be split across visual groups')
    for b in (resources or {}).get('blocks',[]):
        bindings=b.get('bindings') or {}
        if len({groupof[r] for r in bindings.values()})!=1:
            raise ValueError('A frozen resource block cannot be split across visual groups')
    connected=[{k.rsplit('.',1)[0] for k in n['nodes']} for n in d['nets'] if len({k.rsplit('.',1)[0] for k in n['nodes']})>1]
    if connected and not any(len({groupof[r] for r in rs})<len(rs) for rs in connected):raise ValueError('All-label layout rejected: keep a connected functional circuit together')
    rotations=layout.get('rotations',{})
    if set(rotations)-set(refs) or any(v not in (0,90,180,270) for v in rotations.values()): raise ValueError('Invalid component rotations')
    return {**layout,'gapMm':gap,'groups':groups,'rotations':rotations}


def _merge_orientation_defaults(requested, defaults, resources):
    """Apply automatic rotations while leaving frozen block geometry in charge.

    A snapshot can already contain native blocks from an earlier recognition
    pass.  Their symbols carry fixed internal orientations, so a library
    default (for example the standard resistor's 90-degree orientation) must
    not be passed back into ``generate`` as if it were a free component.
    Explicit request rotations remain present and are rejected by the block
    validation at the normal generation boundary.
    """
    explicit=copy.deepcopy(requested.get('rotations',{}))
    requested['rotations']={**defaults,**explicit}
    block_refs={
        ref
        for block in (resources or {}).get('blocks',[])
        for ref in (block.get('bindings') or {}).values()
    }
    for ref in block_refs:
        if ref not in explicit:
            requested['rotations'].pop(ref,None)
    return requested

def _route_points(section):
    return [dict(p) for p in [section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]]

def _route_segments(edge):
    result=[]
    for section_index,section in enumerate(edge.get('sections',[])):
        points=_route_points(section)
        for segment_index,(a,b) in enumerate(zip(points,points[1:])):
            ax,ay=float(a['x']),float(a['y']);bx,by=float(b['x']),float(b['y'])
            if abs(ax-bx)<1e-6 and abs(ay-by)<1e-6:continue
            result.append((section_index,segment_index,(ax,ay),(bx,by)))
    return result

def _same_axis_overlap(a,b,tolerance=1e-6):
    (ax,ay),(bx,by)=a;(cx,cy),(dx,dy)=b
    if abs(ay-by)<tolerance and abs(cy-dy)<tolerance and abs(ay-cy)<tolerance:
        return min(max(ax,bx),max(cx,dx))-max(min(ax,bx),min(cx,dx))
    if abs(ax-bx)<tolerance and abs(cx-dx)<tolerance and abs(ax-cx)<tolerance:
        return min(max(ay,by),max(cy,dy))-max(min(ay,by),min(cy,dy))
    return -1.0

def _cross_net_overlaps(edges):
    conflicts=[]
    for left_index,left in enumerate(edges):
        left_net=left.get('net')
        if not left_net:continue
        for right in edges[left_index+1:]:
            right_net=right.get('net')
            if not right_net or left_net==right_net:continue
            for left_section,left_segment,*left_points in _route_segments(left):
                for right_section,right_segment,*right_points in _route_segments(right):
                    overlap=_same_axis_overlap(left_points,right_points)
                    if overlap>=-1e-6:
                        conflicts.append((left,left_section,left_segment,left_points,right,right_section,right_segment,right_points,overlap))
    return conflicts

def _point_on_segment(point,a,b,tolerance=1e-6):
    x,y=point;ax,ay=a;bx,by=b
    if abs(ax-bx)<tolerance:
        return abs(x-ax)<tolerance and min(ay,by)-tolerance<=y<=max(ay,by)+tolerance
    if abs(ay-by)<tolerance:
        return abs(y-ay)<tolerance and min(ax,bx)-tolerance<=x<=max(ax,bx)+tolerance
    return False

def _cross_net_contacts(edges):
    """Return cross-network endpoint/T contacts not covered by overlap checks."""
    contacts=[];seen=set()
    for left_index,left in enumerate(edges):
        left_net=left.get('net')
        if not left_net:continue
        for right in edges[left_index+1:]:
            right_net=right.get('net')
            if not right_net or left_net==right_net:continue
            for left_section,left_segment,left_a,left_b in _route_segments(left):
                for right_section,right_segment,right_a,right_b in _route_segments(right):
                    if _same_axis_overlap((left_a,left_b),(right_a,right_b))>1e-6:continue
                    for point,left_endpoint in ((left_a,True),(left_b,True),(right_a,False),(right_b,False)):
                        other_a,other_b=(right_a,right_b) if left_endpoint else (left_a,left_b)
                        if not _point_on_segment(point,other_a,other_b):continue
                        key=(id(left),left_section,left_segment,id(right),right_section,right_segment,round(point[0],6),round(point[1],6))
                        if key in seen:continue
                        seen.add(key)
                        left_interior=_point_on_segment(point,left_a,left_b) and point not in (left_a,left_b)
                        right_interior=_point_on_segment(point,right_a,right_b) and point not in (right_a,right_b)
                        contacts.append((left,left_section,left_segment,(left_a,left_b),right,right_section,right_segment,(right_a,right_b),point,left_interior,right_interior))
    return contacts

def _corner_detour(edge,section_index,point,shapes,lane):
    """Replace an interior route corner with a one-lane dogleg."""
    sections=edge.get('sections',[])
    if section_index>=len(sections):return False
    section=sections[section_index];points=_route_points(section)
    index=next((i for i,p in enumerate(points[1:-1],1) if abs(float(p['x'])-point[0])<1e-6 and abs(float(p['y'])-point[1])<1e-6),None)
    if index is None:return False
    previous=points[index-1];current=points[index];following=points[index+1]
    vertical_before=abs(float(previous['x'])-float(current['x']))<1e-6
    horizontal_before=abs(float(previous['y'])-float(current['y']))<1e-6
    horizontal_after=abs(float(current['y'])-float(following['y']))<1e-6
    vertical_after=abs(float(current['x'])-float(following['x']))<1e-6
    if not ((vertical_before and horizontal_after) or (horizontal_before and vertical_after)):return False
    old=[dict(p) for p in points];candidates=[]
    if vertical_before and horizontal_after:
        for sign in (1,-1):
            x=float(current['x'])+sign*lane
            candidates.append([previous,{'x':x,'y':float(previous['y'])},{'x':x,'y':float(following['y'])},following])
    else:
        for sign in (1,-1):
            y=float(current['y'])+sign*lane
            candidates.append([previous,{'x':float(previous['x']),'y':y},{'x':float(following['x']),'y':y},following])
    for detour in candidates:
        replacement=points[:index-1]+detour+points[index+2:]
        # Remove accidental zero-length points while keeping electrical ends.
        compact=[]
        for p in replacement:
            if not compact or abs(float(p['x'])-float(compact[-1]['x']))>1e-6 or abs(float(p['y'])-float(compact[-1]['y']))>1e-6:compact.append(dict(p))
        section['startPoint']=compact[0];section['bendPoints']=compact[1:-1];section['endPoint']=compact[-1]
        if not _route_hits_shapes(edge,shapes):return True
    section['startPoint']=old[0];section['bendPoints']=old[1:-1];section['endPoint']=old[-1]
    return False

def _shape_bounds(graph):
    return [(float(c.get('x',0)),float(c.get('y',0)),float(c.get('x',0))+float(c.get('width',0)),float(c.get('y',0))+float(c.get('height',0))) for c in graph.get('children',[]) if c.get('width',0)>0 and c.get('height',0)>0]

def _segment_hits_shape(segment,shape,tolerance=1e-6):
    (ax,ay),(bx,by)=segment;x0,y0,x1,y1=shape
    if abs(ay-by)<tolerance:
        return y0+tolerance<ay<y1-tolerance and max(min(ax,bx),x0+tolerance)<min(max(ax,bx),x1-tolerance)
    if abs(ax-bx)<tolerance:
        return x0+tolerance<ax<x1-tolerance and max(min(ay,by),y0+tolerance)<min(max(ay,by),y1-tolerance)
    return True

def _route_hits_shapes(edge,shapes):
    return any(_segment_hits_shape((a,b),shape) for _,_,a,b in _route_segments(edge) for shape in shapes)

def _shift_route_lane(edge,section_index,segment_index,coordinate,shapes,axis):
    sections=edge.get('sections',[])
    if section_index>=len(sections):return False
    section=sections[section_index];points=_route_points(section)
    if segment_index<0 or segment_index+1>=len(points):return False
    a,b=points[segment_index],points[segment_index+1]
    fixed=axis=='y' and abs(float(a['y'])-float(b['y']))<1e-6 or axis=='x' and abs(float(a['x'])-float(b['x']))<1e-6
    if not fixed:return False
    lo=segment_index;hi=segment_index
    while lo>0 and abs(float(points[lo-1][axis])-float(points[lo][axis]))<1e-6:lo-=1
    while hi+2<len(points) and abs(float(points[hi+1][axis])-float(points[hi+2][axis]))<1e-6:hi+=1
    if lo==0 or hi+1==len(points)-1:return False
    old=[dict(p) for p in points]
    for index in range(lo,hi+2):points[index][axis]=float(coordinate)
    section['startPoint']=points[0];section['bendPoints']=points[1:-1];section['endPoint']=points[-1]
    if _route_hits_shapes(edge,shapes):
        section['startPoint']=old[0];section['bendPoints']=old[1:-1];section['endPoint']=old[-1]
        return False
    return True

def _repair_cross_net_overlaps(result):
    """Separate independent lanes and contacts after LibAvoid routing.

    LibAvoid can return coincident segments for different two-terminal edges
    when their ports face a common symbol.  It can also terminate one route
    on the interior of another route's segment.  KiCad treats both geometries
    as one electrical wire even without a junction.  Move only an internal
    lane or corner dogleg to the nearest clear channel, preserving all
    electrical endpoints and net data.
    """
    edges=result.get('edges',[]);shapes=_shape_bounds(result)
    grid=max(float(result.get('grid',1.27)),1.27);lane=max(2.54,grid*2)
    max_x=max((float(result.get('width',0)),)+tuple(x for c in result.get('children',[]) for x in (float(c.get('x',0)),float(c.get('x',0))+float(c.get('width',0)))))
    max_y=max((float(result.get('height',0)),)+tuple(y for c in result.get('children',[]) for y in (float(c.get('y',0)),float(c.get('y',0))+float(c.get('height',0)))))
    for _ in range(max(1,len(edges)*len(edges))):
        conflicts=_cross_net_overlaps(edges)
        if conflicts:
            left,ls,li,lp,right,rs,ri,rp,_=conflicts[0]
            moved=False
            # Prefer the later edge, but use the earlier one if its lane is
            # the only movable route around a common port side.
            for target,section_index,segment_index,points in ((right,rs,ri,rp),(left,ls,li,lp)):
                axis='y' if abs(points[0][1]-points[1][1])<1e-6 else 'x';base=float(points[0][1 if axis=='y' else 0]);limit=max_y if axis=='y' else max_x
                for distance in range(1,80):
                    for sign in (1,-1):
                        candidate=round(base+sign*distance*lane,6)
                        if candidate<0.1 or candidate>limit-0.1:continue
                        saved=copy.deepcopy(target)
                        if not _shift_route_lane(target,section_index,segment_index,candidate,shapes,axis):continue
                        remaining=_cross_net_overlaps(edges)
                        still=any((c[0] is left and c[4] is right or c[0] is right and c[4] is left) and ((c[0] is left and c[1]==ls and c[2]==li) or (c[4] is left and c[5]==ls and c[6]==li)) for c in remaining)
                        if not still:
                            moved=True;break
                        target.clear();target.update(saved)
                    if moved:break
                if moved:break
            if not moved:
                # If a collinear conflict is trapped between two electrical
                # endpoints, move the shared corner itself around a dogleg.
                # This covers a route whose bend was first made coincident by
                # an earlier contact repair.
                common=[]
                for candidate in (*lp,*rp):
                    if _point_on_segment(candidate,lp[0],lp[1]) and _point_on_segment(candidate,rp[0],rp[1]) and candidate not in common:common.append(candidate)
                for point in common:
                    pair_overlap=lambda: any((c[0] is left and c[4] is right or c[0] is right and c[4] is left) for c in _cross_net_overlaps(edges))
                    pair_touch=lambda: any((c[0] is left and c[4] is right or c[0] is right and c[4] is left) and math.dist(c[8],point)<1e-6 for c in _cross_net_contacts(edges))
                    for target,section_index in ((left,ls),(right,rs)):
                        saved=copy.deepcopy(target)
                        if _corner_detour(target,section_index,point,shapes,lane) and not pair_overlap() and not pair_touch():
                            moved=True;break
                        target.clear();target.update(saved)
                    if moved:break
            if not moved:break
            continue

        contacts=_cross_net_contacts(edges)
        if not contacts:break
        left,ls,li,lp,right,rs,ri,rp,point,left_interior,right_interior=contacts[0]
        pair_has_contact=lambda: any(((c[0] is left and c[4] is right) or (c[0] is right and c[4] is left)) and math.dist(c[8],point)<1e-6 for c in _cross_net_contacts(edges))
        moved=False
        for target,section_index,segment_index,segment,intr in ((left,ls,li,lp,left_interior),(right,rs,ri,rp,right_interior)):
            if not intr:continue
            axis='y' if abs(segment[0][1]-segment[1][1])<1e-6 else 'x';base=float(segment[0][1 if axis=='y' else 0]);limit=max_y if axis=='y' else max_x
            for distance in range(1,80):
                for sign in (1,-1):
                    candidate=round(base+sign*distance*lane,6)
                    if candidate<0.1 or candidate>limit-0.1:continue
                    saved=copy.deepcopy(target)
                    if _shift_route_lane(target,section_index,segment_index,candidate,shapes,axis) and not pair_has_contact() and not _cross_net_overlaps(edges):
                        moved=True;break
                    target.clear();target.update(saved)
                if moved:break
            if moved:break
        if not moved:
            for target,section_index in ((left,ls),(right,rs)):
                saved=copy.deepcopy(target)
                if _corner_detour(target,section_index,point,shapes,lane) and not pair_has_contact() and not _cross_net_overlaps(edges):
                    moved=True;break
                target.clear();target.update(saved)
        if not moved:break
    return result

def _grid_route_channels(graph):
    """Prefer editable grid-aligned bends only when electrical geometry stays safe."""
    grid=float(graph.get('grid',1.27))
    quantize=lambda value:round(round(float(value)/grid)*grid,6)
    for edge in graph.get('edges',[]):
        for section in edge.get('sections',[]):
            for point in (section['startPoint'],section['endPoint']):
                if any(abs(quantize(point[axis])-float(point[axis]))>1e-5 for axis in ('x','y')):
                    return graph
    result=copy.deepcopy(graph)
    for edge in result.get('edges',[]):
        for section in edge.get('sections',[]):
            points=[]
            for point in _route_points(section):
                p={axis:quantize(point[axis]) for axis in ('x','y')}
                if not points or p!=points[-1]:points.append(p)
            if len(points)<2:return graph
            section.update(startPoint=points[0],bendPoints=points[1:-1],endPoint=points[-1])
    result=_repair_cross_net_overlaps(result)
    edges=result.get('edges',[])
    if (_cross_net_contacts(edges) or _cross_net_overlaps(edges)
        or any(_route_hits_shapes(edge,_shape_bounds(result)) for edge in edges)):
        return graph
    result['routeGridMm']=grid
    return result


def _fit_routed_graph(graph):
    """Include actual detours in the group envelope using one rigid translation."""
    points=[point for edge in graph.get('edges',[]) for section in edge.get('sections',[])
            for point in [section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]]
    if not points:return graph
    min_x=min([0,*[float(p['x']) for p in points]])
    min_y=min([0,*[float(p['y']) for p in points]])
    grid=float(graph.get('grid',1.27))
    dx=math.ceil(-min_x/grid-1e-7)*grid;dy=math.ceil(-min_y/grid-1e-7)*grid
    for node in graph.get('children',[]):
        node['x']+=dx;node['y']+=dy
    # Ports remain local to their translated node. Sections and junctions are
    # group coordinates and must receive exactly the same translation.
    visited=set()
    for point in [*points,*[p for edge in graph.get('edges',[]) for p in edge.get('junctionPoints',[])]]:
        if id(point) in visited:continue
        visited.add(id(point));point['x']+=dx;point['y']+=dy
    graph['width']=max(float(graph.get('width',0))+dx,max(float(p['x']) for p in points))
    graph['height']=max(float(graph.get('height',0))+dy,max(float(p['y']) for p in points))
    graph['routeEnvelopeTranslation']=[round(dx,4),round(dy,4)]
    return graph


def _wire_boundary_violations(state, size):
    width,height=size
    return [item['id'] for item in state['items'].values() if item['kind']=='wire' and any(
        x<10-.001 or y<10-.001 or x>width-10+.001 or y>height-45+.001
        for x,y in item['points'])]


def elk(graph,out,name,node):
    ip=out/(name+'-input.json');op=out/(name+'-output.json');write(ip,graph)
    p=subprocess.run([node,str(Path(__file__).with_name('pack_generic.cjs')),'--stdio'],input=json.dumps(graph),capture_output=True,text=True,encoding='utf-8',timeout=90)
    if p.returncode: raise ValueError('ELK: '+p.stderr[-2000:])
    result=json.loads(p.stdout);write(op,result)
    if graph.get('layoutOptions',{}).get('elk.algorithm')=='layered' and graph.get('edges'):
        from constraint_placement import compact
        result=compact(result,graph.get("grid",1.27))
        write(ip,result)
        routed=subprocess.run([node,str(Path(__file__).with_name('route_avoid.mjs')),'--stdio'],input=json.dumps(result),capture_output=True,text=True,encoding='utf-8',timeout=90)
        if routed.returncode:raise ValueError('libavoid: '+routed.stderr[-2000:])
        result=json.loads(routed.stdout);result=_repair_cross_net_overlaps(result)
        result=_grid_route_channels(result)
        result=_fit_routed_graph(result);write(op,result)
    return result

def _align_group_origin(origin, placed, specs, pinmap, caption_gap, grid=1.27):
    """Align compatible groups by one rigid translation, never individual pins.

    A measured group box can have a fractional origin because it includes
    text.  Its electrical geometry can nevertheless share a 50 mil lattice.
    Translate that entire group (symbols, wires and labels) to the connection
    grid when all intrinsic pin offsets agree on an axis.  Mixed native
    grids keep their original phase on that axis instead of being distorted.
    """
    locals_by_axis=[[],[]]
    for item in placed.get('children',[]):
        ref=item['id'];low=specs[ref]['_low']
        local=[item['x']-low[0],item['y']-low[1]]
        for key,pin in pinmap.items():
            if key.rsplit('.',1)[0]!=ref:continue
            for axis in (0,1):locals_by_axis[axis].append(local[axis]+pin['pos'][axis])
    aligned=list(origin)
    for axis,values in enumerate(locals_by_axis):
        if not values:continue
        phase=values[0]
        if any(abs((value-phase)/grid-round((value-phase)/grid))>1e-6 for value in values):continue
        offset=caption_gap if axis else 0
        delta=(-(origin[axis]+offset+phase))%grid
        if delta<1e-6 or grid-delta<1e-6:delta=0
        aligned[axis]=round(origin[axis]+delta,4)
    return aligned


def generate(resources,d,out,layout,node):
    layout=normalize_layout(layout,d,resources); write(out/'layout-plan.json',layout)
    from shunt_fields import column_candidates
    field_columns=column_candidates(d,resources,layout['groups'])
    from interface_clusters import column_fields,local_return_nodes
    field_columns |= column_fields(d,resources,layout['groups'])
    requested_paper=layout['paper']
    paper=requested_paper.split('-')[0];size=page_size(requested_paper)
    comps={c['ref']:c for c in d['components']}; parts={}; specs={}; pinmap={}; netof={k:n['name'] for n in d['nets'] for k in n['nodes']}
    named_returns=same_net_terminals(d)
    if any(s.get('drawingRules') for s in resources['symbols'].values()):
        named_returns |= {k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes']}
    feed_nets=interface_feed_nets(_grouping_design(d,resources),resources,layout['groups'])
    local_feed_nodes={k for n in d['nets'] if n['name'] in feed_nets for k in n['nodes']}
    named_returns.difference_update(local_feed_nodes)
    from topology_layout import decoupling_return_nodes
    local_power_returns=decoupling_return_nodes(d,resources,layout['groups'])
    named_returns.difference_update(local_power_returns)
    from driver_inputs import ground_island
    filter_ground_nodes=set().union(*(ground_island(d,resources,g['references']) for g in layout['groups']))
    named_returns.difference_update(filter_ground_nodes)
    named_returns.difference_update(local_return_nodes(d,resources,layout['groups']))
    localfile=out/'native-library-reference.txt'
    base=[instance(c,resources['symbols'][c['librarySymbol']],rotation=layout['rotations'].get(c['ref'],0)) for c in d['components']]
    localfile.write_text(nr.dump(document(resources,base,paper)),encoding='utf8');_,state=read_native(localfile)
    # Choose a placement grid compatible with every intrinsic pin coordinate.
    # Never snap a library pin independently from its symbol.
    quantum=12700
    locally_routed=set(); wired_pins=set()
    for group in layout['groups']:
        for net in d['nets']:
            members=[key for key in net['nodes'] if key.rsplit('.',1)[0] in group['references'] and key not in named_returns]
            if len(members)>1:
                locally_routed.update(key.rsplit('.',1)[0] for key in members);wired_pins.update(members)
    for component in d['components']:
        if component['ref'] not in locally_routed:continue
        for pin in state['symbols'][component['librarySymbol']]['pins']:
            for coordinate in pin['at'][:2]:quantum=math.gcd(quantum,abs(round(coordinate*10000)))
    step=quantum/10000 if quantum else 1.27
    snap=lambda value:round(round(float(value)/step)*step,4)
    # ELK/libavoid may place independent orthogonal channels less than one
    # coarse symbol-grid step apart.  Keep one shared, finer grid for routed
    # bends *and* the non-block symbol anchors so a bend cannot collapse into
    # a neighbouring net while its endpoints remain electrically disconnected.
    # The block motifs retain their native coordinates and are handled below.
    route_step=min(step,0.254)
    route_snap=lambda value:round(round(float(value)/route_step)*route_step,4)
    # Include real pin extents and reserved fields/labels in each ELK obstacle.
    for c,raw in zip(d['components'],base):
        item=next(v for v in state['items'].values() if v.get('reference')==c['ref']);sym=state['symbols'][item['symbol']];ref=c['ref']
        b=geom.part_bounds(item,sym,False);props=children(raw,'property');shown=[p for p in props if visible(p) and p[2]]
        # Standard installed-library R/C symbols have no explicit geometry
        # contract and may use the compact two-field treatment.  Evidence
        # symbols with a specified resistor/capacitor kind retain their
        # established field placement: local receiver/driver motifs already
        # know that geometry and the visible fields are part of that contract.
        component_kind=_kind(c,resources)
        passive=len(c.get('pins',[]))==2 and component_kind in ('resistor','capacitor')
        if passive:
            # The body/pin bounds are already in the effective symbol
            # orientation.  Use the short axis to decide whether fields can
            # sit above/below a horizontal part or beside a vertical one.
            field_boxes=_compact_passive_fields(
                raw,
                shown,
                b,
                (b[2]-b[0]) >= (b[3]-b[1]),
                layout['rotations'].get(ref,0),
                column_text=ref in field_columns,
            )
        else:
            # Put fields to the right, below horizontal pins; vertical exits remain clear.
            fy=b[3]+5.08;fx=b[2]+2.54
            if len(sym['pins'])==2 and abs(b[3]-b[1])>abs(b[2]-b[0]):fy=-1.27
            field_boxes=[]
            for j,p in enumerate(shown):
                angle=layout['rotations'].get(ref,0)
                replace(p,'at',at(fx,fy+j*2.54,angle%180))
                justify=('right','top') if angle in (90,180) else ('left','bottom')
                eff=child(p,'effects');replace(eff,'justify',form('justify',*(A(v) for v in justify)))
                width=max(1.8,len(str(p[2]))*1.15);height=1.8
                # The property anchor is the rendered baseline, not the full
                # glyph envelope.  Reserve a small downward margin so an
                # orthogonal rail cannot legally finish on the baseline and
                # still cross the visible descender in the PDF.
                glyph_margin=0.4
                field_boxes.append([
                    fx,
                    fy+j*2.54-height-glyph_margin,
                    fx+width,
                    fy+j*2.54+glyph_margin,
                ])
        # Keep the actual symbol/field envelope separately from the generous
        # port/label reserve used by the general ELK graph.  Topology motifs
        # can then align a branch to its source pin and spread only when the
        # visible body or fields would collide; using ``_low`` here would
        # make every branch inherit a full terminal-label reserve.
        content_low=[float(b[0]),float(b[1])]
        content_high=[float(b[2]),float(b[3])]
        for box in field_boxes:
            content_low[0]=min(content_low[0],float(box[0]));content_low[1]=min(content_low[1],float(box[1]))
            content_high[0]=max(content_high[0],float(box[2]));content_high[1]=max(content_high[1],float(box[3]))
        low=[min(b[0]-2.54,-2.54),b[1]-2.54];high=[max(b[2]+2.54,2.54),max(b[3]+2.54,2.54)]
        for box in field_boxes:
            low[0]=min(low[0],box[0]);low[1]=min(low[1],box[1]);high[0]=max(high[0],box[2]);high[1]=max(high[1],box[3])
        ports=[]
        for pin in sym['pins']:
            key=ref+'.'+pin['number'];pos=list(geom.world(item,pin['at']));angle=math.radians(pin['at'][2]+layout['rotations'].get(ref,0));direction=[-round(math.cos(angle)),round(math.sin(angle))]
            # Reserve a complete outward label inside the node for every terminal.
            textlen=3.81 if key in wired_pins else label_reserve(netof.get(key,''))
            if ref in field_columns and direction[1] and key not in wired_pins:
                # Vertical column labels grow sideways at an outward stub;
                # they do not need the horizontal wire-plus-label allowance.
                # Keep the complete text width and a glyph margin instead.
                textlen=max(3.81,len(netof.get(key,''))*1.15+1.27)
            if direction[0]<0:low[0]=min(low[0],pos[0]-textlen)
            if direction[0]>0:high[0]=max(high[0],pos[0]+textlen)
            if direction[1]<0:low[1]=min(low[1],pos[1]-(3.81 if key in wired_pins else 10.16));high[0]=max(high[0],pos[0]+textlen)
            if direction[1]>0:high[1]=max(high[1],pos[1]+(3.81 if key in wired_pins else 10.16));high[0]=max(high[0],pos[0]+textlen)
            pinmap[key]={'pos':pos,'direction':direction}
        low=[math.floor(v/step)*step for v in low];high=[math.ceil(v/step)*step for v in high]
        for pin in sym['pins']:
            key=ref+'.'+pin['number'];p=pinmap[key];dx,dy=p['direction'];x,y=p['pos'];endpoint=[low[0] if dx<0 else high[0] if dx>0 else x,low[1] if dy<0 else high[1] if dy>0 else y];p['port']=endpoint
            side='WEST' if dx<0 else 'EAST' if dx>0 else 'NORTH' if dy<0 else 'SOUTH'
            ports.append({'id':key,'x':endpoint[0]-low[0],'y':endpoint[1]-low[1],'width':0,'height':0,'layoutOptions':{'elk.port.side':side}})
        reservations=[{'name':p[1],'text':p[2],'at':[float(v) for v in child(p,'at')[1:]],'justify':copy.deepcopy(child(child(p,'effects'),'justify')),'box':box} for p,box in zip(shown,field_boxes)]
        parts[ref]=raw;specs[ref]={'id':ref,'width':high[0]-low[0],'height':high[1]-low[1],'ports':ports,'layoutOptions':{'elk.portConstraints':'FIXED_POS'},'_low':low,'_body_bounds':list(b),'_content_low':content_low,'_content_high':content_high,'_field_reservations':reservations}
    from driver_inputs import ground_island
    from topology_layout import place_driver
    groups=[];required=[];reused=set()
    for index,g in enumerate(layout['groups']):
        refs=set(g['references']);edges=[]
        block=next((b for b in resources.get('blocks',[]) if set(b['bindings'].values())==refs),None)
        if block:
            if any(layout['rotations'].get(r,0) for r in refs):raise ValueError('Native design block owns its internal rotations; omit per-component rotation')
            bast=nr.parse(block['native']);ox,oy=block['origin'];placed={'id':g['id'],'width':block['width'],'height':block['height'],'children':[],'edges':[],'nativeExtras':[]}
            for raw in children(bast,'symbol'):
                raw[:]=[v for v in raw if not (isinstance(v,list) and v[0]=='property' and v[1] in ('ki_keywords','ki_fp_filters'))]
                ps={p[1]:p for p in children(raw,'property')};oldref=ps['Reference'][2];ref=block['bindings'][oldref];c=comps[ref];pa=child(raw,'at');x,y,angle=map(float,pa[1:]);reused.add(ref)
                for key,value in [('Reference',ref),('DesignId',c['id'])]:ps[key][2]=value
                for p in ps.values():
                    ppos=child(p,'at');ppos[1]=number(float(ppos[1])-x);ppos[2]=number(float(ppos[2])-y)
                raw[:]=[v for v in raw if not isinstance(v,list) or v[0]!='instances'];replace(raw,'uuid',form('uuid',uid()))
                parts[ref]=raw;specs[ref]['_low']=[0,0];layout['rotations'][ref]=angle
                placed['children'].append({'id':ref,'x':x-ox,'y':y-oy})
                sym=state['symbols'][c['librarySymbol']]
                for pin in sym['pins']:
                    key=ref+'.'+pin['number'];pinmap[key]['pos']=list(geom.world({'at':[0,0,angle]},pin['at']))
            for raw in bast:
                if isinstance(raw,list) and raw[0] in ('wire','junction','label','no_connect'):
                    if raw[0]=='label':raw[1]=block['netBindings'][raw[1]]
                    replace(raw,'uuid',form('uuid',uid()));placed['nativeExtras'].append(raw)
            placed['blockOrigin']=[ox,oy];groups.append((g,placed));continue
        # Explicit same-net links are individual fitted parts, not a bus diagram.
        # Stack them in the requested order with named stubs on both ends.
        if all(len(comps[r]['pins'])==2 and all(r+'.'+p['number'] in named_returns for p in comps[r]['pins']) for r in refs):
            placed={'id':g['id'],'children':[],'edges':[]};row_y=10.16;max_width=0
            for ref in g['references']:
                spec=specs[ref]
                keys=[ref+'.'+p['number'] for p in comps[ref]['pins']]
                points=[pinmap[k]['pos'] for k in keys]
                if all(pinmap[k]['direction'][1]==0 for k in keys) and abs(points[0][1]-points[1][1])<.001:
                    left=min(p[0] for p in points);right=max(p[0] for p in points);y=points[0][1]
                    shown=[p for p in children(parts[ref],'property') if visible(p) and p[2]]
                    end=right+2.54
                    for j,prop in enumerate(shown):
                        x=left if j==0 else end
                        replace(prop,'at',at(x,y-2.54,layout['rotations'].get(ref,0)%180))
                        replace(child(prop,'effects'),'justify',form('justify',*(A(v) for v in (('right','top') if layout['rotations'].get(ref,0) in (90,180) else ('left','bottom')))))
                        if j:end+=len(prop[2])*1.15+2.54
                    spec['_low']=[min(spec['_low'][0],left-7.62),y-5.08]
                    spec['width']=max(right+7.62,end)-spec['_low'][0]
                    spec['height']=7.62
                placed['children'].append({'id':ref,'x':5.08,'y':row_y})
                row_y+=spec['height']+layout['gapMm'];max_width=max(max_width,spec['width'])
            placed.update(width=max_width+10.16,height=row_y+5.08)
            groups.append((g,placed));continue
        island=ground_island(d,resources,g['references'])
        for n in d['nets']:
            members=[k for k in n['nodes'] if k.rsplit('.',1)[0] in refs and k not in named_returns]
            if len(members)>1:
                for subset in ([k for k in members if k in island],[k for k in members if k not in island]):
                    if len(subset)>1:required.append(subset)
                # Rooted trunk/tap tree is a presentation graph; frozen
                # hypernets stay immutable and serialized node order cannot
                # force a long chain around the page.
                edges.extend(_presentation_tree_edges(members,d,netof))
        from interface_layout import place as place_interface
        interface=place_interface(g,d,resources,specs,pinmap,layout['gapMm'])
        if interface is not None:
            groups.append((g,interface));continue
        from receiver_layout import place as place_receiver
        receiver=place_receiver(g,d,resources,specs,pinmap,layout['gapMm'],parts)
        if receiver is not None:
            if not receiver.get('localReturns'):
                named_returns.difference_update(k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes'] if k.rsplit('.',1)[0] in refs)
            groups.append((g,receiver));continue
        from input_rc_layout import place as place_input_rc
        input_rc=place_input_rc(g,d,resources,specs,pinmap,layout['gapMm'])
        if input_rc is not None:
            groups.append((g,input_rc));continue
        from shunt_layout import place as place_shunts
        shunts=place_shunts(g,d,resources,specs,pinmap,layout['gapMm'])
        if shunts is not None:
            groups.append((g,shunts));continue
        from series_pair import place as place_series_pair
        series = place_series_pair(g,d,specs,pinmap,layout['gapMm'],resources)
        if series is not None:
            groups.append((g,series));continue
        # Mixed driver groups (output series parts plus input shunts) are
        # placed from topology before the general ELK fallback.  A display or
        # other active endpoint should normally be inferred as a separate
        # visual group; explicit mixed groups remain on the conservative path.
        topology=place_driver(g,d,resources,specs,pinmap,layout['gapMm'],parts)
        if topology is not None:
            groups.append((g,topology));continue
        # A hub with independent two-terminal series branches can use its pin rows
        # directly. Derive the pattern from topology, never reference/net names.
        hubs=[r for r in refs if len(comps[r]['pins'])>2]
        bank=[]
        sinks=[r for r in hubs if all(p['type']=='passive' for p in comps[r]['pins'])]
        drivers=[r for r in hubs if sum(p['type']=='output' for p in comps[r]['pins'])>=3]
        sink=sinks[0] if len(hubs)==2 and len(sinks)==1 and len(drivers)==1 else None
        if (len(hubs)==1 or sink) and len(refs)>=4:
            hub=drivers[0] if sink else hubs[0]
            for r in refs-set(hubs):
                if len(comps[r]['pins'])!=2:break
                pairs=[(a,b) for net in d['nets'] for a in net['nodes'] if a.startswith(hub+'.') for b in net['nodes'] if b.startswith(r+'.')]
                if len(pairs)!=1:
                    if not sink:continue
                    break
                hp,rp=pairs[0]
                direction=pinmap[hp]['direction']
                if direction not in ([1,0],[-1,0]) or pinmap[rp]['direction']!=[-direction[0],0]:
                    if not sink:continue
                    break
                if sink and direction!=[1,0]:break
                bank.append((r,hp,rp))
            else:
                if sink and len(bank)==len(refs)-len(hubs):
                    offsets=[];valid=True
                    for r,hp,rp in bank:
                        other=next(r+'.'+p['number'] for p in comps[r]['pins'] if r+'.'+p['number']!=rp)
                        targets=[k for net in d['nets'] if other in net['nodes'] for k in net['nodes'] if k.startswith(sink+'.')]
                        if len(targets)!=1 or pinmap[targets[0]]['direction']!=[-1,0]:valid=False;break
                        offsets.append(pinmap[hp]['pos'][1]-pinmap[rp]['pos'][1]+pinmap[other]['pos'][1]-pinmap[targets[0]]['pos'][1])
                    if valid and offsets and max(offsets)-min(offsets)<=.001:
                        for net in d['nets']:
                            for a in [k for k in net['nodes'] if k.startswith(hub+'.')]:
                                for b in [k for k in net['nodes'] if k.startswith(sink+'.')]:
                                    if pinmap[a]['direction']!=[1,0] or pinmap[b]['direction']!=[-1,0] or abs(pinmap[a]['pos'][1]-pinmap[b]['pos'][1]-offsets[0])>.001:valid=False
                    else:valid=False
                    if not valid:bank=[]
                if len(bank)==len(refs)-len(hubs) or not sink and len(bank)>=3:
                    bank_refs=set(hubs)|{r for r,_,_ in bank}
                    # Fields sit above/below the resistor, freeing the row below.
                    places={hub:[0,0]};segments=[]
                    for r,hp,rp in bank:
                        px,py=pinmap[hp]['pos'];rx,ry=pinmap[rp]['pos']
                        side=pinmap[hp]['direction'][0]
                        places[r]=[px+side*17.78-rx,py-ry]
                        raw=parts[r];shown=[p for p in children(raw,'property') if visible(p) and p[2]]
                        for j,prop in enumerate(shown):
                            # Explicit left anchors leave a readable gap between
                            # reference and value instead of centering two fields
                            # whose widths can overlap (e.g. R2 and 47R/0805).
                            label_x=-5.08 if j==0 else -5.08+len(shown[0][2])*1.15+2.54
                            replace(prop,'at',at(label_x,-2.54,layout['rotations'].get(r,0)%180))
                            eff=child(prop,'effects');replace(eff,'justify',form('justify',*(A(v) for v in (('right','top') if layout['rotations'].get(r,0) in (90,180) else ('left','bottom')))))
                        specs[r]['_low']=[-7.62,-2.54];specs[r]['width']=30.48;specs[r]['height']=5.08
                        segments.append(([px,py],[px+side*17.78,py]))
                    if sink:
                        sinkpaths=[];valid=True
                        for r,hp,rp in bank:
                            other=next(r+'.'+p['number'] for p in comps[r]['pins'] if r+'.'+p['number']!=rp)
                            pairs=[k for net in d['nets'] if other in net['nodes'] for k in net['nodes'] if k.startswith(sink+'.')]
                            if len(pairs)!=1 or pinmap[pairs[0]]['direction']!=[-1,0]:valid=False;break
                            sinkpaths.append((other,pairs[0]))
                        offsets=[places[a.split('.')[0]][1]+pinmap[a]['pos'][1]-pinmap[b]['pos'][1] for a,b in sinkpaths]
                        if not valid or not offsets or max(offsets)-min(offsets)>.001:raise ValueError('Series bank sink pin rows must align; revise functional pin presentation')
                        sx=max(places[a.split('.')[0]][0]+pinmap[a]['pos'][0]-pinmap[b]['pos'][0]+17.78 for a,b in sinkpaths);sy=offsets[0];places[sink]=[sx,sy]
                        for a,b in sinkpaths:
                            px,py=pinmap[a]['pos'];rx,ry=places[a.split('.')[0]];qx,qy=pinmap[b]['pos'];segments.append(([px+rx,py+ry],[qx+sx,qy+sy]))
                        for net in d['nets']:
                            aa=[k for k in net['nodes'] if k.startswith(hub+'.')];bb=[k for k in net['nodes'] if k.startswith(sink+'.')]
                            for a in aa:
                                for b in bb:
                                    px,py=pinmap[a]['pos'];qx,qy=pinmap[b]['pos']
                                    if abs(py-qy-sy)>.001:raise ValueError('Direct bank rows must align')
                                    segments.append(([px,py],[qx+sx,qy+sy]))
                    lowx=min(places[r][0]+specs[r]['_low'][0] for r in bank_refs)-5.08
                    lowy=min(places[r][1]+specs[r]['_low'][1] for r in bank_refs)-10.16
                    highx=max(places[r][0]+specs[r]['_low'][0]+specs[r]['width'] for r in bank_refs)+5.08
                    highy=max(places[r][1]+specs[r]['_low'][1]+specs[r]['height'] for r in bank_refs)+5.08
                    placed={'id':g['id'],'width':highx-lowx,'height':highy-lowy,
                        'children':[{'id':r,'x':places[r][0]+specs[r]['_low'][0]-lowx,'y':places[r][1]+specs[r]['_low'][1]-lowy} for r in bank_refs],
                        'edges':[{'sections':[{'startPoint':{'x':a[0]-lowx,'y':a[1]-lowy},'endPoint':{'x':b[0]-lowx,'y':b[1]-lowy}}]} for a,b in segments]}
                    if bank_refs!=refs:
                        from driver_decoupling import surround as decoupling
                        from driver_inputs import surround as input_shunts
                        from standard_hub import surround as standard_hub
                        integrated=standard_hub(placed,g['references'],d,resources,specs,pinmap,layout['gapMm'],parts)
                        if integrated is None:
                            integrated=input_shunts(placed,g['references'],d,resources,specs,pinmap,layout['gapMm'],parts)
                            if integrated is None:integrated=decoupling(placed,g['references'],d,resources,specs,pinmap,layout['gapMm'],parts)
                            if integrated is not None:
                                named_returns.difference_update(k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes'] if k.rsplit('.',1)[0] in refs)
                        if integrated is not None:placed=integrated
                        else:
                            from series_surround import surround
                            placed=surround(placed,g['references'],specs,pinmap,edges,layout['gapMm'],lambda graph:elk(graph,out,'group-'+str(index)+'-surround',node))
                    groups.append((g,placed));continue
        # Generic routing uses local ground labels; already resolved local motifs
        # retain their intentional short ground rails.
        grounds={k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes'] if k.rsplit('.',1)[0] in refs}
        if any(resources['symbols'][comps[r]['librarySymbol']].get('drawingRules') for r in refs):
            # Shared supply rails connect functional blocks by name. Routing a
            # long supply loop through a signal block obscures the signal path.
            for net in d['nets']:
                owners={k.rsplit('.',1)[0] for k in net['nodes']}
                if net['name'] in d.get('supplied_nets',[]) and owners-refs:
                    grounds.update(k for k in net['nodes'] if k.rsplit('.',1)[0] in refs)
        grounds.difference_update(local_feed_nodes)
        edges=[e for e in edges if not grounds.intersection(e['sources']+e['targets'])]
        required=[nodes for nodes in required if not set(nodes)<=grounds]
        named_returns.update(grounds)
        graph={'id':g['id'],'grid':step,'layoutOptions':{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':str(layout['gapMm']),'elk.layered.spacing.nodeNodeBetweenLayers':str(layer_spacing(layout['gapMm'])),'elk.padding':'[top=10,left=5,bottom=5,right=5]'},'children':[{k:v for k,v in specs[r].items() if not k.startswith('_')} for r in g['references']],'edges':edges}
        # ELK defaults use pixel-sized gaps; our graph units are millimetres.
        # Explicit clearances also bound self loops on same-net jumper pins.
        graph['layoutOptions'].update({'elk.spacing.componentComponent':str(layout['gapMm']), 'elk.spacing.edgeNode':'2.54', 'elk.spacing.edgeEdge':'2.54', 'elk.spacing.portPort':'2.54', 'elk.layered.spacing.edgeNodeBetweenLayers':'2.54', 'elk.layered.spacing.edgeEdgeBetweenLayers':'2.54', 'elk.spacing.nodeSelfLoop':'3.81'})
        if not edges:
            graph['layoutOptions']={'elk.algorithm':'box','elk.box.packingMode':'SIMPLE','elk.aspectRatio':'2.5','elk.spacing.nodeNode':str(layout['gapMm']),'elk.padding':'[top=10,left=5,bottom=5,right=5]'}
        placed=elk(graph,out,'group-'+str(index),node);groups.append((g,placed))
    write(out/'layout-search.json', {'scope':'Local routed candidates, before page packing and native verification',
        'groups':[{'id':g['id'], **placed['placementSearch']} for g,placed in groups if placed.get('placementSearch')],
        'interfaceClusters':[{'id':g['id'],**placed['interfaceCluster']} for g,placed in groups if placed.get('interfaceCluster')]})
    # Keep active functional circuits above display/link/process groups when
    # they fit on one row.  This is a semantic preference, not a saved page
    # coordinate; the adaptive packer below may relax it when a generated
    # group is wider than the current sheet.
    row_breaks=[]
    if resources.get('mockEvidence'):
        active=[any(sum(p['type']=='output' for p in comps[r]['pins'])>=3 or resources['symbols'][comps[r]['librarySymbol']].get('appearance',{}).get('kind') in ('specified-receiver','infrared-receiver') for r in g['references']) for g,_ in groups]
        if len(active)>2 and active[:2]==[True,True] and not any(active[2:]):row_breaks=[2]
    # Reserve a shallow caption lane above every generated group.  It keeps
    # the automatic page title out of the first wire channel and makes row
    # packing account for that lane instead of placing it in a gap by chance.
    caption_gap=6.35
    boxes=[{'id':g['id'],'width':p['width'],'height':p['height']+caption_gap} for g,p in groups]
    connections=signal_affinities(d,layout['groups'])
    packed=None;selected_paper=None
    # Measure the actual generated groups against the reserved drawing area.
    # A requested A3 page is not a promise that an arbitrary set of symbols
    # will fit on that sheet.  Promote to the next landscape size only after
    # trying the preferred semantic row boundary and then its relaxed form.
    available_pages=page_candidates(requested_paper) if layout.get('allowPaperPromotion',True) else [requested_paper]
    for candidate in available_pages:
        candidate_size=page_size(candidate)
        # Reserve one connection-grid step for the later rigid group shift.
        usable_w,usable_h=candidate_size[0]-21.27,candidate_size[1]-56.27
        alternative=pack_groups(groups,usable_w,usable_h,layout['gapMm'],row_breaks,caption_gap,connections)
        if alternative is None and row_breaks:
            # Active groups may themselves be too wide for one row.  Keeping
            # them contiguous in the model is still honored by the electrical
            # graph; only the page-level row preference is relaxed.
            alternative=pack_groups(groups,usable_w,usable_h,layout['gapMm'],top_margin=caption_gap,connections=connections)
        if alternative is not None and alternative['width']<=usable_w and alternative['height']<=usable_h:
            packed=alternative;selected_paper=candidate;size=candidate_size;break
    if packed is None:
        # Preserve the old actionable diagnostic, but report measured bounds
        # from the largest supported sheet so the user can distinguish a
        # malformed graph from a genuinely oversized presentation.
        largest=page_size(available_pages[-1]);uw,uh=largest[0]-20,largest[1]-55
        measured=pack_groups(groups,uw,uh,layout['gapMm'],top_margin=caption_gap)
        if measured is None:
            measured={'width':max((p['width'] for _,p in groups),default=0),'height':sum((p['height'] for _,p in groups),0)}
        raise ValueError(f'Layout needs {measured["width"]:.1f} x {measured["height"]:.1f} mm; enlarge the page or revise visual groups')
    # Record the selected sheet after solving measured groups and their signal
    # relationships. Input array order does not force an unnecessarily large page.
    if selected_paper!=requested_paper:
        layout={**layout,'paper':selected_paper,'autoPaperPromotion':{'requested':requested_paper,'selected':selected_paper}}
        paper=selected_paper.split('-')[0]
        write(out/'layout-plan.json',layout)
    page_graph={'id':'page','layoutOptions':{'elk.algorithm':'box','elk.box.packingMode':'SIMPLE','elk.aspectRatio':str((size[0]-20)/(size[1]-55)),'elk.spacing.nodeNode':str(layout['gapMm']),'elk.padding':'[top=0,left=0,bottom=0,right=0]'},'children':boxes}
    # Keep the page-level ELK record for diagnostics; the deterministic
    # pack_groups result above is authoritative for final origins.
    elk(page_graph,out,'page',node)
    origins={g['id']:[10+g['x'],15+g['y']] for g in packed['children']}; extras=[];routes=[];routed_by_net=collections.defaultdict(list);positions={};rootid=uid();label_overrides={}
    for group,placed in groups:
        origins[group['id']]=_align_group_origin(origins[group['id']],placed,specs,pinmap,caption_gap)
    write(out/'page-placement.json',{**packed,'alignedOrigins':origins,'connectionGridMm':1.27})
    for g,placed in groups:
        gx,gy=origins[g['id']]
        content_gy=gy+caption_gap
        for item in placed.get('netLabels',[]):
            # Motif wires are emitted on the fine route grid below.  Use that
            # same grid for their explicit label anchors; the coarser symbol
            # placement grid can otherwise leave a visible .254 mm gap and
            # KiCad reports the label as dangling.
            label_overrides[g['id'],item['net']]=([route_snap(gx+item['pos'][0]),route_snap(content_gy+item['pos'][1])],item['direction'])
        # The caption occupies the reserved lane above the generated bounds.
        extras.append(form('text',g['title'],at(gx+2,gy+3.81,0),form('effects',form('font',form('size',number(1.5),number(1.5))),form('justify',A('left'),A('bottom'))),form('uuid',uid())))
        for n in placed['children']:
            ref=n['id'];raw=parts[ref];low=specs[ref]['_low'];tx=gx+n['x']-low[0];ty=content_gy+n['y']-low[1];positions[ref]=[tx,ty]
            anchor_x=tx if ref in reused else route_snap(tx)
            anchor_y=ty if ref in reused else route_snap(ty)
            positions[ref]=[anchor_x,anchor_y]
            replace(raw,'at',at(anchor_x,anchor_y,layout['rotations'].get(ref,0)))
            for p in children(raw,'property'):
                pa=child(p,'at');pa[1]=number(float(pa[1])+anchor_x);pa[2]=number(float(pa[2])+anchor_y)
            raw.append(form('instances',form('project','Circuit',form('path','/'+rootid,form('reference',ref),form('unit',A('1'))))))
        for edge in placed.get('edges',[]):
            for section in edge.get('sections',[]):
                points=[section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]
                route=[[route_snap(gx+p['x']),route_snap(content_gy+p['y'])] for p in points]
                segments=list(zip(route,route[1:]));routes.extend(segments)
                if edge.get('net'):
                    routed_by_net[edge['net']].extend(segments)
        for raw in placed.get('nativeExtras',[]):
            ox,oy=placed['blockOrigin']
            if raw[0]=='wire':
                pts=children(child(raw,'pts'),'xy');routes.extend(([round(float(a[1])-ox+gx,4),round(float(a[2])-oy+content_gy,4)],[round(float(b[1])-ox+gx,4),round(float(b[2])-oy+content_gy,4)]) for a,b in zip(pts,pts[1:]))
            else:
                p=child(raw,'at');p[1]=number(float(p[1])-ox+gx);p[2]=number(float(p[2])-oy+content_gy);extras.append(raw)
    routed_endpoints={tuple(v) for route in routes for v in route}
    from driver_inputs import ground_island
    filter_returns=set().union(*(ground_island(d,resources,g['references']) for g in layout['groups']))
    finalpins={};labelled=set();groupof={r:g['id'] for g in layout['groups'] for r in g['references']}
    # Add every terminal lead before choosing any label anchor.  In particular,
    # a generated bank may expose a route through several untagged ELK edges;
    # choosing a label while only the first pin's lead is present can mistake a
    # pin endpoint for the only safe annotation channel.
    label_context=[]
    pin_positions={};open_label_ends={}
    lead_body_boxes=[]
    for ref,position in positions.items():
        item=next((v for v in state['items'].values() if v.get('reference')==ref),None)
        if item is None:continue
        symbol=state['symbols'][item['symbol']]
        angle=layout['rotations'].get(ref,0)
        body=geom.body_bounds({'at':[0,0,angle]},symbol)
        if body:
            lead_body_boxes.append((ref,[round(body[0]+position[0],4),round(body[1]+position[1],4),round(body[2]+position[0],4),round(body[3]+position[1],4)]))
    for key,p in pinmap.items():
        ref=key.rsplit('.',1)[0];tx,ty=positions[ref];pos=[round(p['pos'][0]+tx,4),round(p['pos'][1]+ty,4)];end=[route_snap(p['port'][0]+tx),route_snap(p['port'][1]+ty)];finalpins[key]=pos;pin_positions[key]=tuple(pos)
        if ref in reused:
            finalpins[key]=[round(p['pos'][0]+tx,4),round(p['pos'][1]+ty,4)]
            continue
        if key in d['nc']:
            extras.append(form('no_connect',at(*pos),form('uuid',uid())));continue
        dx,dy=p['direction'];lp=_safe_terminal_lead(pos,p['direction'],ref,lead_body_boxes,7.62 if dy else 3.81,reserved_end=end)
        # A terminal without a local route stops at its label, never at an open tail.
        if tuple(pos) not in routed_endpoints:
            if tuple(end) not in routed_endpoints:
                end=lp;open_label_ends[key]=tuple(end)
            routes.append((pos,end));routed_endpoints.update((tuple(pos),tuple(end)));routed_by_net[netof[key]].append((pos,end))
        marker=(groupof[ref],netof[key],key if key in named_returns else 'input-filter-ground' if key in filter_returns else '')
        label_context.append((key,p,pos,marker))

    # Recover the net ownership of custom motif edges from their actual
    # connectivity.  Some motif builders intentionally return plain ELK edges
    # without a net field; walking the materialized route graph still gives us
    # a safe same-net channel for labels without consulting project-specific
    # coordinates or names.
    route_segments=split_wire_vertices(routes)
    route_adj=collections.defaultdict(list)
    for a,b in route_segments:
        route_adj[a].append((b,(a,b)));route_adj[b].append((a,(a,b)))
    for net in {netof.get(k) for k in pin_positions if netof.get(k)}:
        starts=[pin_positions[k] for k,n in netof.items() if n==net and k in pin_positions and pin_positions[k] in route_adj]
        seen=set(starts);queue=collections.deque(starts);owned=[]
        while queue:
            point=queue.popleft()
            for other,segment in route_adj[point]:
                owned.append(segment)
                if other not in seen:seen.add(other);queue.append(other)
        routed_by_net[net]=list({tuple(sorted((tuple(a),tuple(b)))) for a,b in owned})

    # Label placement happens after every component has an absolute origin.
    # Keep the actual symbol bodies as obstacles here as well as in the ELK
    # graph.  The latter only protects routes; a label can still be emitted
    # over a body when it is attached to a perfectly valid same-net segment.
    body_boxes=[];pin_number_boxes=[]
    for ref,position in positions.items():
        item=next((v for v in state['items'].values() if v.get('reference')==ref),None)
        if item is None:continue
        symbol=state['symbols'][item['symbol']]
        angle=layout['rotations'].get(ref,0)
        pin_number_boxes.extend(_pin_number_boxes(symbol,position,angle))
        body=geom.body_bounds({'at':[0,0,angle]},symbol)
        if body:
            body_boxes.append((ref,[round(body[0]+position[0],4),round(body[1]+position[1],4),round(body[2]+position[0],4),round(body[3]+position[1],4)]))
    field_obstacles=[]
    for ref,raw in parts.items():
        for saved in specs[ref].get('_field_reservations',[]):
            prop=next((p for p in children(raw,'property') if p[1]==saved['name']),None)
            if prop is None or not visible(prop) or prop[2]!=saved['text']:continue
            pa=[float(v) for v in child(prop,'at')[1:]]
            # Reuse measured field envelopes only while their text orientation
            # is unchanged. Translation follows the actual final property,
            # including local motif adjustments and the page placement.
            if pa[2]!=saved['at'][2] or child(child(prop,'effects'),'justify')!=saved['justify']:continue
            dx,dy=pa[0]-saved['at'][0],pa[1]-saved['at'][1]
            box=saved['box'];field_obstacles.append([box[0]+dx,box[1]+dy,box[2]+dx,box[3]+dy])
    placed_label_boxes=[]

    def label_box(candidate,direction,text,label_angle=None):
        # Match the conservative field envelope used for native one-mm
        # lettering. Narrow average-glyph estimates miss wide uppercase net
        # names (e.g. a four-character label beside a 3.81-mm route bend).
        width=max(1.8,len(text)*1.15);height=1.1
        vertical=(label_angle is not None and int(round(label_angle))%180==90) or (label_angle is None and not direction[0])
        if vertical:
            # A one-millimetre font renders a vertical label as a narrow
            # column whose long edge grows away from its anchor.  KiCad uses
            # the opposite growth direction for 270-degree text.
            extent=max(2.54,len(text)*1.15)
            if label_angle is not None and int(round(label_angle))%360==270:
                return (candidate[0]-.55,candidate[1]-extent,candidate[0]+.55,candidate[1]+.05)
            if label_angle is None and direction[1]<0:
                return (candidate[0]-.55,candidate[1]-extent,candidate[0]+.55,candidate[1]+.12)
            return (candidate[0]-.55,candidate[1]-.05,candidate[0]+.55,candidate[1]+extent)
        if direction[0]<0:return (candidate[0]-width,candidate[1]-height,candidate[0]-.02,candidate[1]-.02)
        return (candidate[0]+.02,candidate[1]-height,candidate[0]+width,candidate[1]-.02)

    def box_overlaps(a,b,margin=.05):
        return min(a[2],b[2])-max(a[0],b[0])>margin and min(a[3],b[3])-max(a[1],b[1])>margin

    def label_route_clear(candidate,direction,text,net,anchor_segment=None,label_angle=None):
        """Reject a label box that another route would visibly cross.

        The PDF checker uses the actual rendered text.  This conservative
        millimetre envelope mirrors its one millimetre font and keeps the
        candidate search independent of a particular page size or symbol set.
        """
        box=label_box(candidate,direction,text,label_angle)
        def crosses(a,b):
            # Axis-aligned route/text intersection.  The supporting wire may
            # leave an endpoint in the opposite direction, which is safe by
            # construction; all other segments must miss the text envelope.
            if anchor_segment is not None and tuple(sorted((tuple(a),tuple(b))))==tuple(sorted((tuple(anchor_segment[0]),tuple(anchor_segment[1])))):return False
            if a[0]==b[0]:return box[0]<a[0]<box[2] and max(box[1],min(a[1],b[1]))<min(box[3],max(a[1],b[1]))
            return box[1]<a[1]<box[3] and max(box[0],min(a[0],b[0]))<min(box[2],max(a[0],b[0]))
        if any(crosses(a,b) for a,b in routes):return False
        if any(box_overlaps(box,other) for _,other in body_boxes):return False
        if any(box_overlaps(box,other) for other in field_obstacles):return False
        if any(box_overlaps(box,other) for other in pin_number_boxes):return False
        return not any(box_overlaps(box,other) for other in placed_label_boxes)

    physical_islands=route_islands(routes)
    # Signal terminals have fewer free annotation directions than filter
    # returns. Reserve their label lanes first, then fit return labels around
    # those real occupied boxes without changing any electrical anchor.
    for key,p,pos,marker in sorted(label_context,key=lambda row:row[0] in filter_returns):
        if key not in named_returns:
            # Every physically separate island needs the net name. A shared
            # intended net and functional group do not prove a wire exists;
            # this applies to ordinary library pins as well as filter returns.
            # Independent local-wire checks still reject missing functional
            # connections, so labels cannot hide an incomplete local circuit.
            marker=(marker[0],marker[1],('physical-island',physical_islands.get(tuple(pos),tuple(pos))))
        if marker in labelled:continue
        dx,dy=p['direction'];net=netof[key]
        # Keep horizontal labels close to their terminal.  A long label stub
        # can place right-justified text across the neighbouring vertical rail.
        missing_outward=False
        try:
            lp=connected_label_point(pos,p['direction'],routes,1.27 if dx else 7.62)
        except ValueError:
            # A valid local motif may leave a pin perpendicular to its symbol
            # direction. Which terminal is visited first must not determine
            # whether its already-wired net can receive a label.
            lp=list(pos);missing_outward=True
        island=physical_islands.get(tuple(pos))
        island_routes=[(a,b) for a,b in routed_by_net.get(net,[])
                       if island is not None and physical_islands.get(tuple(a))==island]
        if key in open_label_ends:
            # A terminal lead with no downstream route must end at its label;
            # otherwise KiCad correctly reports the unused tail as an
            # unconnected-wire warning even though the net label is present.
            lp=list(open_label_ends[key])
            direction=p['direction']
        else:
            lp,direction=label_overrides.get((groupof[key.rsplit('.',1)[0]],net),(lp,p['direction']))
        if not direction[0]:
            # Put vertical-pin labels on the clearer side of their wire.
            width=max(2.54,len(net)*1.15)
            def crossings(side):
                lo,hi=(lp[0]+.15,lp[0]+width) if side>0 else (lp[0]-width,lp[0]-.15)
                return sum(1 for a,b in routes if (a[0]==b[0] and lo<a[0]<hi and min(a[1],b[1])<lp[1]-.15 and max(a[1],b[1])>lp[1]-1.65) or (a[1]==b[1] and lp[1]-1.65<a[1]<lp[1]-.15 and min(a[0],b[0])<hi and max(a[0],b[0])>lo))
            if crossings(-1)<crossings(1):direction=[-1,0]
        dense_vertical=not p['direction'][0] and sum(1 for other,q in pinmap.items() if other.rsplit('.',1)[0]==key.rsplit('.',1)[0] and q['direction']==p['direction'])>1
        label_angle=(90 if p['direction'][1]>0 else 270) if dense_vertical else 0
        if dense_vertical and any(
            abs(a[1]-b[1])<.0001
            and min(a[0],b[0])-.8<=lp[0]<=max(a[0],b[0])+.8
            and abs(a[1]-lp[1])<=6.35
            for a,b in routes
        ):
            # Prefer an endpoint of a same-net horizontal segment.  The label
            # faces away from the segment, so it remains attached while its
            # text occupies the free side of the route.  This also gives a
            # generic escape for dense buses whose vertical channel has no
            # clear text lane.
            candidates=[]
            for a,b in island_routes:
                if abs(a[1]-b[1])>.0001 or math.dist(a,b)<2.54:continue
                for candidate,direction in ((list(a),[-1,0]),(list(b),[1,0])):
                    if math.dist(candidate,pos)<2.54:continue
                    if label_route_clear(candidate,direction,net,net,(a,b)):
                        candidates.append((candidate,direction,0))
            if candidates:
                lp,direction,label_angle=min(candidates,key=lambda item:math.dist(item[0],lp))
            else:
                # Fall back to a vertical point away from the terminal.  The
                # minimum distance avoids placing a rotated label over a pin
                # number when the route starts at the symbol boundary.
                vertical=[]
                for a,b in island_routes:
                    if abs(a[0]-b[0])>.0001 or abs(a[1]-b[1])<.0001:continue
                    for candidate in (list(a),list(b),[(a[0]+b[0])/2,(a[1]+b[1])/2]):
                        if math.dist(candidate,pos)<2.54:continue
                        if label_route_clear(candidate,p['direction'],net,net,(a,b)):
                            vertical.append(candidate)
                if vertical:lp=min(vertical,key=lambda q:math.dist(q,lp))
                else:
                    # Keep the net name even for an unusually dense route:
                    # select the first same-net segment endpoint and orient it
                    # away from its segment.  The final PDF audit remains the
                    # authoritative collision check.
                    fallback=next((e for e in island_routes if math.dist(e[0],pos)>=2.54),None)
                    if fallback:
                        a,b=fallback;lp=list(a);direction=[-1,0] if abs(a[1]-b[1])<.0001 else p['direction'];label_angle=0 if direction[0] else label_angle

        # A valid net route can still leave its annotation over a resistor,
        # connector, or other symbol body.  Relocate only the label anchor to
        # an existing same-net segment endpoint, preserving electrical
        # connectivity.  Prefer a short horizontal label at a free endpoint;
        # this avoids the long vertical text column that commonly lands back
        # on a two-pin part while remaining readable for arbitrary net names.
        if key not in open_label_ends and (missing_outward or not label_route_clear(lp,direction,net,net,None,label_angle)):
            candidates=[];seen_candidates=set()
            for a,b in island_routes:
                if math.dist(a,b)<1.27:continue
                # Text may run above its supporting segment, toward either
                # endpoint. Restricting it to the outward side leaves no
                # candidate between a passive body and the owner's pin
                # annotation even when the wire itself has a clear lane.
                for candidate,candidate_direction in itertools.product((list(a),list(b)),([-1,0],[1,0])):
                    marker_candidate=(round(candidate[0],4),round(candidate[1],4),tuple(candidate_direction))
                    if marker_candidate in seen_candidates:continue
                    seen_candidates.add(marker_candidate)
                    if math.dist(candidate,pos)<1.27:continue
                    # Horizontal text is used for both route orientations. It
                    # stays attached at the endpoint and lets body avoidance
                    # choose the free side of the route without changing any
                    # net or component data.
                    if label_route_clear(candidate,candidate_direction,net,net,(a,b),0):
                        candidates.append((candidate,candidate_direction,0))
            if candidates:
                lp,direction,label_angle=min(candidates,key=lambda item:(math.dist(item[0],lp),item[0][1],item[0][0]))
            elif missing_outward:
                raise ValueError('No clear label anchor on the physically connected net island: '+key)
            
        if key in open_label_ends and not dense_vertical:
            # An isolated labelled terminal does not need its full routing
            # reserve drawn as wire. Search inward on that existing stub,
            # keeping the measured text clear of fields, pins and other nets.
            # The final tail-pruner removes only the now-unanchored remainder;
            # routed functional paths and every actual symbol pin stay intact.
            old_end=list(open_label_ends[key]);length=math.dist(pos,old_end)
            directions=[direction,[-1,0],[1,0]]
            found=False
            for index in range(2,int(math.floor(length/1.27+1e-6))+1):
                distance=index*1.27
                candidate=[round(pos[axis]+p['direction'][axis]*distance,4) for axis in (0,1)]
                for candidate_direction in directions:
                    if label_route_clear(candidate,candidate_direction,net,net,(pos,old_end),0):
                        lp,direction,label_angle=candidate,candidate_direction,0
                        found=True;break
                if found:break

        if not dense_vertical and not label_route_clear(lp,direction,net,net,None,label_angle):
            # Horizontal text may face either way at the same electrical
            # anchor.  Keep dense vertical pin banks in their reserved lanes.
            alternate=next((side for side in ([-1,0],[1,0])
                if label_route_clear(lp,side,net,net,None,0)),None)
            if alternate is not None:direction=alternate;label_angle=0
        extras.append(label(net,lp,direction,label_angle));placed_label_boxes.append(label_box(lp,direction,net,label_angle));labelled.add(marker)
    # All route endpoints are explicit vertices; KiCad decides connectivity from actual geometry.
    anchors=list(finalpins.values())
    anchors.extend([float(v) for v in child(extra,'at')[1:3]] for extra in extras
        if extra[0] in ('label','global_label','hierarchical_label'))
    unique=prune_unanchored_wire_tails(routes,anchors)
    extras.extend(wire(a,b) for a,b in sorted(unique))
    degree=collections.Counter(p for segment in unique for p in segment)
    junctions={p for p,count in degree.items() if count>=3}
    junctions.update(tuple(pos) for pos in finalpins.values() if sum(geom.on(pos,a,b) for a,b in unique)>1)
    for pos in sorted(junctions):extras.append(form('junction',at(*pos),form('diameter',number(0)),form('color',A('0'),A('0'),A('0'),A('0')),form('uuid',uid())))
    for helper_ref,net in supply_helpers(d).items():
        pos=finalpins[next(n['nodes'][0] for n in d['nets'] if n['name']==net)]
        props=[form('property',k,v,at(*pos,0),form('effects',form('font',form('size',number(1.27),number(1.27))),form('hide',A('yes')))) for k,v in [('Reference',helper_ref),('Value','SUPPLIED'),('Footprint',''),('Role','ERCHelper')]]
        extras.append(form('symbol',form('lib_id','Host:SupplyDeclaration'),at(*pos,0),form('unit',A('1')),form('in_bom',A('no')),form('on_board',A('no')),form('dnp',A('no')),form('uuid',uid()),*props))
    from value_selection import fields,notes
    # Frozen block instances may bypass instance(); add the same hidden host
    # metadata to every actual component without moving symbols or fields.
    for c in d['components']:
        raw=parts[c['ref']]
        for name,value in fields(c).items():
            prop=next((p for p in children(raw,'property') if p[1]==name),None)
            if prop is None:
                raw.append(form('property',name,value,at(0,0,0),form('effects',form('font',form('size',number(1.27),number(1.27))),form('hide',A('yes')))))
            else:prop[2]=value
    (out/'Circuit.kicad_sch').write_text(nr.dump(document(resources,list(parts.values()),paper,extras,rootid,notes(d))),encoding='utf8')
    write(out/'value-selections.json',[c['valueSelection'] for c in d['components'] if c.get('valueSelection')])
    write(out/'Circuit.kicad_pro',{'schematic':{'connection_grid_size':50.0}});write(out/'required-wires.json',required)
    for ident,fp in resources['footprints'].items():
        lib,name=ident.split(':');file=out/'footprints'/(lib+'.pretty')/(name+'.kicad_mod');file.parent.mkdir(parents=True,exist_ok=True);file.write_text(fp['native'],encoding='utf8')
    libs=sorted({s.split(':')[0] for s in resources['footprints']})
    (out/'fp-lib-table').write_text('(fp_lib_table '+''.join(f'(lib (name {json.dumps(lib)})(type "KiCad")(uri "${{KIPRJMOD}}/footprints/{lib}.pretty")(options "")(descr "Frozen resources"))' for lib in libs)+')',encoding='utf8')
    # Self-contained library snapshot enables opening/editing on another machine.
    slibs={}
    if d.get('supplied_nets'):
        helper=nr.parse(HELPER);helper[1]='SupplyDeclaration';slibs['Host']=[helper]
    for ident,s in resources['symbols'].items():
        lib,name=ident.split(':');row=nr.parse(s['native']);row[1]=name;slibs.setdefault(lib,[]).append(row)
    for lib,syms in slibs.items():
        folder=out/'symbols';folder.mkdir(exist_ok=True);(folder/(lib+'.kicad_sym')).write_text(nr.dump(form('kicad_symbol_lib',form('version',A('20241209')),form('generator','dsh'),*syms)),encoding='utf8')
    (out/'sym-lib-table').write_text('(sym_lib_table '+''.join(f'(lib (name {json.dumps(lib)})(type "KiCad")(uri "${{KIPRJMOD}}/symbols/{lib}.kicad_sym")(options "")(descr "Frozen resources"))' for lib in slibs)+')',encoding='utf8')
    return layout

def audit(resources,d,out,layout):
    ast,state=read_native(out/'Circuit.kicad_sch');errors=[];expected={c['ref']:c for c in d['components']};comps=[c for c in state['items'].values() if c['kind']=='component'];actual={c['reference']:c for c in comps};helpers=supply_helpers(d)
    if len(actual)!=len(comps) or set(actual)!=set(expected)|set(helpers):errors.append('Native component set changed')
    from value_selection import notes
    comments={str(row[1]):row[2] for row in children(child(ast,'title_block',[]),'comment')}
    if any(comments.get(str(i+2))!=note for i,note in enumerate(notes(d))):errors.append('Value selection notes changed')
    # Compare the COMPLETE source AST, not a lossy reconstruction via the writer.
    native={s[1]:s for s in children(child(ast,'lib_symbols',[]),'symbol')}
    for ident,s in resources['symbols'].items():
        if native.get(ident)!=nr.parse(s['native']):errors.append('Native symbol AST changed: '+ident)
    if set(native)!=set(resources['symbols'])|({'Host:SupplyDeclaration'} if helpers else set()):errors.append('Unexpected embedded symbols')
    for ref,c in expected.items():
        item=actual.get(ref)
        if not item:continue
        props={p['name']:p['value'] for p in item['properties']}
        if item['symbol']!=c['librarySymbol'] or item.get('mirror'):errors.append('Symbol identity changed: '+ref)
        for k,v in {'Reference':ref,'Value':c['value'],'Footprint':c['footprint'],'MPN':c['mpn'],'DesignId':c['id']}.items():
            if props.get(k)!=v:errors.append('Material property changed: '+ref+'.'+k)
        if any(item[k]!=c[k] for k in ('dnp','in_bom','on_board')):errors.append('Assembly flags changed: '+ref)
        source=instance(c,resources['symbols'][c['librarySymbol']])
        raw=next(x for x in children(ast,'symbol') if any(p[1]=='Reference' and p[2]==ref for p in children(x,'property')))
        def field_contract(p):
            p=copy.deepcopy(p);p[:]=[x for x in p if not isinstance(x,list) or x[0]!='at']
            eff=child(p,'effects',[]);eff[:]=[x for x in eff if not isinstance(x,list) or x[0]!='justify']
            return p
        before={p[1]:field_contract(p) for p in children(source,'property')};after={p[1]:field_contract(p) for p in children(raw,'property')}
        if before!=after or len(children(raw,'property'))!=len(after):errors.append('Property visibility, font or metadata changed: '+ref)
    pins={c['reference']+'.'+p['number']:geom.world(c,p['at']) for c in comps for p in state['symbols'][c['symbol']]['pins']}
    xml=ET.parse(out/'actual.net.xml').getroot();observed=collections.Counter();names={};nc=set();helpernets={}
    for n in xml.findall('./nets/net'):
        members=[]
        for x in n.findall('node'):
            ref=x.get('ref');key=ref+'.'+x.get('pin')
            if ref in helpers:helpernets[ref]=n.get('name','').removeprefix('/');continue
            members.append(key)
            if 'no_connect' in x.get('pintype',''):nc.add(key)
        if members:observed[frozenset(members)]+=1;names[frozenset(members)]=n.get('name','').removeprefix('/')
    wanted=collections.Counter(frozenset(n['nodes']) for n in d['nets']);wanted.update(frozenset([p]) for p in d['nc'])
    if wanted!=observed:errors.append('Actual KiCad net partitions changed')
    if nc!=set(d['nc']):errors.append('Actual KiCad NC set changed')
    for n in d['nets']:
        if names.get(frozenset(n['nodes']))!=n['name']:errors.append('Actual net name changed: '+n['name'])
    markers=[i['at'] for i in state['items'].values() if i['kind']=='no_connect']
    if len(markers)!=len(d['nc']) or any(not any(math.dist(pins[k],m)<.0002 for m in markers) for k in d['nc']):errors.append('NC markers changed')
    physical,segs=geom.physical_graph(state)
    for ref,net in helpers.items():
        c=actual.get(ref,{})
        # KiCad omits #PWR virtual symbols from its XML. Bind the helper through
        # actual wire connectivity to ordinary pins whose nets were read back.
        attached={names.get(frozenset(n['nodes'])) for n in d['nets'] if any(physical.get(k,k)==physical.get(ref+'.1') for k in n['nodes'])}
        if attached!={net} or ref in helpernets and helpernets[ref]!=net or c.get('in_bom',True) or c.get('on_board',True) or c.get('symbol')!='Host:SupplyDeclaration' or native.get('Host:SupplyDeclaration')!=nr.parse(HELPER):errors.append('Supply declaration changed: '+ref)
    # Derive obligations from frozen topology and the host-validated plan, never a model report.
    required=[]
    from driver_inputs import ground_island
    for g in layout['groups']:
        island=ground_island(d,resources,g['references'])
        for n in d['nets']:
            if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I):continue
            if (n['name'] in d.get('supplied_nets',[])
                and any(resources['symbols'][c['librarySymbol']].get('drawingRules') for c in d['components'] if c['ref'] in g['references'])
                and any(k.rsplit('.',1)[0] not in g['references'] for k in n['nodes'])):
                # Cross-block supplies may use labels; their complete net
                # partition and exact name are independently verified above.
                continue
            members=[k for k in n['nodes'] if k.rsplit('.',1)[0] in g['references'] and k not in same_net_terminals(d)]
            # Check each physical return rail separately; actual KiCad XML
            # above must still prove both rails belong to the expected net.
            for subset in ([k for k in members if k in island],[k for k in members if k not in island]):
                if len(subset)>1:required.append(subset)
    from interface_clusters import local_return_nodes
    interface_returns=local_return_nodes(d,resources,layout['groups'])
    for g in layout['groups']:
        for n in d['nets']:
            members=[k for k in n['nodes'] if k in interface_returns and k.rsplit('.',1)[0] in g['references']]
            if len(members)>1:required.append(members)
    for members in required:
        if len({physical.get(k,k) for k in members})!=1:errors.append('Required local wires missing: '+str(members))
    for ident,fp in resources['footprints'].items():
        lib,name=ident.split(':');p=out/'footprints'/(lib+'.pretty')/(name+'.kicad_mod')
        if not p.exists() or nr.sha(p.read_text(encoding='utf8'))!=nr.sha(fp['native']):errors.append('Frozen footprint changed: '+ident)
    pdf=fc.audit_layout(out,state,str(out/'Circuit.pdf'));errors+=pdf['errors'];write(out/'pdf-geometry.json',pdf)
    w,h=page_size(layout['paper'])
    outside_wires=_wire_boundary_violations(state,(w,h))
    if outside_wires:errors.append('Wires outside reserved drawing area: '+str(len(outside_wires)))
    if state['page_size_mm']!=[w,h] or child(ast,'paper')[1]!=layout['paper'].split('-')[0] or 'portrait' in child(ast,'paper'):errors.append('Page size changed')
    bodies=[]
    for c in comps:
        if c['reference'] in helpers:continue
        b=geom.part_bounds(c,state['symbols'][c['symbol']]);body=geom.body_bounds(c,state['symbols'][c['symbol']])
        if b[0]<10-.001 or b[1]<10-.001 or b[2]>w-10+.001 or b[3]>h-45+.001:errors.append('Outside reserved drawing area: '+c['reference'])
        if body:
            for ref,other in bodies:
                if min(body[2],other[2])-max(body[0],other[0])>.1 and min(body[3],other[3])-max(body[1],other[1])>.1:errors.append('Symbol body overlap: '+ref+' / '+c['reference'])
            bodies.append((c['reference'],body))
    erc=read(out/'erc.json');viol=[v for s in erc['sheets'] for v in s['violations']];ec=sum(v['severity']=='error' for v in viol);wc=sum(v['severity']=='warning' for v in viol)
    if ec:errors.append('ERC errors: '+str(ec))
    fields=['Reference','Value','Footprint','MPN','DesignId','OriginalFootprint','MaterialCode','MaterialDescription','AssemblyType','ObjectRole','SelectionStatus','SelectionBasis','SelectionMissing','DNP','OnBoard']
    with (out/'bom.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for c in comps:
            if c['in_bom']:
                p={p['name']:p['value'] for p in c['properties']};writer.writerow({k:p.get(k,'') for k in fields[:-2]}|{'DNP':c['dnp'],'OnBoard':c['on_board']})
    # Expose the compiler-selected public layout separately from diagnostics.
    # A generated group may promote A3 to A2 after measuring its real bounds;
    # callers can persist this value for the subsequent verify pass without
    # carrying the internal autoPaperPromotion bookkeeping field.
    effective_layout={k:copy.deepcopy(layout[k]) for k in ('template','paper','gapMm','groups','rotations','allowPaperPromotion') if k in layout}
    requested_paper=layout.get('autoPaperPromotion',{}).get('requested',layout.get('paper'))
    report={'status':'failed' if errors else 'passed','errors':errors,'symbols':len(expected),'pins':sum(len(c['pins']) for c in d['components']),'nets':len(d['nets']),'nc':sorted(nc),'erc':{'errors':ec,'warnings':wc,'violations':viol},'layout':{'pageMm':[w,h],'localWireGroups':len(required),'textOverlaps':len(pdf.get('collisions',[])),'wireBodyCrossings':len(pdf.get('wireBodyCrossings',[])),'wireTextCrossings':len(pdf.get('wireTextCrossings',[])),'bodyTextOverlaps':len(pdf.get('bodyTextOverlaps',[]))},'paperSelection':{'requested':requested_paper,'selected':layout.get('paper')},'effectiveLayout':effective_layout,'scope':'Single-sheet native symbols; actual netlist and PDF checks; electrical ratings, procurement and physical performance require review.'}
    report['layout']['wiresOutsideDrawingArea']=len(outside_wires)
    if (out/'orientation-search.json').exists():
        search=read(out/'orientation-search.json');trials=search.get('candidates',[])
        report['orientationSearch']={'method':search.get('method'),'candidates':len(trials) if isinstance(trials,list) else trials,'selected':search.get('selected')}
    write(out/'audit.json',report);write(out/'readback.json',{'components':comps,'pins':pins,'pinDetails':{c['reference']+'.'+p['number']:{'name':p['name'],'type':p['type']} for c in comps for p in state['symbols'][c['symbol']]['pins']},'nets':d['nets'] if wanted==observed else [],'nc':sorted(nc)})
    return report

def main(req):
    op=req['operation']
    if op=='lookup':return nr.query(req)
    if op=='lookup-batch':
        queries=req.get('queries',[])
        if not isinstance(queries,list) or len(queries)>200:raise ValueError('Invalid batch size')
        return {'symbols':[nr.query({**req,'kind':'symbol','query':q}) for q in queries]}
    d=read(req['design']) if isinstance(req['design'],str) else req['design'];validate(d)
    if op=='snapshot':
        resources=nr.snapshot(req,d);write(req['snapshot'],resources);return {'status':'passed','symbols':len(resources['symbols']),'components':len(d['components']),'policy':resources['policy'],'scope':resources['scope']}
    resources=read(req['library']);out=Path(req['output']).resolve()
    from topology_motifs import native_matches
    resources=copy.deepcopy(resources)
    detected=native_matches(resources,d)
    # Explicit visual grouping remains authoritative; only reuse exact groups.
    if req['layout'].get('groups'):
        detected=[b for b in detected if any(set(g['references'])==set(b['bindings'].values()) for g in req['layout']['groups'])]
    def compatible_rotation(b):
        for raw in children(nr.parse(b['native']),'symbol'):
            oldref=next(p[2] for p in children(raw,'property') if p[1]=='Reference')
            ref=b['bindings'][oldref];angle=float(child(raw,'at')[3])
            if ref in req['layout'].get('rotations',{}) and req['layout']['rotations'][ref]!=angle:return False
        return True
    detected=[b for b in detected if compatible_rotation(b)]
    resources['blocks']=resources.get('blocks',[])+detected
    if os.name=='nt' and not str(out).startswith('\\\\?\\'):out=Path('\\\\?\\'+str(out))
    out.mkdir(parents=True,exist_ok=True)
    requested=copy.deepcopy(req['layout'])
    from symbol_orientation import defaults as orientation_defaults
    requested=_merge_orientation_defaults(requested,orientation_defaults(d,resources),resources)
    layout=normalize_layout(requested,d,resources)
    write(out/'motif-recognition.json',{'matches':[{k:v for k,v in b.items() if k!='native'} for b in detected],'unmatched':[c['ref'] for c in d['components'] if not any(c['ref'] in b['bindings'].values() for b in resources['blocks'])]})
    if op=='generate':
        from orientation_search import candidates,select_candidate
        from layout_quality import wire_metrics,unwired_metrics,complexity
        banks,plans=candidates(d,resources,layout,req['layout'].get('rotations',{}),allow_clusters=True,merge_groups=not req['layout'].get('groups'))
        def render(candidate,directory):
            effective=generate(copy.deepcopy(resources),d,directory,candidate,req.get('node','node'))
            export(directory,req['cli'],directory/'Circuit.kicad_sch')
            return audit(resources,d,directory,effective)
        def measure(directory,report):
            _,state=read_native(directory/'Circuit.kicad_sch')
            segments=[(a,b) for item in state['items'].values() if item['kind']=='wire' for a,b in zip(item['points'],item['points'][1:])]
            junctions=[item['at'] for item in state['items'].values() if item['kind']=='junction']
            metrics={**wire_metrics(segments,junctions),**unwired_metrics(state,d)};page=read(directory/'page-placement.json')
            check=subprocess.run([req.get('node','node'),str(Path(__file__).with_name('review_layout_candidate.mjs')),str(directory)],capture_output=True,text=True,encoding='utf8',timeout=30,check=True)
            routing=json.loads(check.stdout)
            return {'metrics':metrics,'width':page['width'],'height':page['height'],'routingStatus':routing['status'],'routingFindings':routing.get('findings',[]),
                    'orientationScore':[math.prod(report['layout']['pageMm']),complexity(metrics,page['width'],page['height'],include_label_span=False),metrics['crossings'],metrics['bends'],metrics['wireMm']],
                    'score':[math.prod(report['layout']['pageMm']),complexity(metrics,page['width'],page['height']),metrics['crossings'],metrics['bends'],metrics['wireMm']]}
        if len(plans)>1:
            report,search=select_candidate(plans,out,render,measure)
            search['banks']=banks;write(out/'orientation-search.json',search)
            report['orientationSearch']={'candidates':len(plans),'selected':search['selected']};write(out/'audit.json',report)
            return report
        layout=generate(resources,d,out,layout,req.get('node','node'))
        write(out/'orientation-search.json',{'method':'explicit-or-unambiguous-orientation','banks':banks,'candidates':1,'selected':0})
    elif op!='verify':raise ValueError('Unsupported operation')
    export(out,req['cli'],out/'Circuit.kicad_sch');return audit(resources,d,out,layout)

if __name__=='__main__':
    try:write(sys.argv[2],main(read(sys.argv[1])))
    except Exception as e:write(sys.argv[2],{'status':'failed','errors':[str(e)]});raise
