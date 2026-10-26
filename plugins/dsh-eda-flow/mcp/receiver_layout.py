"""Relative placement for an evidenced receiver, RC supply filter and pull-up.
Recognized by connectivity and symbol roles, never by reference names or old CAD.
"""
import math

from functional_groups import _is_kind, _kind


def _point(pin_key, positions, pinmap):
    """Return a pin connection point after its component is translated."""
    ref = pin_key.rsplit('.', 1)[0]
    x, y = positions[ref]
    px, py = pinmap[pin_key]['pos']
    return [round(x + px, 4), round(y + py, 4)]


def _terminal(component, net_name, netof):
    """Find the unique terminal of *component* that belongs to a net."""
    matches = [
        component['ref'] + '.' + str(pin['number'])
        for pin in component.get('pins', [])
        if netof.get(component['ref'] + '.' + str(pin['number'])) == net_name
    ]
    return matches[0] if len(matches) == 1 else None


def _axis_direction(pinmap, key):
    direction = pinmap.get(key, {}).get('direction')
    return tuple(direction) if direction in ([1, 0], [-1, 0], [0, 1], [0, -1]) else None


def _clean_polyline(points):
    """Drop duplicate/collinear points and keep every segment orthogonal."""
    result = []
    for point in points:
        point = [round(float(point[0]), 4), round(float(point[1]), 4)]
        if result and point == result[-1]:
            continue
        if result and result[-1][0] != point[0] and result[-1][1] != point[1]:
            # A malformed or legacy caller may provide a diagonal pair.  Add
            # a deterministic horizontal-first bend so native wires never
            # serialize a diagonal return (which is easy to mistake for a
            # different route and fails the schematic readability audit).
            bend = [point[0], result[-1][1]]
            if bend != result[-1] and bend != point:
                result.append(bend)
        result.append(point)
        while len(result) >= 3:
            a, b, c = result[-3:]
            if (a[0] == b[0] == c[0]) or (a[1] == b[1] == c[1]):
                result.pop(-2)
            else:
                break
    return result


def _edge(points, net_name):
    points = _clean_polyline(points)
    if len(points) < 2:
        return None
    section = {
        'startPoint': {'x': points[0][0], 'y': points[0][1]},
        'endPoint': {'x': points[-1][0], 'y': points[-1][1]},
    }
    if len(points) > 2:
        section['bendPoints'] = [
            {'x': point[0], 'y': point[1]} for point in points[1:-1]
        ]
    return {'net': net_name, 'sections': [section]}


def _grid_toward_receiver(value, receiver_value, side, step=1.27):
    """Quantize a riser toward the receiver without moving its pin anchor."""
    scaled = float(value) / step
    if side > 0:
        snapped = math.floor(scaled + 1e-9) * step
        return round(max(receiver_value, snapped), 4)
    snapped = math.ceil(scaled - 1e-9) * step
    return round(min(receiver_value, snapped), 4)


def _vertical_hits_body(x, y1, y2, ref, positions, specs):
    """Whether a proposed vertical wire crosses a symbol body."""
    spec = specs.get(ref, {})
    # ``_low``/width/height include the outward port and label reserve used by
    # ELK.  Treating that reserve as a solid obstacle makes a source pin that
    # is already on the body's edge take an unnecessary U-shaped detour.  The
    # content envelope includes the actual body and visible fields while
    # retaining the field clearance contract; older callers without that
    # metadata still use the complete spec envelope.
    low = spec.get('_content_low', spec.get('_low', [0, 0]))
    content_high = spec.get('_content_high')
    high = content_high if content_high is not None else [
        low[0] + spec.get('width', 0), low[1] + spec.get('height', 0)
    ]
    ox, oy = positions[ref]
    left, right = ox + low[0], ox + high[0]
    top, bottom = oy + low[1], oy + high[1]
    return left < x < right and max(top, min(y1, y2)) < min(bottom, max(y1, y2))


