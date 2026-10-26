"""User-selected AD drawing conventions, independent of board nets/placement.

These are schematic artwork templates, not package dimensions. Eligibility is
based on device facts, never reference designators or a historical board path.
Pin identity/types come exclusively from the current specification record.
"""
import json

def generate(ident,row):
    pins=row['pins'];kind=row['componentKind'];features=row.get('displayFeatures',{})
    numbered={p['number'] for p in pins}=={str(i+1) for i in range(len(pins))}
    display=(kind=='display' and numbered and len(pins)==10
             and features.get('digits')==2 and features.get('indicatorCount')==4)
    connector=kind=='connector' and numbered and bool(pins)
    ground=lambda p:p['name'].upper() in ('GND','SGND','AGND','DGND','PGND','VSS')
    receiver=(kind=='infrared-receiver' and len(pins)==3
              and sum(ground(p) for p in pins)==1
              and sum(p['type']=='power_in' and not ground(p) for p in pins)==1
              and sum(p['type'] in ('output','open_collector','open_emitter','tri_state') for p in pins)==1)
    if not (display or connector or receiver):return None
    q=lambda s:json.dumps(str(s),ensure_ascii=False)
    graphics=[];nativepins=[];byid={p['number']:p for p in pins}
    def line(points,fill='none'):
        graphics.append('(polyline (pts '+''.join(f'(xy {x} {y})' for x,y in points)+f') (stroke (width 0.1524) (type default)) (fill (type {fill})))')
    def rect(x1,y1,x2,y2):
        graphics.append(f'(rectangle (start {x1} {y1}) (end {x2} {y2}) (stroke (width 0.1524) (type default)) (fill (type background)))')
    def pin(p,x,y,angle,length):
        nativepins.append(f'(pin {p["type"]} line (at {x} {y} {angle}) (length {length}) (name {q(p["name"])} (effects (font (size 1.27 1.27)))) (number {q(p["number"])} (effects (font (size 1.27 1.27)))))')
    if display:
        # Asymmetric indicator strip, continuous seven-segment digits, and
        # two numbered rows. Off-grid legacy terminals are normalized to 50 mil.
        rect(-8.128,2.54,25.4,10.668);rect(0,10.668,25.4,25.4)
        for x in (-3.81,5.334,12.954,21.59):
            graphics.append(f'(circle (center {x} 6.35) (radius 1.27) (stroke (width 0.1524) (type default)) (fill (type none)))')
        for x in (7.62,12.192):
            line([(x,20.32),(x,16.764),(x+3.556,16.764),(x+3.556,13.208),(x,13.208),(x,20.32),(x+3.556,20.32),(x+3.556,16.764)])
        for i in range(5):
            x=2.54+i*5.08
            pin(byid[str(i+1)],x,-2.54,90,5.08)
            pin(byid[str(10-i)],x,30.48,270,5.08)
        right,top=25.4,25.4;ref='DS'
    elif connector:
        pitch=3.81;top=(len(pins)-1)*pitch+2.54
        rect(-5.08,0,0,top)
        for i in range(len(pins)):pin(byid[str(i+1)],-7.62,1.27+i*pitch,0,2.54)
        right=0;ref='J'
    else:
        rect(0,0,15.24,12.7)
        line([(3.81,2.54),(3.81,10.16)])
        line([(1.27,7.62),(6.35,7.62)])
        line([(1.27,5.08),(3.81,7.62),(6.35,5.08),(1.27,5.08)],'background')
        for y in (6.604,8.636):
            line([(6.858,y),(8.382,y+1.524)])
            line([(6.858,y+.762),(6.858,y),(7.62,y)])
        for p in pins:
            y=1.27 if ground(p) else 11.43 if p['type']=='power_in' else 6.35
            pin(p,17.78,y,180,2.54)
        right,top=15.24,12.7;ref='D'
    name=ident.split(':')[-1]
    native=f'(symbol {q(ident)} (pin_names (offset 0.762)) (in_bom yes) (on_board yes) (property "Reference" {q(ref)} (at {right+2.54} {top+2.54} 0) (effects (font (size 1.27 1.27)) (justify left))) (property "Value" {q(row.get("value",""))} (at {right+2.54} {top} 0) (effects (font (size 1.27 1.27)) (justify left))) (symbol {q(name+"_0_1")} {" ".join(graphics)}) (symbol {q(name+"_1_1")} {" ".join(nativepins)}))'
    return native,{'origin':'symbol-style-library','rules':'ad-readable-v1','pinGridMm':1.27,
                   'schematicArtworkOnly':True,'pinIdentitySource':'current-specification'}
