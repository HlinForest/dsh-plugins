"""Build the specified stepped display from visible dimensional evidence.
No source CAD, netlist or frozen library is read by this module.
"""
import json, math

def generate(ident,row):
    a=row['appearance'];parts=[];q=lambda s:json.dumps(s,ensure_ascii=False)
    w=a['bodyWidthMm'];h=a['bodyHeightMm'];strip=a['stripHeightMm'];stroke=a['strokeWidthMm']
    def rect(x1,y1,x2,y2):parts.append(f'(rectangle (start {x1} {y1}) (end {x2} {y2}) (stroke (width {a["outlineWidthMm"]}) (type default)) (fill (type background)))')
    def line(points):parts.append('(polyline (pts '+''.join(f'(xy {x:.6f} {y:.6f})' for x,y in points)+f') (stroke (width {stroke}) (type default)) (fill (type none)))')
    rect(-a['stripLeftExtensionMm'],0,w,strip);rect(0,strip,w,strip+h)
    for x in a['indicatorLeftOffsetsMm']:
        y=a['indicatorHeightMm'];radius=a['indicatorRadiusMm'];start=a['indicatorGapStartDegrees'];sweep=a['indicatorSweepDegrees']
        def pt(t):return x+radius*math.cos(math.radians(t)),y+radius*math.sin(math.radians(t))
        points=[pt(start),pt(start+sweep/2),pt(start+sweep)]
        parts.append('(arc '+''.join(f'({key} {px:.6f} {py:.6f})' for key,(px,py) in zip(('start','mid','end'),points))+f' (stroke (width {stroke}) (type default)) (fill (type none)))')
    for x in a['digitLeftOffsetsMm']:
        y=strip+a['digitBottomAboveStripMm'];dw=a['digitWidthMm'];dh=a['digitHeightMm'];mid=y+dh/2
        line([(x,y+dh),(x,mid),(x+dw,mid),(x+dw,y),(x,y),(x,y+dh),(x+dw,y+dh),(x+dw,mid)])
    pins={p['number']:p for p in row['pins']};draw=[];covered=[]
    for side,angle,y in [('top',270,strip+h+a['pinLengthMm']),('bottom',90,-a['pinLengthMm'])]:
        numbers=a[side+'PinOrder'];offsets=a[side+'PinOffsetsMm']
        if len(numbers)!=len(offsets):raise ValueError('Pin order and offsets differ')
        for n,x in zip(numbers,offsets):
            # Original outline dimensions remain exact. Electrical connection
            # points use KiCad's 1.27 mm grid (two legacy offsets are off-grid).
            x=round(round(x/1.27)*1.27,4)
            p=pins[n];covered.append(n)
            # Native vertical pin text would cover the four indicators. Keep the
            # electrical names, and draw readable horizontal labels outside.
            name_y=y+2.54 if side=='top' else y-2.54
            number_y=y-a['pinLengthMm']/2 if side=='top' else y+a['pinLengthMm']/2
            parts.append(f'(text {q(p["name"])} (at {x} {name_y} 0) (effects (font (size 1.27 1.27))))')
            parts.append(f'(text {q(n)} (at {x-1.27} {number_y} 0) (effects (font (size 1.27 1.27)) (justify right)))')
            draw.append(f'(pin {p["type"]} line (at {x} {y} {angle}) (length {a["pinLengthMm"]}) (name {q(p["name"])} (effects (font (size 1.27 1.27)))) (number {q(n)} (effects (font (size 1.27 1.27)))))')
    if len(covered)!=len(set(covered)) or set(covered)!=set(pins):raise ValueError('Display must retain each specified pin once')
    name=ident.split(':')[1]
    return f'(symbol {q(ident)} (pin_names (offset 0.762) hide) (pin_numbers hide) (in_bom yes) (on_board yes) (property "Reference" "DS" (at {w+2.54} {strip+h} 0) (effects (font (size 1.27 1.27)))) (property "Value" "LED" (at {w+2.54} {strip+h-2.54} 0) (effects (font (size 1.27 1.27)))) (symbol {q(name+"_0_1")} {" ".join(parts)}) (symbol {q(name+"_1_1")} {" ".join(draw)}))'
