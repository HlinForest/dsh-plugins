"""Independent checks for native symbol outlines and visible field placement.

The checker compares native absolute coordinates to placed KiCad primitives. It
does not consume the generator's claimed coverage table or fitted per-object
transforms. Only the already validated global sheet translation is accepted.
"""
import collections
import math
from curves import match_curves

def tag(node):
    return str(node[0]) if isinstance(node, list) and node else ''

def children(node, name):
    return [n for n in node if tag(n) == name]

def child(node, name, default=None):
    return next(iter(children(node, name)), default)

def field(node, name, default=''):
    n = child(node, name)
    return n[1] if n and len(n) > 1 else default

def raw(fields, key):
    return float(fields.get(key, 0)) + float(fields.get(key + '_Frac', 0)) / 100000

def hidden(node):
    def is_hide(n):
        return (str(n) == 'hide' if not isinstance(n, list)
                else tag(n) == 'hide' and (len(n) == 1 or str(n[1]) not in ('no', 'false')))
    return any(is_hide(n) for n in node) or any(is_hide(n) for n in child(node, 'effects', []))

def edge(a, b):
    return tuple(sorted((tuple(round(float(v), 5) for v in a),
                         tuple(round(float(v), 5) for v in b))))

def edges(points, close=False):
    result = [edge(a, b) for a, b in zip(points, points[1:]) if edge(a, b)[0] != edge(a, b)[1]]
    if close and points and edge(points[0], points[-1])[0] != edge(points[0], points[-1])[1]:
        result.append(edge(points[0], points[-1]))
    return result

def rect(a, b):
    return edges([a, [b[0], a[1]], b, [a[0], b[1]]], True)

