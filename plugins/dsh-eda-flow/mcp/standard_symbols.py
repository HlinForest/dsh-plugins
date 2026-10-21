"""Generate symbols from electrical facts. All drawing decisions are host-owned.

KLC: explicit pins on a 100 mil grid, functional pin grouping, readable fields.
Discrete symbols reuse installed KiCad library graphics rather than input geometry.
"""
import copy, hashlib, json, math, re, unicodedata

GRID = 2.54

def generate(ident, row, library_root):
    import native_resources as nr
    from design_audit import child, children
    pins = row['pins']; kind = row['componentKind']
    q = lambda v: json.dumps(str(v), ensure_ascii=False)
    common = {'resistor':'Device:R_US', 'capacitor':'Device:C'}
    if kind == 'connector' and pins and {p['number'] for p in pins} == {str(i+1) for i in range(len(pins))}:
        common[kind] = f'Connector_Generic:Conn_01x{len(pins):02}'
    if kind in common and library_root:
        original = nr.symbol(library_root, common[kind])
        tree = nr.parse(original['native'])
        bynumber = {p['number']:p for p in pins}
        if set(bynumber) != {p['number'] for p in original['pins']}:
            raise ValueError('Standard symbol pin count differs from source facts')
        tree[1] = ident
        if kind in ('resistor','capacitor'):
            tree[:]=[v for v in tree if not isinstance(v,list) or v[0] not in ('pin_names','pin_numbers')]
            tree.extend([[nr.Atom('pin_names'),nr.Atom('hide')],[nr.Atom('pin_numbers'),nr.Atom('hide')]])
        for unit in children(tree,'symbol'):
            unit[1] = ident.split(':')[1] + '_' + '_'.join(unit[1].split('_')[-2:])
            for pin in children(unit,'pin'):
                fact = bynumber[child(pin,'number')[1]]
                pin[1] = nr.Atom(fact['type'])
                child(pin,'name')[1] = fact['name']
        return nr.dump(tree), {'origin':'kicad-library','librarySymbol':common[kind],'libraryHash':original['sha256']}

    sides = {s:[] for s in ('left','right','top','bottom')}
    numbered = {p['number'] for p in pins} == {str(i+1) for i in range(len(pins))}
    package_order = (kind=='logic-ic' and numbered and len(pins)>=8 and len(pins)%2==0
                     and bool(re.search(r'SOP|SOIC|DIP|SSOP|TSSOP',row.get('originalFootprint',''),re.I)))
    receiver = kind=='infrared-receiver' and len(pins)==3
    for pin in pins:
        name = pin['name'].upper()
        side = ('bottom' if name in ('GND','SGND','AGND','DGND','PGND','VSS','VEE')
                else 'top' if pin['type'] == 'power_in'
                else 'right' if pin['type'] in ('output','open_collector','open_emitter','tri_state')
                else 'left')
        if kind=='display':side='bottom' if name.startswith(('DIG','COM','GRID')) else 'top'
        if package_order:side='left' if int(pin['number'])<=len(pins)//2 else 'right'
        if receiver:side='right'
        sides[side].append(pin)
    # Place adjacent signal families together while retaining exact source numbers.
    for side in sides:
        if package_order:sides[side].sort(key=lambda p:int(p['number']),reverse=side=='right')
        elif receiver:sides[side].sort(key=lambda p:2 if p['name'].upper() in ('GND','VSS','SGND') else 0 if p['type']=='power_in' else 1)
        else:sides[side].sort(key=lambda p:(0 if p['type']=='input' else 1, ''.join(c for c in p['name'] if not c.isdigit()), int(p['number']) if p['number'].isdigit() else 999, p['number']))
    signal_pitch = GRID*2 if package_order or receiver or max(len(sides['left']),len(sides['right']))>4 else GRID
    height = signal_pitch * max(2, math.ceil((max(len(sides['left']),len(sides['right']),1)+1)/2))
    longest = max((len(p['name']) for p in pins), default=3)
    width = GRID * max(4, math.ceil(longest*.5), math.ceil((max(len(sides['top']),len(sides['bottom']),1)+1)/2))
    if package_order or receiver:
        width=GRID*max(3,math.ceil(longest*.35))
        height=(max(len(sides['left']),len(sides['right']))-1)*signal_pitch/2+GRID
    features = row.get('displayFeatures',{})
    if kind=='display':
        width=max(width,GRID*max(features.get('digits',0)*2,features.get('indicatorCount',0),4))
        height=max(height,GRID*5)
    process_lines=[]
    if kind=='process':
        label=row.get('materialDescription') or row.get('originalFootprint') or row['reference']
        current='';advance=0
        for char in label:
            size=1.27 if unicodedata.east_asian_width(char) in ('W','F') else .9
            if current and (char=='\n' or advance+size>width*2-5.08):
                process_lines.append(current);current='';advance=0
            if char!='\n':current+=char;advance+=size
        if current:process_lines.append(current)
        height=max(height,((len(process_lines)-1)*2.54+1.27)/2+2.54)
    graphics=[f'(rectangle (start {-width} {height}) (end {width} {-height}) (stroke (width 0.254) (type default)) (fill (type background)))']
    def line(points):
        graphics.append('(polyline (pts '+''.join(f'(xy {x} {y})' for x,y in points)+') (stroke (width 0.254) (type default)) (fill (type none)))')
    if kind=='display':
        if features.get('indicatorCount',0):
            # A separate indicator strip communicates the two functions without
            # treating the symbol drawing as a mechanical package outline.
            lower=max(width,features['indicatorCount']*GRID+GRID)
            outline=[(-width,height),(width,height),(width,-3.81),(lower,-3.81),(lower,-height),(-lower,-height),(-lower,-3.81),(-width,-3.81),(-width,height)]
            graphics=['(polyline (pts '+''.join(f'(xy {x} {y})' for x,y in outline)+') (stroke (width 0.254) (type default)) (fill (type background)))']
        count=features.get('digits',0)
        for i in range(count):
            x=(i-(count-1)/2)*GRID*3
            # Seven-segment functional drawing; not physical enclosure dimensions.
            for a,b in [((-2,4),(2,4)),((-2,0),(2,0)),((-2,-4),(2,-4)),((-2,4),(-2,0)),((2,4),(2,0)),((-2,0),(-2,-4)),((2,0),(2,-4))]:
                line([(x+a[0],a[1]+2.54),(x+b[0],b[1]+2.54)])
        count=features.get('indicatorCount',0)
        for i in range(count):
            x=(i-(count-1)/2)*GRID*2
            graphics.append(f'(circle (center {x} -6.35) (radius 1.27) (stroke (width 0.254) (type default)) (fill (type none)))')
    if kind=='infrared-receiver':
        # Reuse the library's optical functional diagram, without importing
        # its diode terminals or confusing them with the receiver pinout.
        optical=nr.parse(nr.symbol(library_root,'Device:D_Photo')['native'])
        for unit in children(optical,'symbol'):
            for graphic in children(unit,'polyline'):
                graphic=copy.deepcopy(graphic)
                for point in children(child(graphic,'pts',[]),'xy'):
                    point[1]=nr.Atom(str(float(point[1])-2.54))
                    point[2]=nr.Atom(str(float(point[2])-1.27))
                graphics.append(nr.dump(graphic))
    if kind=='process':
        for i,text in enumerate(process_lines):
            graphics.append(f'(text {q(text)} (at 0 {((len(process_lines)-1)/2-i)*2.54} 0) (effects (font (size 1.27 1.27))))')
    nativepins=[]
    for side,items in sides.items():
        for i,p in enumerate(items):
            offset=(((len(items)-1)/2 if package_order or receiver else math.floor((len(items)-1)/2))-i)*(signal_pitch if side in ('left','right') else GRID)
            pin_length=GRID if package_order or receiver else GRID*2
            x,y,angle={'left':(-width-pin_length,offset,0),'right':(width+pin_length,offset,180),'top':(-offset,height+pin_length,270),'bottom':(-offset,-height-pin_length,90)}[side]
            nativepins.append(f'(pin {p["type"]} line (at {x} {y} {angle}) (length {pin_length}) (name {q(p["name"])} (effects (font (size 1.27 1.27)))) (number {q(p["number"])} (effects (font (size 1.27 1.27)))))')
    name=ident.split(':')[1]
    native=f'(symbol {q(ident)} (pin_names (offset 0.762)) (in_bom yes) (on_board yes) (property "Reference" "U" (at {width+2.54} {height+2.54} 0) (effects (font (size 1.27 1.27)) (justify left))) (property "Value" {q(row["value"])} (at {width+2.54} {height} 0) (effects (font (size 1.27 1.27)) (justify left))) (symbol {q(name+"_0_1")} {" ".join(graphics)}) (symbol {q(name+"_1_1")} {" ".join(nativepins)}))'
    return native, {'origin':'functional-symbol-generator','rules':'KLC-functional-grid-v1','conventions':'https://klc.kicad.org/','pinGridMm':GRID}
