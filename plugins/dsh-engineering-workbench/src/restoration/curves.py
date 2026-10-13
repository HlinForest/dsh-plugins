"""Source-derived curve comparison, independent of reconstruction code.

Curves are sampled at at most one degree. Compare both directions against line
segments, so missing corners and closed-over arc gaps cannot pass by containment.
This is a bounded geometric approximation, not an exact native curve proof.
"""
import math

def tag(n): return str(n[0]) if isinstance(n,list) and n else ''
def child(n,k): return next((v for v in n if tag(v)==k),None)
def raw(f,k): return float(f.get(k,0))+float(f.get(k+'_Frac',0))/100000

def ellipse(cx,cy,rx,ry,start,sweep):
    steps=max(1,math.ceil(abs(sweep)*180/math.pi))
    return [(cx+rx*math.cos(start+sweep*i/steps),cy+ry*math.sin(start+sweep*i/steps)) for i in range(steps+1)]

def source_curve(f,convert):
    kind=f.get('RECORD')
    if kind=='12':
        start=math.radians(float(f.get('StartAngle',0)));end=math.radians(float(f.get('EndAngle',360)))
        sweep=(end-start)%(2*math.pi) or 2*math.pi
        radius=raw(f,'Radius')
        points=ellipse(raw(f,'Location.X'),raw(f,'Location.Y'),radius,radius,start,sweep)
    elif kind=='10':
        x1,x2=sorted((raw(f,'Location.X'),raw(f,'Corner.X'))); y1,y2=sorted((raw(f,'Location.Y'),raw(f,'Corner.Y')))
        rx=min(abs(raw(f,'CornerXRadius')),(x2-x1)/2);ry=min(abs(raw(f,'CornerYRadius')),(y2-y1)/2)
        points=[]
        for cx,cy,start in [(x2-rx,y2-ry,0),(x1+rx,y2-ry,90),(x1+rx,y1+ry,180),(x2-rx,y1+ry,270)]:
            points+=ellipse(cx,cy,rx,ry,math.radians(start),math.pi/2)
        points.append(points[0])
    else:return None
    return [convert(*p) for p in points]

def target_curve(primitive,world):
    kind=tag(primitive)
    if kind=='polyline':
        pts=child(primitive,'pts') or []
        return [world(float(p[1]),float(p[2])) for p in pts if tag(p)=='xy']
    if kind=='rectangle':
        a,b=child(primitive,'start'),child(primitive,'end')
        return [world(float(x),float(y)) for x,y in [(a[1],a[2]),(b[1],a[2]),(b[1],b[2]),(a[1],b[2]),(a[1],a[2])]]
    if kind=='circle':
        c,r=child(primitive,'center'),child(primitive,'radius')
        return [world(*p) for p in ellipse(float(c[1]),float(c[2]),float(r[1]),float(r[1]),0,2*math.pi)]
    if kind!='arc':return None
    points=[child(primitive,k) for k in ('start','mid','end')]
    if not all(points):return None
    (ax,ay),(bx,by),(cx,cy)=[(float(p[1]),float(p[2])) for p in points]
    d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by))
    if abs(d)<1e-14:return None
    aa,bb,cc=ax*ax+ay*ay,bx*bx+by*by,cx*cx+cy*cy
    ox=(aa*(by-cy)+bb*(cy-ay)+cc*(ay-by))/d;oy=(aa*(cx-bx)+bb*(ax-cx)+cc*(bx-ax))/d
    start=math.atan2(ay-oy,ax-ox);mid=math.atan2(by-oy,bx-ox);end=math.atan2(cy-oy,cx-ox)
    sweep=(end-start)%(2*math.pi)
    if (mid-start)%(2*math.pi)>sweep:sweep-=2*math.pi
    radius=math.hypot(ax-ox,ay-oy)
    return [world(*p) for p in ellipse(ox,oy,radius,radius,start,sweep)]

def distance_to_path(point,path):
    best=math.inf
    px,py=point
    for a,b in zip(path,path[1:]):
        dx,dy=b[0]-a[0],b[1]-a[1];norm=dx*dx+dy*dy
        t=max(0,min(1,((px-a[0])*dx+(py-a[1])*dy)/norm)) if norm else 0
        best=min(best,(px-a[0]-t*dx)**2+(py-a[1]-t*dy)**2)
    return math.sqrt(best)

def path_distance(a,b):
    if len(a)<2 or len(b)<2:return math.inf
    return max(max(distance_to_path(p,b) for p in a),max(distance_to_path(p,a) for p in b))

def match_curves(records,primitives,convert,world,tolerance=.01):
    targets={i:target_curve(p,world) for i,p in enumerate(primitives)}
    used=set();rows=[]
    for record in records:
        source=source_curve(record['fields'],convert)
        if source is None:continue
        # A bounding-box prefilter avoids quadratic work on unrelated artwork.
        bounds=lambda p:(min(x[0] for x in p),min(x[1] for x in p),max(x[0] for x in p),max(x[1] for x in p))
        sb=bounds(source);scores=[]
        for i,target in targets.items():
            if i in used or not target:continue
            if max(abs(x-y) for x,y in zip(sb,bounds(target)))>.5:continue
            scores.append((path_distance(source,target),i))
        deviation,index=min(scores,default=(math.inf,None))
        matched=deviation<=tolerance
        if matched:used.add(index)
        rows.append({'record':record['index'],'nativeType':record['fields']['RECORD'],'match':matched,
                     'maxDeviationMm':deviation if math.isfinite(deviation) else None,
                     'nativeStartMm':source[0],'nativeEndMm':source[-1],
                     'outputStartMm':targets[index][0] if index is not None else None,
                     'outputEndMm':targets[index][-1] if index is not None else None})
    return used,rows