def check_graphics(records, components, schematic, translation, aliases=None):
    aliases = aliases or {}
    tx, ty = translation
    convert = lambda x, y: [x * .254 + tx, -y * .254 + ty]
    by_index = {r['index']: r for r in records}
    symbols = {str(next((p[2] for p in children(s, 'property') if p[1] == 'Reference'), '')): s
               for s in children(schematic, 'symbol')}
    libraries = {str(s[1]): s for s in children(child(schematic, 'lib_symbols', []), 'symbol')}
    outline_rows, field_rows, unsupported, curve_rows = [], [], [], []
    content_points=[]
    text_styles=[];style_differences=[]
    font_table=next((r['fields'] for r in records if r['fields'].get('RECORD')=='31'),{})
    def inspect_style(fields,obj,identifier,extra_angle=0):
        fid=str(fields.get('FontID',font_table.get('SystemFont',1)))
        name=font_table.get('FontName'+fid)
        if not name:return
        font=child(child(obj,'effects',[]),'font',[]);at=child(obj,'at',[])
        actual_face=str(field(font,'face','KiCad Font'))
        native_angle=float(fields['Orientation'])*90 if 'Orientation' in fields else float(font_table.get('Rotation'+fid,0))
        actual_angle=(float(at[3]) if len(at)>3 else 0)+extra_angle
        def flag(key):return any(str(v)==key for v in font if not isinstance(v,list)) or str(field(font,key,'no'))=='yes'
        native_bold=font_table.get('Bold'+fid)=='T';native_italic=font_table.get('Italic'+fid)=='T'
        row={'object':identifier,'fontId':fid,'expectedFace':name,'actualFace':actual_face,'expectedAngle':native_angle%360,'actualAngle':actual_angle%360,
             'expectedBold':native_bold,'actualBold':flag('bold'),'expectedItalic':native_italic,'actualItalic':flag('italic'),
             'nativePointSize':font_table.get('Size'+fid),'outputFontMm':child(font,'size',[])[1:]}
        text_styles.append(row)
        if actual_face!=name or abs((actual_angle-native_angle+180)%360-180)>.001 or flag('bold')!=native_bold or flag('italic')!=native_italic:style_differences.append(row)
    native_text = collections.Counter()
    actual_text = collections.Counter()
    text_nodes={}
    # Sheet-level literal texts have absolute sheet coordinates.
    for text in children(schematic, 'text'):
        at = child(text, 'at')
        if at and not hidden(text):
            content_points.append([float(at[1]),float(at[2])])
            actual_text[(str(text[1]), round(float(at[1]), 5), round(float(at[2]), 5))] += 1
            text_nodes.setdefault((str(text[1]),round(float(at[1]),5),round(float(at[2]),5)),[]).append((text,0))
    for record in records:
        f = record['fields']
        if f.get('RECORD') == '4' and f.get('IsHidden') != 'T':
            x, y = convert(raw(f, 'Location.X'), raw(f, 'Location.Y'))
            native_text[(f.get('%UTF8%Text', f.get('Text', '')), round(x, 5), round(y, 5))] += 1
    expected_total = actual_total = 0
    for component in components:
        ref = component['reference']
        symbol = symbols.get(aliases.get(ref, ref))
        if symbol is None:
            continue  # Missing components are independently reported.
        at = child(symbol, 'at', [None, 0, 0, 0])
        content_points.append([float(at[1]),float(at[2])])
        angle = math.radians(float(at[3]) if len(at) > 3 else 0)
        mirror = str(field(symbol, 'mirror', ''))
        def world(x, y):
            # KiCad library coordinates are Y-up, placed sheet coordinates Y-down.
            if mirror == 'x': y = -y
            elif mirror == 'y': x = -x
            return [float(at[1]) + x * math.cos(angle) - y * math.sin(angle),
                    float(at[2]) - x * math.sin(angle) - y * math.cos(angle)]
        lib = libraries.get(str(field(symbol, 'lib_id')), [])
        unit = str(field(symbol, 'unit', 1))
        actual_edges = []
        active_records=[]
        current_part = str(component.get('raw_fields', {}).get('CurrentPartId', '1'))
        for index in component.get('owned_record_indices', []):
            record=by_index.get(index)
            if record and record['fields'].get('OwnerPartId','-1') in ('-1','0',current_part):active_records.append(record)
        primitives=[]
        for body in children(lib, 'symbol'):
            suffix = str(body[1]).rsplit('_', 2)
            if len(suffix) != 3 or suffix[-2] not in ('0', unit) or suffix[-1] not in ('0', '1'):
                continue
            primitives.extend(body[2:])
        curve_indices,curve_results=match_curves(active_records,primitives,convert,world)
        from curves import target_curve
        for primitive in primitives:
            path=target_curve(primitive,world)
            if path:content_points.extend(path)
        curve_rows.extend(dict(reference=ref,**r) for r in curve_results)
        for index,primitive in enumerate(primitives):
                if index in curve_indices:continue
                kind = tag(primitive)
                if kind == 'rectangle':
                    start, end = child(primitive, 'start'), child(primitive, 'end')
                    if start and end:
                        corners = [[start[1], start[2]], [end[1], start[2]], [end[1], end[2]], [start[1], end[2]]]
                        actual_edges += edges([world(float(x), float(y)) for x, y in corners], True)
                elif kind == 'polyline':
                    points = [world(float(p[1]), float(p[2])) for p in children(child(primitive, 'pts', []), 'xy')]
                    actual_edges += edges(points)
                elif kind == 'text' and not hidden(primitive):
                    p = child(primitive, 'at')
                    if p:
                        x, y = world(float(p[1]), float(p[2]))
                        actual_text[(str(primitive[1]), round(x, 5), round(y, 5))] += 1
                        text_nodes.setdefault((str(primitive[1]),round(x,5),round(y,5)),[]).append((primitive,float(at[3]) if len(at)>3 else 0))
        expected_edges = []
        props = {str(p[1]): p for p in children(symbol, 'property')}
        current_part = str(component.get('raw_fields', {}).get('CurrentPartId', '1'))
        for index in component.get('owned_record_indices', []):
            record = by_index.get(index)
            if not record:
                continue
            f, kind = record['fields'], record['fields'].get('RECORD')
            owner_part = f.get('OwnerPartId', '-1')
            if owner_part not in ('-1', '0', current_part):
                continue
            if kind in ('6', '7'):
                points = [convert(raw(f, 'X' + str(i)), raw(f, 'Y' + str(i))) for i in range(1, int(f.get('LocationCount', 0)) + 1)]
                expected_edges += edges(points, kind == '7')
            elif kind in ('13', '14'):
                start = convert(raw(f, 'Location.X'), raw(f, 'Location.Y'))
                end = convert(raw(f, 'Corner.X'), raw(f, 'Corner.Y'))
                expected_edges += rect(start, end) if kind == '14' else [edge(start, end)]
            elif kind in ('5', '8', '9', '11'):
                unsupported.append({'reference': ref, 'record': index, 'type': kind})
            elif kind in ('34', '41'):
                name = f.get('%UTF8%Name', f.get('Name', ''))
                key = {'Designator': 'Reference', 'Comment': 'Value'}.get(name, name)
                prop = props.get(key)
                if prop is None:
                    continue  # The parameter checker reports absent properties.
                native_hidden = f.get('IsHidden') == 'T'
                actual_hidden = hidden(prop)
                p = child(prop, 'at')
                expected = convert(raw(f, 'Location.X'), raw(f, 'Location.Y'))
                actual = [float(p[1]), float(p[2])] if p else None
                if actual and not actual_hidden:content_points.append(actual)
                if not native_hidden:inspect_style(f,prop,ref+':'+key)
                residual = math.dist(expected, actual) if actual else None
                if native_hidden != actual_hidden or (not native_hidden and (residual is None or residual > .0001)):
                    field_rows.append({'reference': ref, 'field': key, 'record': index,
                                       'expectedHidden': native_hidden, 'actualHidden': actual_hidden,
                                       'expected': expected, 'actual': actual, 'residualMm': residual})
        expected_counter, actual_counter = collections.Counter(expected_edges), collections.Counter(actual_edges)
        expected_total += len(expected_edges); actual_total += len(actual_edges)
        missing, extra = expected_counter - actual_counter, actual_counter - expected_counter
        if missing or extra:
            outline_rows.append({'reference': ref, 'expectedStraightSegments':len(expected_edges),
                                 'actualStraightSegments':len(actual_edges),
                                 'missing':sum(missing.values()), 'extra':sum(extra.values()),
                                 'missingExamples':list(missing.elements())[:4]})
    missing_text, extra_text = native_text - actual_text, actual_text - native_text
    for record in records:
        f=record['fields']
        if f.get('RECORD')!='4' or f.get('IsHidden')=='T':continue
        x,y=convert(raw(f,'Location.X'),raw(f,'Location.Y'));key=(f.get('%UTF8%Text',f.get('Text','')),round(x,5),round(y,5))
        candidates=text_nodes.get(key,[])
        if candidates:
            obj,angle=candidates.pop(0);inspect_style(f,obj,'record:'+str(record['index']),angle)
    paper=child(schematic,'paper',[]);size=None
    if len(paper)>3 and str(paper[1])=='User':size=[float(paper[2]),float(paper[3])]
    elif len(paper)>1:
        size={'A4':[297,210],'A3':[420,297],'A2':[594,420],'A1':[841,594],'A0':[1189,841],'A':[279.4,215.9],'B':[431.8,279.4]}.get(str(paper[1]))
        if size and any(str(p)=='portrait' for p in paper):size=list(reversed(size))
    outside=[p for p in content_points if size and (min(p)<-.001 or p[0]>size[0]+.001 or p[1]>size[1]+.001)]
    return {
        'nativeTextStyle':{'match':not style_differences,'compared':len(text_styles),'differences':style_differences,
                           'limit':'Compares declared source font family, rotation, bold and italic. Source point size and output millimetre size are disclosed, but equivalent font metrics, fallback glyphs and justification require visual review.'},
        'sheetContentBounds':{'match':not outside if size else None,'paperMm':size,'outsidePointCount':len(outside),'outsideExamples':outside[:5],
                              'limit':'Checks geometry and visible text anchors against configured paper. Full text extents, title-block collision and native page-frame equivalence require visual review.'},
        'symbolOutlines': {'match': not outline_rows, 'expectedStraightSegments': expected_total,
                           'actualStraightSegments': actual_total, 'differences':outline_rows,
                           'unverifiedCurvedRecords':unsupported,
                           'limit':'Straight symbol outlines only; curves, fill, stroke, pin glyphs and page furniture need additional validation. Equivalent splitting of line segments may need explicit review.'},
        'symbolCurves': {'match':all(r['match'] for r in curve_rows),'compared':len(curve_rows),'objects':curve_rows,'toleranceMm':.01,
                         'limit':'Native rounded rectangles and circular arcs compared to individual output paths with at most one-degree sampling and bidirectional point-to-segment distance. This bounds an approximation; fill, stroke and arbitrary multi-primitive equivalence are not established.'},
        'visibleFieldPlacement': {'match':not field_rows, 'differences':field_rows,
                                  'limit':'Checks property visibility and visible anchor positions; font metrics/justification/rotation still require separate review.'},
        'graphicTextPlacement': {'match':not missing_text and not extra_text,
                                 'expected':sum(native_text.values()), 'actual':sum(actual_text.values()),
                                 'missing':list(missing_text.elements()), 'extra':list(extra_text.elements()),
                                 'limit':'Exact literal content and sheet anchor multiset, including duplicate text detection. Font appearance is not proven.'}
    }