def _place_compact_no_connector(
    group,
    hub,
    cap,
    supply_series,
    pull,
    output_series,
    design,
    specs,
    pinmap,
    gap,
):
    """Place the receiver's four local branches from topology and pin roles.

    This motif deliberately only handles a receiver, one supply filter
    resistor, one output series resistor, one pull-up/down resistor and a
    two-terminal bypass bank. Multiple bypasses require explicit common load
    ownership. A connector or an ambiguous branch makes
    the caller fall back to the generic router.  All locations are derived
    from the current symbol pin directions and body envelopes; no reference,
    net-name or source-CAD coordinate is used.
    """
    if not cap or supply_series is None or pull is None or output_series is None:
        return None

    netof = {
        component_pin: net['name']
        for net in design.get('nets', [])
        for component_pin in net.get('nodes', [])
    }
    receiver_ref = hub['ref']
    from functional_groups import decoupling_hints
    owned = decoupling_hints(design).get(receiver_ref, {})
    local_returns = all(c['ref'] in owned for c in cap)
    if len(cap) > 1 and not local_returns:
        return None
    # Parallel equal-role branches have no electrical order. Stable geometry
    # and value ordering makes serialization order irrelevant; references only
    # break ties between geometrically interchangeable parts.
    cap = sorted(cap, key=lambda c: (specs[c['ref']]['width'], specs[c['ref']]['height'], str(c.get('value', '')), c['ref']))
    receiver_pins = {
        str(pin['name']).upper(): receiver_ref + '.' + str(pin['number'])
        for pin in hub.get('pins', [])
    }
    if not {'VCC', 'GND', 'OUT'} <= receiver_pins.keys():
        return None
    vcc_pin, gnd_pin, out_pin = (receiver_pins[name] for name in ('VCC', 'GND', 'OUT'))
    receiver_direction = _axis_direction(pinmap, out_pin)
    if receiver_direction not in ((1, 0), (-1, 0)):
        return None
    side = receiver_direction[0]
    if any(_axis_direction(pinmap, key) != (side, 0) for key in (vcc_pin, gnd_pin)):
        return None

    def net_for(key):
        return netof.get(key)

    supply_net = net_for(vcc_pin)
    ground_net = net_for(gnd_pin)
    output_net = net_for(out_pin)
    if not supply_net or not ground_net or not output_net:
        return None

    supply_in = _terminal(supply_series, supply_net, netof)
    supply_source = next(
        (
            supply_series['ref'] + '.' + str(pin['number'])
            for pin in supply_series.get('pins', [])
            if supply_series['ref'] + '.' + str(pin['number']) != supply_in
        ),
        None,
    )
    output_in = _terminal(output_series, output_net, netof)
    output_out = next(
        (
            output_series['ref'] + '.' + str(pin['number'])
            for pin in output_series.get('pins', [])
            if output_series['ref'] + '.' + str(pin['number']) != output_in
        ),
        None,
    )
    pull_out = _terminal(pull, output_net, netof)
    pull_supply = next(
        (
            pull['ref'] + '.' + str(pin['number'])
            for pin in pull.get('pins', [])
            if pull['ref'] + '.' + str(pin['number']) != pull_out
        ),
        None,
    )
    cap_supply = _terminal(cap[0], supply_net, netof)
    cap_ground = _terminal(cap[0], ground_net, netof)
    cap_terminals = [(_terminal(c, supply_net, netof), _terminal(c, ground_net, netof)) for c in cap]
    terminals = (supply_in, supply_source, output_in, output_out, pull_out, pull_supply, *(key for pair in cap_terminals for key in pair))
    if any(key is None for key in terminals):
        return None
    bias_net = net_for(pull_supply)
    if bias_net not in (supply_net, net_for(supply_source)):
        return None

    # The receiver-facing terminals of the horizontal parts must actually
    # face the receiver.  This keeps the helper safe when a model chooses a
    # vertical resistor or a reversed capacitor symbol.
    if _axis_direction(pinmap, supply_in) != (side, 0) or _axis_direction(pinmap, supply_source) != (-side, 0):
        return None
    if _axis_direction(pinmap, output_in) != (-side, 0) or _axis_direction(pinmap, output_out) != (side, 0):
        return None
    if any(_axis_direction(pinmap, a) != (-side, 0) or _axis_direction(pinmap, b) != (side, 0) for a, b in cap_terminals):
        return None
    pull_output_direction = _axis_direction(pinmap, pull_out)
    pull_supply_direction = _axis_direction(pinmap, pull_supply)
    if pull_output_direction not in ((0, 1), (0, -1)) or pull_supply_direction != (0, -pull_output_direction[1]):
        return None

    # The group is intentionally strict: an unrecognised extra component or
    # connector must use the normal topology/ELK path rather than get silently
    # folded into this local motif.
    expected = {
        receiver_ref,
        *(c['ref'] for c in cap),
        supply_series['ref'],
        pull['ref'],
        output_series['ref'],
    }
    if set(group.get('references', [])) != expected:
        return None

    positions = {receiver_ref: [0.0, 0.0]}
    receiver_out = _point(out_pin, positions, pinmap)
    receiver_vcc = _point(vcc_pin, positions, pinmap)
    receiver_gnd = _point(gnd_pin, positions, pinmap)
    spacing = max(float(gap or 0), 5.08)

    # Keep the pull-up output on the receiver's OUT row.  The series resistor
    # follows it on the same row; this removes the U-shaped return produced by
    # a generic layered layout when the pull-up is vertical.
    pull_x = receiver_out[0] + side * max(12.7, spacing + 5.08)
    pull_output_target = [pull_x, receiver_out[1]]
    positions[pull['ref']] = [
        pull_output_target[0] - pinmap[pull_out]['pos'][0],
        pull_output_target[1] - pinmap[pull_out]['pos'][1],
    ]

    output_x = pull_x + side * max(12.7, spacing + 5.08)
    output_target = [output_x, receiver_out[1]]
    positions[output_series['ref']] = [
        output_target[0] - pinmap[output_in]['pos'][0],
        output_target[1] - pinmap[output_in]['pos'][1],
    ]
    output_end = _point(output_out, positions, pinmap)

    # Place the supply filter on the VCC row, with its source terminal above
    # the pull branch's x coordinate.  The capacitor supply pin shares that
    # row and its return pin drops to the receiver ground row after the signal
    # series resistor, so the return drop cannot cross the OUT branch.
    filter_y = receiver_vcc[1] - max(7.62, spacing)
    supply_filter_target = [pull_x + side * max(7.62, spacing), filter_y]
    positions[supply_series['ref']] = [
        supply_filter_target[0] - pinmap[supply_in]['pos'][0],
        supply_filter_target[1] - pinmap[supply_in]['pos'][1],
    ]
    if bias_net == supply_net:
        # A local-rail pull-up needs its own vertical tap, not a connection to
        # the upstream filter terminal. Move the filter beyond the pull's
        # measured field envelope so that tap cannot touch the upstream pin.
        pull_spec, filter_spec = specs[pull['ref']], specs[supply_series['ref']]
        pull_edge = (pull_spec.get('_content_high', [pull_spec['width'], 0])[0] if side > 0
                     else pull_spec.get('_content_low', pull_spec.get('_low', [0, 0]))[0])
        filter_edge = (filter_spec.get('_content_low', filter_spec.get('_low', [0, 0]))[0] if side > 0
                       else filter_spec.get('_content_high', [filter_spec['width'], 0])[0])
        target = positions[pull['ref']][0] + pull_edge + side * spacing - filter_edge
        positions[supply_series['ref']][0] = side * math.ceil(side * target / 1.27) * 1.27
        supply_filter_target = _point(supply_in, positions, pinmap)
    source_point = _point(supply_source, positions, pinmap)
    supply_point = _point(supply_in, positions, pinmap)
    cap_supply_target = [
        output_end[0] + side * max(12.7, spacing + 5.08),
        receiver_vcc[1],
    ]
    positions[cap[0]['ref']] = [
        cap_supply_target[0] - pinmap[cap_supply]['pos'][0],
        cap_supply_target[1] - pinmap[cap_supply]['pos'][1],
    ]
    cap_ground_point = _point(cap_ground, positions, pinmap)

    # A ground return is kept as one rail.  The vertical capacitor lead is
    # after the output series component, leaving the signal corridor clear.
    # The short horizontal lead first leaves the capacitor on its actual pin
    # direction; this matters for label placement and avoids making a wire
    # terminate on the side of a horizontal capacitor symbol.
    cap_ground_lead = [
        cap_ground_point[0] + pinmap[cap_ground]['direction'][0] * 2.54,
        cap_ground_point[1] + pinmap[cap_ground]['direction'][1] * 2.54,
    ]
    ground_target = [cap_ground_lead[0], receiver_gnd[1]]

    pull_supply_point = _point(pull_supply, positions, pinmap)
    # Keep the source rail on the outward side of the filter resistor.  Going
    # through the resistor's body would visually (and electrically) short its
    # two terminals, so the corridor is chosen behind the source-facing pin.
    corridor_x = source_point[0] - side * max(7.62, spacing)
    if not _vertical_hits_body(
        source_point[0], source_point[1], pull_supply_point[1], pull['ref'], positions, specs
    ) and abs(source_point[0] - pull_supply_point[0]) < 0.001:
        source_points = [source_point, pull_supply_point]
    else:
        source_points = [source_point, [corridor_x, source_point[1]], [corridor_x, pull_supply_point[1]], pull_supply_point]

    # Route the shared VCC rail above both the filter resistor and the pull
    # branch.  A rail on the receiver VCC row would pass through the vertical
    # pull body; a rail on the filter row would pass through the horizontal
    # filter body.  The outside lane leaves both bodies and the source branch
    # clear, while the short horizontal lead at receiver_vcc keeps label
    # placement supported in the normal pin direction.
    vcc_rail_y = min(filter_y, pull_supply_point[1]) - max(5.08, spacing)
    # Keep the first VCC riser outside the filter's actual body/field content
    # envelope.  The broad ``_low`` port reserve is intentionally ignored:
    # it is routing space, not painted text.  If the field reaches back to
    # the receiver, the riser starts directly at the VCC pin and the explicit
    # short lead below still gives the net label its outward-facing anchor.
    filter_position_x = supply_filter_target[0] - pinmap[supply_in]['pos'][0]
    filter_content = specs.get(supply_series['ref'], {})
    content_low = filter_content.get('_content_low', filter_content.get('_low', [0, 0]))
    content_high = filter_content.get('_content_high')
    if content_high is None:
        content_high = [
            content_low[0] + filter_content.get('width', 0),
            content_low[1] + filter_content.get('height', 0),
        ]
    field_margin = max(0.5, min(1.27, spacing / 2))
    near_filter_edge = filter_position_x + (content_low[0] if side > 0 else content_high[0])
    safe_filter_edge = near_filter_edge - side * field_margin
    candidate_turn_x = pull_x - side * max(5.08, spacing)
    candidate_offset = side * (candidate_turn_x - receiver_vcc[0])
    safe_offset = side * (safe_filter_edge - receiver_vcc[0])
    turn_offset = max(0.0, min(candidate_offset, safe_offset))
    candidate_vcc_turn_x = receiver_vcc[0] + side * turn_offset
    # Quantize the whole riser before constructing any of its segments.  This
    # keeps both sides of the corner on the same 50 mil lattice; it does not
    # independently snap an already-created wire endpoint.  Rounding toward
    # the receiver can only increase field clearance.  If a future symbol's
    # content envelope leaves no legal outward grid point, the pin itself is
    # the safe fallback and the separate label stub still remains available.
    vcc_turn_x = _grid_toward_receiver(
        candidate_vcc_turn_x, receiver_vcc[0], side
    )
    snapped_offset = side * (vcc_turn_x - receiver_vcc[0])
    if snapped_offset > safe_offset + 1e-6 or snapped_offset < -1e-6:
        vcc_turn_x = receiver_vcc[0]
    label_stub_length = max(1.27, min(2.54, spacing / 2))

    # A declared local bypass belongs beside its owner, not beyond the whole
    # output chain. Put it above the local supply trunk using measured bounds.
    # Ground is a shared return: local same-net labels avoid a perimeter loop
    # around the signal output while preserving the frozen electrical graph.
    bank_targets = []
    if local_returns:
        bypass_spec = specs[cap[0]['ref']]
        # The terminal target is not the top-left of the reserved node.
        # A horizontal bypass needs clearance below its painted body/fields,
        # not another full node height (which also contains port reserves).
        # Keep the legacy conservative distance when content bounds are absent.
        below_terminal = bypass_spec['height']
        if '_content_high' in bypass_spec:
            below_terminal = max(
                bypass_spec['_content_high'][1],
                pinmap[cap_supply]['pos'][1],
                pinmap[cap_ground]['pos'][1],
            ) - pinmap[cap_supply]['pos'][1]
        cap_supply_target = [
            receiver_vcc[0] + side * spacing,
            math.floor((vcc_rail_y - below_terminal - spacing) / 1.27) * 1.27,
        ]
        positions[cap[0]['ref']] = [
            cap_supply_target[0] - pinmap[cap_supply]['pos'][0],
            cap_supply_target[1] - pinmap[cap_supply]['pos'][1],
        ]
        bank_targets.append(cap_supply_target)
        for previous, current, (supply_key, ground_key) in zip(cap, cap[1:], cap_terminals[1:]):
            previous_spec, current_spec = specs[previous['ref']], specs[current['ref']]
            previous_low = previous_spec.get('_content_low', previous_spec.get('_low', [0, 0]))[1]
            current_low = current_spec.get('_low', [0, 0])[1]
            current_high = current_spec.get('_content_high', [0, current_low + current_spec['height']])[1]
            top = positions[previous['ref']][1] + min(previous_low, *(pinmap[previous['ref']+'.'+str(p['number'])]['pos'][1] for p in previous['pins']))
            bottom = max(current_high, pinmap[supply_key]['pos'][1], pinmap[ground_key]['pos'][1])
            positions[current['ref']] = [
                cap_supply_target[0] - pinmap[supply_key]['pos'][0],
                math.floor((top - spacing - bottom) / 1.27) * 1.27,
            ]
            bank_targets.append(_point(supply_key, positions, pinmap))

    supply_trunk_end = [supply_point[0], vcc_rail_y] if local_returns else [cap_supply_target[0], vcc_rail_y]
    if bias_net == supply_net:
        source_points = [pull_supply_point, [pull_supply_point[0], vcc_rail_y], supply_trunk_end]

    edges = []
    for points, net_name in (
        ([receiver_out, pull_output_target, output_target], output_net),
        (
            [
                receiver_vcc,
                [vcc_turn_x, receiver_vcc[1]],
                [vcc_turn_x, vcc_rail_y],
                supply_trunk_end,
                *([] if local_returns else [cap_supply_target]),
            ],
            supply_net,
        ),
        ([supply_point, [supply_point[0], vcc_rail_y]], supply_net),
        ([] if local_returns else [receiver_gnd, ground_target, cap_ground_lead, cap_ground_point], ground_net),
        (source_points, bias_net),
    ):
        edge = _edge(points, net_name)
        if edge is not None:
            edges.append(edge)
    if local_returns:
        edges.append(_edge([cap_supply_target, [cap_supply_target[0], vcc_rail_y], supply_trunk_end], supply_net))
        for near, far in zip(bank_targets, bank_targets[1:]):
            edges.append(_edge([near, far], supply_net))
    for points, net_name in (
        (
            [
                receiver_vcc,
                [receiver_vcc[0] + side * label_stub_length, receiver_vcc[1]],
            ],
            supply_net,
        ),
        ([pull_output_target, [
            pull_output_target[0] + pull_output_direction[0] * 2.54,
            pull_output_target[1] + pull_output_direction[1] * 2.54,
        ]], output_net),
        ([pull_supply_point, [
            pull_supply_point[0] + pull_supply_direction[0] * 2.54,
            pull_supply_point[1] + pull_supply_direction[1] * 2.54,
        ]], bias_net),
        ([source_point, [
            source_point[0] + _axis_direction(pinmap, supply_source)[0] * 2.54,
            source_point[1] + _axis_direction(pinmap, supply_source)[1] * 2.54,
        ]], net_for(supply_source)),
        ([] if local_returns else [cap_ground_point, cap_ground_lead], ground_net),
    ):
        edge = _edge(points, net_name)
        if edge is not None:
            edges.append(edge)
    # Ground and supply branches share the explicit capacitor terminal points;
    # draw the drop as part of the ground rail only when it is not already a
    # straight segment in the generated rail.
    if not local_returns and cap_ground_point != ground_target:
        edge = _edge([cap_ground_point, ground_target], ground_net)
        if edge is not None:
            edges.append(edge)

    bounds = []
    for ref, (x, y) in positions.items():
        spec = specs[ref]
        low = spec.get('_low', [0, 0])
        bounds.extend(
            (
                [x + low[0], y + low[1]],
                [x + low[0] + spec.get('width', 0), y + low[1] + spec.get('height', 0)],
            )
        )
    for edge in edges:
        for section in edge['sections']:
            bounds.extend(
                [[section['startPoint']['x'], section['startPoint']['y']], [section['endPoint']['x'], section['endPoint']['y']]]
            )
            bounds.extend([[point['x'], point['y']] for point in section.get('bendPoints', [])])
    if not bounds:
        return None
    left = min(point[0] for point in bounds) - 5.08
    top = min(point[1] for point in bounds) - 5.08
    right = max(point[0] for point in bounds) + 5.08
    bottom = max(point[1] for point in bounds) + 5.08
    return {
        'localReturns': local_returns,
        'id': group['id'],
        'width': right - left,
        'height': bottom - top,
        'children': [
            {
                'id': ref,
                'x': position[0] + specs[ref].get('_low', [0, 0])[0] - left,
                'y': position[1] + specs[ref].get('_low', [0, 0])[1] - top,
            }
            for ref, position in positions.items()
        ],
        'edges': [
            {
                **edge,
                'sections': [
                    {
                        **section,
                        'startPoint': {
                            'x': section['startPoint']['x'] - left,
                            'y': section['startPoint']['y'] - top,
                        },
                        'endPoint': {
                            'x': section['endPoint']['x'] - left,
                            'y': section['endPoint']['y'] - top,
                        },
                        **(
                            {
                                'bendPoints': [
                                    {'x': point['x'] - left, 'y': point['y'] - top}
                                    for point in section.get('bendPoints', [])
                                ]
                            }
                            if section.get('bendPoints')
                            else {}
                        ),
                    }
                    for section in edge.get('sections', [])
                ],
            }
            for edge in edges
        ],
    }


