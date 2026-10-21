"""Compile semantic, dimensioned mock specification profiles into native symbols."""
import json,math

def generate(ident,row):
    a=row['appearance'];kind=a['kind'];graphics=[];pins=[];q=lambda s:json.dumps(s,ensure_ascii=False)
    def line(points,width=.254,fill='none'):
        graphics.append('(polyline (pts '+''.join(f'(xy {x:.6f} {y:.6f})' for x,y in points)+f') (stroke (width {width}) (type default)) (fill (type {fill})))')
    def text(s,x,y,size,align='left bottom'):
        graphics.append(f'(text {q(s)} (at {x} {y} 0) (effects (font (face "SimSun") (size {size} {size})) (justify {align})))')
    def emit(p,x,y,angle,length):
        pins.append(f'(pin {p["type"]} line (at {x:.6f} {y:.6f} {angle}) (length {length}) (name {q(p["name"])} (effects (font (size 1.27 1.27)))) (number {q(p["number"])} (effects (font (size 1.27 1.27)))))')
    if kind in ('specified-resistor','specified-capacitor'):
        theta=math.radians(a['axisDegrees']);c,s=math.cos(theta),math.sin(theta);span=a['terminalSpanMm'];length=a['pinLengthMm']
        rotate=lambda points:[(x*c-y*s,x*s+y*c) for x,y in points]
        if kind=='specified-resistor':
            h=a['zigzagHalfHeightMm'];body=span-2*length;step=body/5
            points=[(length,0)]+[(length+step*(i+.5),h*(-1)**i) for i in range(a['zigzagTurns'])]+[(span-length,0)]
            line(rotate(points),a['strokeWidthMm'])
        else:
            left=(span-a['plateGapMm'])/2;right=(span+a['plateGapMm'])/2;h=a['plateHalfLengthMm']
            for points in [[(left,0),(length,0)],[(span-length,0),(right,0)],[(left,-h),(left,h)],[(right,-h),(right,h)]]:line(rotate(points),a['strokeWidthMm'])
        emit(row['pins'][0],0,0,a['axisDegrees'],length);emit(row['pins'][1],span*c,span*s,(a['axisDegrees']+180)%360,length)
        names=False;numbers=False;fieldx=span*c/2;fieldy=span*s/2+3.81
    else:
        w=a['bodyWidthMm'];h=a['bodyHeightMm'];rx,ry=a['cornerRadiusMm'];width=a['outlineWidthMm']
        if rx and ry:
            points=[]
            for cx,cy,start in [(w-rx,h-ry,0),(rx,h-ry,90),(rx,ry,180),(w-rx,ry,270)]:
                # Fine ellipse chords preserve the specified radii (not circular corners).
                for i in range(101):
                    t=math.radians(start+i*.9);points.append((cx+rx*math.cos(t),cy+ry*math.sin(t)))
            points.append(points[0]);line(points,width,'background')
        else:graphics.append(f'(rectangle (start 0 0) (end {w} {h}) (stroke (width {width}) (type default)) (fill (type background)))')
        if kind=='specified-receiver':
            u=a['photoDiodeUnitMm'];shapes=[([(3,2),(3,8)],'none'),([(5,6),(5,6.2),(1,6.2),(1,6),(5,6)],'background'),([(1,4),(3,6),(5,4),(1,4)],'background'),([(5.8,5.6),(6.6,6.4)],'none'),([(5.8,7.2),(6.6,8)],'none'),([(5.4,5.8),(5.4,5.2),(6,5.2),(5.4,5.8)],'background'),([(5.4,7.4),(5.4,6.8),(6,6.8),(5.4,7.4)],'background')]
            for points,fill in shapes:line([(x*u,y*u) for x,y in points],.254,fill)
        if kind=='specified-process':
            for label in a['labels']:text(label['text'],label['leftMm'],label['bottomMm'],label['fontMm'],label['align'])
            if a.get('flowArrow'):
                margin=.254;neck=w-3.048;tip=w-margin;middle=h/2;top=middle+1.016;bottom=middle-1.016
                for points in [[(margin,top),(margin,bottom),(neck,bottom)],[(margin,top),(neck,top)],[(neck,top),(neck,h-margin),(tip,middle)],[(neck,bottom),(neck,margin),(tip,middle)]]:line(points)
        bynumber={p['number']:p for p in row['pins']};covered=[]
        for p in a['pinPresentation']:
            edge=p['edge'];offset=p['offsetMm'];length=p['lengthMm'];covered.append(p['number'])
            x,y,angle={'left':(-length,offset,0),'right':(w+length,offset,180),'bottom':(offset,-length,90),'top':(offset,h+length,270)}[edge]
            emit(bynumber[p['number']],x,y,angle,length)
        if len(covered)!=len(set(covered)) or set(covered)!=set(bynumber):raise ValueError('Specification must place each pin exactly once')
        names=any(p['showName'] for p in a['pinPresentation']);numbers=any(p['showNumber'] for p in a['pinPresentation']);fieldx=w+2.54;fieldy=h
    name=ident.split(':')[1];hide_names='' if names else ' hide';hide_numbers='' if numbers else ' (pin_numbers hide)'
    return f'(symbol {q(ident)} (pin_names (offset 0.762){hide_names}){hide_numbers} (in_bom yes) (on_board yes) (property "Reference" "U" (at {fieldx} {fieldy} 0) (effects (font (size 1.27 1.27)))) (property "Value" {q(row["value"])} (at {fieldx} {fieldy-2.54} 0) (effects (font (size 1.27 1.27)))) (symbol {q(name+"_0_1")} {" ".join(graphics)}) (symbol {q(name+"_1_1")} {" ".join(pins)}))'