def place(group, design, resources, specs, pinmap, gap, parts=None):
    comps={c['ref']:c for c in design['components'] if c['ref'] in group['references']}
    kind=lambda c:_kind(c,resources)
    hubs=[c for c in comps.values() if _is_kind(kind(c),'specified-receiver','infrared-receiver')]
    if len(hubs)!=1:return None
    hub=hubs[0];ref=hub['ref'];netof={p:n['name'] for n in design['nets'] for p in n['nodes']}
    pins={p['name'].upper():ref+'.'+p['number'] for p in hub['pins']}
    if not {'VCC','GND','OUT'}<=pins.keys():return None
    v,g,o=[pins[k] for k in ('VCC','GND','OUT')]
    if any(pinmap[k]['direction']!=[1,0] for k in (v,g,o)):return None
    cap=[];series=[];pull=[];output_series=[];connectors=[]
    def terminals(c):return {netof.get(c['ref']+'.'+p['number']):c['ref']+'.'+p['number'] for p in c['pins']}
    for c in comps.values():
        if c is hub:continue
        if len(c['pins'])>2 and (
            _is_kind(kind(c),'connector')
            or kind(c)=='specified-box'
            or c.get('componentKind')=='connector'
        ):
            connectors.append(c);continue
        if len(c['pins'])!=2:return None
        terms=terminals(c);nets=set(terms)
        if _is_kind(kind(c),'specified-capacitor','capacitor') and nets=={netof[v],netof[g]}:cap.append(c)
        elif _is_kind(kind(c),'specified-resistor','resistor') and netof[o] in nets and netof[g] not in nets:
            pull.append(c)
        elif _is_kind(kind(c),'specified-resistor','resistor') and netof[v] in nets and netof[g] not in nets:series.append(c)
        else:return None
    if len(series)!=1 or not cap:return None
    series=series[0];st=terminals(series)
    source=set(st)-{netof[v]}
    if len(source)!=1:return None
    supply=next(iter(source))

    # A resistor from OUT to a non-rail endpoint is the output series link;
    # a resistor from OUT to a powered rail is the pull-up/down branch.  The
    # distinction uses the frozen pin roles and net membership, so changing
    # references or resistor values does not change the motif.
    powered_nets={
        net['name']
        for net in design.get('nets',[])
        if any(
            str(pin.get('type','')).lower() in ('power_in','power_out')
            for node in net.get('nodes',[])
            if node.rsplit('.',1)[0] in comps
            for component in [comps[node.rsplit('.',1)[0]]]
            for pin in component.get('pins',[])
            if node == component['ref']+'.'+str(pin.get('number'))
        )
    }
    for resistor in pull:
        terms=terminals(resistor);other=set(terms)-{netof[o]}
        if len(other)!=1:return None
        other_net=next(iter(other))
        if other_net not in powered_nets and other_net!=supply:
            output_series.append(resistor)
    pull=[resistor for resistor in pull if resistor not in output_series]
    if len(output_series)>1 or len(pull)!=1:return None
    pull=pull[0];pt=terminals(pull)
    if set(pt) not in ({netof[o],supply},{netof[o],netof[v]}):return None
    if len(connectors)>1:return None
    connector=connectors[0] if connectors else None
    output_link=None
    if output_series:
        output_link=output_series[0]
        output_terms=terminals(output_link)
        output_net=next(iter(set(output_terms)-{netof[o]}),None)
        if output_net is None:return None
    else:
        output_net=netof[o]
    if connector:
        ct=terminals(connector)
        if len(ct)!=len(connector['pins']) or not {supply,netof[g],output_net}<=ct.keys():return None
        if any(pinmap[k]['direction']!=[-1,0] for k in ct.values()):return None
    if output_link is not None and connector is None:
        compact = _place_compact_no_connector(
            group,
            hub,
            cap,
            series,
            pull,
            output_link,
            design,
            specs,
            pinmap,
            gap,
        )
        if compact is not None:
            return compact
        return None
    if output_link is not None:
        return None
    if supply not in pt:return None
    si,so,pi,po=st[netof[v]],st[supply],pt[supply],pt[netof[o]]
    if [pinmap[k]['direction'] for k in (si,so,pi,po)]!=[[-1,0],[1,0],[0,-1],[0,1]]:return None
    for c in cap:
        t=terminals(c)
        if pinmap[t[netof[v]]]['direction']!=[0,-1] or pinmap[t[netof[g]]]['direction']!=[0,1]:return None
    step=1.27;up=lambda n:math.ceil(n/step)*step
    vx,vy=pinmap[v]['pos'];gx,gy=pinmap[g]['pos'];ox,oy=pinmap[o]['pos']
    rail_y=min(vy,oy,gy)-20.32;cap_y=(rail_y+gy)/2
    trunk_x=vx+up(max(12.7,len(netof[v])*.92+7.62))
    positions={ref:[0,0]};cap_x=trunk_x+7.62
    for c in cap:
        if parts is not None:
            from design_audit import child,children
            from native_resources import Atom as A
            for field in children(parts[c['ref']],'property'):
                if field[1] not in ('Reference','Value'):continue
                child(field,'at')[1:]=[A(str(-3.81 if field[1]=='Reference' else 3.81)),A('0'),A('90')]
                eff=child(field,'effects');eff[:]=[v for v in eff if not isinstance(v,list) or v[0]!='justify']
            half=max(len(c['value'])*1.15/2,7.62)
            specs[c['ref']]['_low']=[-5.08,-half];specs[c['ref']]['width']=10.16;specs[c['ref']]['height']=2*half
        positions[c['ref']]=[cap_x,cap_y]
        cap_x+=up(max(10.16,gap+5.08) if parts is not None else max(15.24,len(c['value'])*.92+gap+5.08))
    sx=cap_x+5.08;positions[series['ref']]=[sx,rail_y-pinmap[si]['pos'][1]]
    def point(k):
        x,y=positions[k.rsplit('.',1)[0]];px,py=pinmap[k]['pos'];return [round(x+px,4),round(y+py,4)]
    pull_x=point(so)[0]+15.24
    positions[pull['ref']]=[pull_x,(rail_y+oy)/2]
    segments=[]
    def line(a,b):
        if a!=b:segments.append((a,b))
    line([vx,vy],[trunk_x,vy]);line([trunk_x,vy],[trunk_x,rail_y]);line([trunk_x,rail_y],point(si))
    line(point(so),[pull_x,rail_y]);line([pull_x,rail_y],point(pi));line(point(po),[pull_x,oy]);line([ox,oy],[pull_x,oy])
    ground_end=max(positions[c['ref']][0] for c in cap)
    line([gx,gy],[ground_end,gy])
    for c in cap:
        t=terminals(c);a,b=point(t[netof[v]]),point(t[netof[g]])
        line(a,[a[0],rail_y]);line(b,[b[0],gy])
    if connector:
        output_pin=ct[netof[o]]
        connector_x=pull_x+40.64
        positions[connector['ref']]=[connector_x-pinmap[output_pin]['pos'][0],oy-pinmap[output_pin]['pos'][1]]
        cp,cg,co=[point(ct[n]) for n in (supply,netof[g],netof[o])]
        # The receiver output and the connector input share a horizontal row.
        # Separate supply/return corridors stay clear of the connector labels.
        supply_x=connector_x-12.7;return_x=connector_x-17.78
        line([pull_x,oy],co)
        line([pull_x,rail_y],[supply_x,rail_y]);line([supply_x,rail_y],[supply_x,cp[1]]);line([supply_x,cp[1]],cp)
        line([ground_end,gy],[return_x,gy]);line([return_x,gy],[return_x,cg[1]]);line([return_x,cg[1]],cg)
    bounds=[]
    for r,(x,y) in positions.items():
        s=specs[r];bounds += [[x+s['_low'][0],y+s['_low'][1]],[x+s['_low'][0]+s['width'],y+s['_low'][1]+s['height']]]
    bounds += [p for segment in segments for p in segment]
    left=min(p[0] for p in bounds)-5.08;top=min(p[1] for p in bounds)-10.16
    right=max(p[0] for p in bounds)+5.08;bottom=max(p[1] for p in bounds)+5.08
    return {'id':group['id'],'width':right-left,'height':bottom-top,
            'children':[{'id':r,'x':x+specs[r]['_low'][0]-left,'y':y+specs[r]['_low'][1]-top} for r,(x,y) in positions.items()],
            'edges':[{'sections':[{'startPoint':{'x':a[0]-left,'y':a[1]-top},'endPoint':{'x':b[0]-left,'y':b[1]-top}}]} for a,b in segments]}
