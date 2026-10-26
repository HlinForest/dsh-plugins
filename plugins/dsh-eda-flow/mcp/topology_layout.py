"""Topology-first local placement for mixed driver/passive groups.

The generic ELK graph is deliberately conservative, but its node ordering can
turn a driver, several series parts, and input shunts into a tall perimeter
loop.  This module handles the small topology class that has a single
multi-output source and only passive local branches.  It never changes the
electrical graph: it places symbols and asks the existing grid router for
short, obstacle-aware local wires.  Endpoints outside the group are left as
terminal stubs so the caller can attach the ordinary same-net labels.
"""

import collections
import math
import re

import functional_layout as geom
from functional_groups import _is_kind, _is_passive, _kind, decoupling_hints


_RAIL_NAMES = {"GND", "GROUND", "SGND", "AGND", "DGND", "PGND", "VCC", "VDD", "VSS", "VEE"}


def _round(value):
    return round(round(float(value) / 1.27) * 1.27, 4)


def _net_index(design):
    netof = {}
    nodes = collections.defaultdict(list)
    for net in design.get("nets", []):
        name = str(net.get("name") or "")
        for key in net.get("nodes", []):
            netof[str(key)] = name
            nodes[name].append(str(key))
    return netof, nodes


def _shared_return_net(name, design):
    """Return true when a rail is better represented by local labels.

    A driver-side shunt signal is a local functional connection.  Its common
    return rail often spans other groups, so routing every capacitor back to
    the driver creates a page-sized wire bundle.  The frozen supplied-net
    declaration is authoritative; the small conventional-name fallback only
    covers older snapshots that predate that declaration.
    """

    if not name:
        return False
    if name in set(design.get("supplied_nets", [])):
        return True
    return str(name).upper() in _RAIL_NAMES


def _pin_type(components, key):
    ref, number = key.rsplit(".", 1)
    return next(
        (str(pin.get("type") or "").lower() for pin in components[ref].get("pins", []) if str(pin.get("number")) == number),
        "",
    )


def _component_pin_keys(component):
    ref = component["ref"]
    return [ref + "." + str(pin.get("number")) for pin in component.get("pins", [])]


def _source_rank(components, key):
    """Stable root preference for a multi-terminal presentation net."""

    pin_type = _pin_type(components, key)
    if pin_type in {"output", "power_out"}:
        return 0
    ref = key.rsplit(".", 1)[0]
    if len(components[ref].get("pins", [])) > 2:
        return 1
    if pin_type in {"power_in", "input"}:
        return 2
    return 3


def presentation_tree_edges(members, design, netof):
    """Build a deterministic hub/trunk/tap tree for one local net.

    The old generic graph connected ``members`` in their serialized order.
    Sorting alone would make the result deterministic but could still create a
    long chain.  A root chosen from electrical role and a star/tree rooted at
    that terminal gives ELK a local trunk with taps and is invariant to node
    array order.  The frozen net remains a hypernet; this is presentation
    geometry only.
    """

    keys = sorted(set(members))
    if len(keys) < 2:
        return []
    components = {c["ref"]: c for c in design.get("components", [])}
    root = min(keys, key=lambda key: (_source_rank(components, key), key))
    safe = lambda value: re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value))
    net_name = str(netof[root])
    return [
        {
            "id": "presentation-"
            + safe(net_name)
            + "-"
            + safe(root)
            + "-"
            + safe(key),
            "sources": [root],
            "targets": [key],
            "net": netof[key],
        }
        for index, key in enumerate(keys)
        if key != root
    ]


def _driver_candidates(refs, components):
    return [
        ref
        for ref in refs
        if len(components[ref].get("pins", [])) > 2
        and sum(str(pin.get("type") or "").lower() == "output" for pin in components[ref].get("pins", [])) >= 3
    ]


def _terminal_for_net(component, net, netof):
    return [
        component["ref"] + "." + str(pin.get("number"))
        for pin in component.get("pins", [])
        if netof.get(component["ref"] + "." + str(pin.get("number"))) == net
    ]


def _branch_chains(group_refs, driver, design, resources, netof, nodes):
    """Return local signal/feed chains without absorbing parallel shunts."""

    components = {c["ref"]: c for c in design.get("components", [])}
    kinds = {ref: _kind(components[ref], resources) for ref in group_refs}
    passive_refs = {
        ref
        for ref in group_refs
        if ref != driver
        and len(components[ref].get("pins", [])) == 2
        and _is_passive(kinds.get(ref))
    }
    used = set()
    branches = []
    declared = decoupling_hints(design).get(driver, {})
    # A feed into an owned supply domain is a serial branch, while its
    # bypass capacitor is a parallel branch. Never walk through the latter
    # into the return rail when discovering a feed.
    supply_anchors = {relation['anchor'] for relation in declared.values()}
    driver_outputs = [
        driver + "." + str(pin.get("number"))
        for pin in components[driver].get("pins", [])
        if str(pin.get("type") or "").lower() == "output"
        or str(pin.get("type") or "").lower() == "input"
        or driver + "." + str(pin.get("number")) in supply_anchors
    ]
    for source in sorted(driver_outputs):
        eligible = passive_refs - set(declared)
        if _pin_type(components, source) == 'input':
            # A series input resistor and a parallel input capacitor may share
            # this exact net. Reserve only the serial signal path here; the
            # shunt classifier places the capacitor beside its owning input.
            # Bias parts terminating on a supply/return remain shunts too.
            eligible = {ref for ref in eligible
                        if _is_kind(kinds.get(ref), 'resistor', 'inductor', 'ferrite-bead')
                        and not any(_shared_return_net(netof.get(key), design)
                                    for key in _component_pin_keys(components[ref]))}
        if source in supply_anchors:
            eligible = {ref for ref in eligible if _is_kind(kinds.get(ref), 'resistor', 'inductor', 'ferrite-bead')}
        source_net = netof.get(source)
        if not source_net:
            continue
        candidates = []
        for ref in sorted(eligible - used):
            if source_net in {
                netof.get(key) for key in _component_pin_keys(components[ref])
            }:
                candidates.append(ref)
        if len(candidates) > 1:
            # Several passives on the same source net are a branched topology;
            # use the normal graph rather than guessing a serial order.
            return None
        if not candidates:
            continue
        chain = []
        current_net = source_net
        current_source = source
        while True:
            available = [
                ref
                for ref in sorted(eligible - used - {item[0] for item in chain})
                if current_net in {
                    netof.get(key) for key in _component_pin_keys(components[ref])
                }
            ]
            if len(available) != 1:
                if not available:
                    break
                return None
            ref = available[0]
            pins = _component_pin_keys(components[ref])
            source_pin = next(key for key in pins if netof.get(key) == current_net)
            other_pin = next(key for key in pins if key != source_pin)
            chain.append((ref, source_pin, other_pin))
            used.add(ref)
            current_source = other_pin
            next_net = netof.get(other_pin)
            if not next_net:
                break
            current_net = next_net
            # A chain continues only through one passive part on the next net.
            # A non-passive endpoint or an external group boundary terminates
            # the local branch and will be represented by a label stub.
            if _shared_return_net(current_net, design) or any(
                key.rsplit('.', 1)[0] not in eligible
                for key in nodes.get(current_net, [])
                if key != other_pin
            ):
                break
            next_passive = [
                ref
                for ref in sorted(eligible - used - {item[0] for item in chain})
                if current_net in {
                    netof.get(key) for key in _component_pin_keys(components[ref])
                }
            ]
            if len(next_passive) > 1:
                return None
            if not next_passive:
                break
        if chain:
            branches.append({"source": source, "chain": chain})
    return branches, used


def _classify_shunts(group_refs, driver, used, design, resources, netof):
    components = {c["ref"]: c for c in design.get("components", [])}
    kinds = {ref: _kind(components[ref], resources) for ref in group_refs}
    driver_pins = _component_pin_keys(components[driver])
    input_nets = {
        netof.get(key)
        for key in driver_pins
        if _pin_type(components, key) == "input" and netof.get(key)
    }
    return_nets = {
        netof.get(key)
        for key in driver_pins
        if _pin_type(components, key) in {"power_in", "power_out"}
        and netof.get(key)
    }
    declared = decoupling_hints(design).get(driver, {})
    shunts = []
    decouplers = []
    leftovers = set()
    for ref in group_refs:
        if ref == driver or ref in used:
            continue
        component = components[ref]
        if len(component.get("pins", [])) != 2 or not _is_passive(kinds.get(ref)):
            leftovers.add(ref)
            continue
        pins = _component_pin_keys(component)
        nets = {netof.get(key) for key in pins}
        if ref in declared:
            relation = declared[ref]
            anchor = relation["anchor"]
            return_pin = relation["return"]
            anchor_member = next((key for key in pins if netof.get(key) == netof.get(anchor)), None)
            return_member = next((key for key in pins if netof.get(key) == netof.get(return_pin)), None)
            if not anchor_member or not return_member or anchor_member == return_member:
                leftovers.add(ref)
                continue
            decouplers.append((ref, anchor, return_pin, anchor_member, return_member))
            continue
        signal = next((key for key in pins if netof.get(key) in input_nets), None)
        other = next((key for key in pins if key != signal), None)
        if signal and other and netof.get(other) in return_nets:
            shunts.append((ref, signal, other))
        elif len(nets) == 1:
            # Same-net jumpers have their own explicit row motif.
            leftovers.add(ref)
        else:
            leftovers.add(ref)
    return shunts, decouplers, leftovers


def _place_component(positions, ref, pin, target, pinmap):
    local = pinmap[pin]["pos"]
    positions[ref] = [_round(target[0] - local[0]), _round(target[1] - local[1])]


def _branch_row_coordinates(items, desired, axis, specs, pinmap, gap):
    """Keep branch rows on their source pin lines, spreading only collisions."""

    result = {}
    previous_high = None
    # The global group gap protects independent blocks.  Within a dense
    # source-pin bank, measured body/field boxes already include glyph and
    # stroke margins. An additional 20 mil drawing clearance is sufficient;
    # a whole extra text line needlessly offsets parts from their source pin
    # rows and turns every straight signal into a dogleg. Larger envelopes
    # still spread the rows, and the native PDF audit checks actual glyphs.
    row_gap = min(float(gap), .508)
    for branch, wanted in zip(items, desired):
        offsets = []
        for ref, source_pin, _ in branch["chain"]:
            content_low = specs[ref].get("_content_low", specs[ref]["_low"])
            content_high = specs[ref].get(
                "_content_high",
                [
                    specs[ref]["_low"][0] + specs[ref]["width"],
                    specs[ref]["_low"][1] + specs[ref]["height"],
                ],
            )
            low = content_low[axis] - pinmap[source_pin]["pos"][axis]
            high = content_high[axis] - pinmap[source_pin]["pos"][axis]
            offsets.append((low, high))
        branch_low = min(value[0] for value in offsets)
        branch_high = max(value[1] for value in offsets)
        coordinate = float(wanted)
        minimum = None
        if previous_high is not None:
            minimum = previous_high + row_gap - branch_low
            coordinate = max(coordinate, minimum)
        coordinate = _round(coordinate)
        # Nearest-grid rounding must not undo a collision-driven spread.
        if minimum is not None and coordinate < minimum - 1e-6:
            coordinate = _round(coordinate + 1.27)
        result[branch["source"]] = coordinate
        previous_high = coordinate + branch_high
    return result


def _serial_next_target(current_origin, current_low, current_size, end,
                        next_low, next_size, next_pin, side, gap):
    """Return a source-pin target that clears both serial routing boxes."""

    current_edge = current_origin + current_low + (
        current_size if side > 0 else 0
    )
    next_low_relative = next_low - next_pin
    next_high_relative = next_low + next_size - next_pin
    clear_target = (
        current_edge + gap - next_low_relative
        if side > 0
        else current_edge - gap - next_high_relative
    )
    base_target = end + side * (gap + 5.08)
    return _round(
        max(base_target, clear_target)
        if side > 0
        else min(base_target, clear_target)
    )


def _point(positions, pinmap, key, *, port=False):
    ref = key.rsplit(".", 1)[0]
    at = positions[ref]
    local = pinmap[key]["port"] if port else pinmap[key]["pos"]
    # Keep the native pin coordinate through the route handoff.  Symbol pin
    # coordinates can be finer than the 1.27 mm placement grid; rounding them
    # here makes the emitted wire miss the actual pin after generic_layout
    # applies its fine route grid.
    point = [round(float(at[0]) + float(local[0]), 4), round(float(at[1]) + float(local[1]), 4)]
    if port:
        # ``pinmap.port`` is the edge of the reserved symbol/field box.  The
        # visibility router treats a segment that starts exactly on that edge
        # as blocked when floating point rounding leaves an epsilon inside the
        # obstacle.  Add one native grid lead so the route starts in free
        # space and remains aligned with the router grid.
        direction = pinmap[key]["direction"]
        point = [
            round(point[0] + direction[0] * geom.GRID, 4),
            round(point[1] + direction[1] * geom.GRID, 4),
        ]
    return point


def _bounds(positions, refs, specs, pairs, pinmap):
    values = []
    for ref in refs:
        x, y = positions[ref]
        spec = specs[ref]
        values.extend(
            [
                [x + spec["_low"][0], y + spec["_low"][1]],
                [x + spec["_low"][0] + spec["width"], y + spec["_low"][1] + spec["height"]],
            ]
        )
    for a, b in pairs:
        values.extend(
            [
                _point(positions, pinmap, a, port=True),
                _point(positions, pinmap, b, port=True),
            ]
        )
    return [
        min(point[0] for point in values),
        min(point[1] for point in values),
        max(point[0] for point in values),
        max(point[1] for point in values),
    ]


def _input_shunt_array(shunts, input_source, driver_inputs, shunt_side,
                       driver_box, specs, pinmap, gap, branch_rows=(), advance=0):
    """Return a compact, ordered bank for one horizontal input side.

    Input shunts are often vertical two-pin parts.  Placing one on every
    source-pin row makes their measured field envelopes overlap when the
    driver pins are only one grid step apart.  The router then has to lift
    one signal above the next part, producing the large perimeter loops this
    topology path is intended to avoid.  Put the whole bank in one measured
    band outside the source rows instead.  The source-row order is preserved
    in the bank's horizontal order, so the short orthogonal paths do not
    cross another shunt's body or field.

    The returned coordinates are signal-pin targets, not symbol origins.
    All clearances are derived from the actual content envelope and the
    routing envelope supplied by ``specs``; no component or reference names
    participate in the decision.
    """
    if not shunts or not driver_inputs or shunt_side not in {-1, 1}:
        return None

    ordered = sorted(
        shunts,
        key=lambda item: (
            pinmap[input_source[item[0]]]["pos"][1]
            if input_source.get(item[0])
            else float("inf"),
            item[0],
        ),
    )
    if len(ordered) != len(shunts):
        return None

    source_rows = [
        float(pinmap[input_source[item[0]]]["pos"][1])
        for item in ordered
    ]
    row_low = min(source_rows)
    row_high = max(source_rows)

    # The visible body/field envelope determines the bank side.  The routing
    # envelope is considered when choosing between the two sides so a bank
    # does not push a same-side series bank to the far side of the driver.
    content_offsets = []
    route_offsets = []
    for ref, signal, _ in ordered:
        spec = specs[ref]
        content_low = spec.get("_content_low", spec["_low"])
        content_high = spec.get(
            "_content_high",
            [
                spec["_low"][0] + spec["width"],
                spec["_low"][1] + spec["height"],
            ],
        )
        signal_y = float(pinmap[signal]["pos"][1])
        content_offsets.append(
            (
                float(content_low[1]) - signal_y,
                float(content_high[1]) - signal_y,
            )
        )
        route_offsets.append(
            (
                float(spec["_low"][1]) - signal_y,
                float(spec["_low"][1] + spec["height"]) - signal_y,
            )
        )

    # Prefer the nearer side of the source band, but keep the complete router
    # reserve away from same-side output rows.  ``below`` is the natural side
    # for a pin whose body extends away from its signal pin; the symmetric
    # ``above`` candidate keeps other passive orientations valid.
    content_low = min(offset[0] for offset in content_offsets)
    content_high = max(offset[1] for offset in content_offsets)
    route_low = min(offset[0] for offset in route_offsets)
    route_high = max(offset[1] for offset in route_offsets)
    clearance = max(float(gap), 2.54)
    candidates = [
        {
            "side": "below",
            "target_y": _round(row_high + clearance - content_low),
            "distance": abs(row_high + clearance - content_low - row_high),
        },
        {
            "side": "above",
            "target_y": _round(row_low - clearance - content_high),
            "distance": abs(row_low - clearance - content_high - row_low),
        },
    ]
    # A signal pin's mandatory outward lead must end before the input-row
    # corridor. Ending a different net's lead on the first row creates a
    # forbidden T contact and forces the router to bend an otherwise straight
    # input rail. Body-only clearance misses this terminal-access constraint.
    escapes=[float(pinmap[signal].get('port',pinmap[signal]['pos'])[1])
             -float(pinmap[signal]['pos'][1])+float(pinmap[signal]['direction'][1])*geom.GRID
             for _,signal,_ in ordered]
    for item in candidates:
        boundary=(row_low-max(escapes)-geom.GRID if item['side']=='above'
                  else row_high-min(escapes)+geom.GRID)
        # Round away from the signal rows, including finer native pin grids.
        boundary=(math.floor(boundary/1.27)*1.27 if item['side']=='above'
                  else math.ceil(boundary/1.27)*1.27)
        item['target_y']=_round(min(item['target_y'],boundary) if item['side']=='above'
                                else max(item['target_y'],boundary))
    inner_targets = {item['side']: item['target_y'] for item in candidates}

    # A rotated input shunt carries its signal toward the source bank.  Keep
    # that relationship explicit: a signal pin facing down belongs in the
    # above-source band, while a signal pin facing up belongs below it.  The
    # orientation pass selects this direction from topology; this local check
    # also keeps an explicit rotation from silently producing a backwards
    # shunt lead when the opposite side is otherwise clear.
    signal_bands = {
        "above" if pinmap[signal]["direction"][1] > 0 else "below"
        if pinmap[signal]["direction"][1] < 0 else None
        for _, signal, _ in ordered
    }
    preferred_band = next(iter(signal_bands)) if len(signal_bands) == 1 and None not in signal_bands else None

    def branch_conflict(item):
        low = item["target_y"] + route_low
        high = item["target_y"] + route_high
        return sum(low - clearance <= row <= high + clearance for row in branch_rows)

    if preferred_band is not None:
        preferred = next(item for item in candidates if item["side"] == preferred_band)
        # Keep the signal-facing side even when an output row occupies the
        # first candidate band.  Move that complete bank farther outward on
        # the same normal until its routing reserve clears the rows.  This
        # preserves the semantic orientation without letting a branch wire
        # pass through a shunt body.  The bounded loop is only a guard for
        # malformed coordinates; normal native layouts clear in one or two
        # grid steps.
        for _ in range(max(8, len(branch_rows) * 4)):
            if not branch_conflict(preferred):
                break
            delta = -clearance if preferred_band == "above" else clearance
            preferred["target_y"] = _round(preferred["target_y"] + delta)
        if not branch_conflict(preferred):
            candidate = preferred
        else:
            candidate = min(
                candidates,
                key=lambda item: (
                    branch_conflict(item),
                    item["distance"],
                    item["side"] != "below",
                ),
            )
    else:
        candidate = min(
            candidates,
            key=lambda item: (
                branch_conflict(item),
                item["distance"],
                item["side"] != "below",
            ),
        )

    # Candidate search may reclaim some of the conservative routing reserve,
    # but never enter the body/field clearance band. The complete grid router
    # must subsequently prove that the new terminal access remains feasible.
    advance_limit = abs(candidate['target_y'] - inner_targets[candidate['side']])
    amount = min(max(0, float(advance)), advance_limit)
    candidate['target_y'] = _round(candidate['target_y'] + (amount if candidate['side'] == 'above' else -amount))

    # A driver-side bank should stay compact.  When no signal-facing
    # direction is available, avoid the candidate whose routing reserve
    # intersects same-side series rows, then choose the nearer measured band.

    shunt_refs = [item[0] for item in ordered]
    x_offsets = {}
    for ref, signal, _ in ordered:
        spec = specs[ref]
        signal_x = float(pinmap[signal]["pos"][0])
        x_offsets[ref] = (
            float(spec["_low"][0]) - signal_x,
            float(spec["_low"][0] + spec["width"]) - signal_x,
        )
    bank_clearance = max(geom.GRID, min(float(gap), 2.54))
    # The top/bottom order of the bank depends on which side of the source
    # rows it occupies.  A below-source bank maps the top input to the far
    # slot; an above-source bank maps it to the near slot.  Both projections
    # are planar for horizontal source rows and keep the nearest branch short.
    near_to_far = (
        ordered if candidate["side"] == "above" else list(reversed(ordered))
    )
    target_x = {}
    if shunt_side < 0:
        first = near_to_far[0][0]
        target_x[first] = _round(
            driver_box[0] - bank_clearance - x_offsets[first][1]
        )
        for previous, current in zip(near_to_far, near_to_far[1:]):
            previous_ref = previous[0]
            current_ref = current[0]
            target_x[current_ref] = _round(
                target_x[previous_ref]
                + x_offsets[previous_ref][0]
                - bank_clearance
                - x_offsets[current_ref][1]
            )
    else:
        first = near_to_far[0][0]
        target_x[first] = _round(
            driver_box[2] + bank_clearance - x_offsets[first][0]
        )
        for previous, current in zip(near_to_far, near_to_far[1:]):
            previous_ref = previous[0]
            current_ref = current[0]
            target_x[current_ref] = _round(
                target_x[previous_ref]
                + x_offsets[previous_ref][1]
                + bank_clearance
                - x_offsets[current_ref][0]
            )
    shunt_x = target_x[near_to_far[0][0]]

    target_y = {ref: candidate["target_y"] for ref, _, _ in ordered}
    shunt_left = min(
        target_x[ref] + x_offsets[ref][0] for ref in shunt_refs
    )
    shunt_right = max(
        target_x[ref] + x_offsets[ref][1]
        for ref in shunt_refs
    )
    return {
        "side": shunt_side,
        "x": shunt_x,
        "target_x": target_x,
        "target_y": target_y,
        "left": shunt_left,
        "right": shunt_right,
        "bandSide": candidate["side"],
        "sourceRows": source_rows,
        "contentOffsets": content_offsets,
        "routeOffsets": route_offsets,
        "advanceLimit": advance_limit,
    }


def _rowwise_input_shunt_array(shunts, input_source, shunt_side,
                               driver_box, specs, pinmap, gap):
    """Keep fixed-geometry shunts on their corresponding source rows.

    Evidence-backed capacitors may have a prescribed terminal direction and
    field geometry.  They cannot be rotated to satisfy the compact band
    contract, so preserve the older row/column placement for those symbols.
    The column packing still uses the measured body envelope and actual input
    row, rather than reference names or serialized net order.
    """

    if not shunts or shunt_side not in {-1, 1}:
        return None
    shunt_refs = [item[0] for item in shunts]
    if shunt_side < 0:
        max_right = max(
            specs[ref]["_low"][0] + specs[ref]["width"]
            for ref in shunt_refs
        )
        shunt_x = _round(driver_box[0] - gap - max_right)
    else:
        min_left = min(specs[ref]["_low"][0] for ref in shunt_refs)
        shunt_x = _round(driver_box[2] + gap - min_left)

    ordered = sorted(
        shunts,
        key=lambda item: (
            pinmap[input_source[item[0]]]["pos"][1],
            item[0],
        ),
    )
    columns = []
    for ref, signal, _ in ordered:
        local_y = pinmap[signal]["pos"][1]
        low = specs[ref]["_low"][1] - local_y
        high = low + specs[ref]["height"]
        source_y = pinmap[input_source[ref]]["pos"][1]
        interval = (source_y + low, source_y + high)
        column = next(
            (
                candidate
                for candidate in columns
                if all(
                    interval[1] + gap <= other[0]
                    or other[1] + gap <= interval[0]
                    for other in candidate["intervals"]
                )
            ),
            None,
        )
        if column is None:
            column = {"items": [], "intervals": []}
            columns.append(column)
        column["items"].append((ref, signal, _))
        column["intervals"].append(interval)

    column_pitch = _round(max(specs[ref]["width"] for ref in shunt_refs) + gap)
    target_x = {
        ref: _round(
            shunt_x
            + side_index * (-column_pitch if shunt_side < 0 else column_pitch)
        )
        for side_index, column in enumerate(columns)
        for ref, _, _ in column["items"]
    }
    target_y = {
        ref: _round(pinmap[input_source[ref]]["pos"][1])
        for ref, _, _ in ordered
    }
    return {
        "side": shunt_side,
        "x": shunt_x,
        "target_x": target_x,
        "target_y": target_y,
        "left": min(target_x[ref] + specs[ref]["_low"][0] for ref in shunt_refs),
        "right": max(
            target_x[ref] + specs[ref]["_low"][0] + specs[ref]["width"]
            for ref in shunt_refs
        ),
        "bandSide": "rowwise",
    }


def _auto_shunt_orientation_allowed(ref, components, resources):
    """Return whether a shunt may use the topology-selected band orientation."""

    kind = _kind(components[ref], resources)
    if not _is_kind(kind, "capacitor"):
        return False
    # Explicit specified-capacitor geometry includes a prescribed axis and
    # terminal span.  Moving it to the preferred band without rotating the
    # symbol changes the intended presentation; retain the rowwise motif.
    if _is_kind(kind, "specified-capacitor"):
        return False
    # A component owned by a frozen native block is immutable even when its
    # library record happens to be classified as an ordinary capacitor.
    return not any(
        ref in set(block.get("bindings", {}).values())
        for block in (resources or {}).get("blocks", [])
    )


def _signal_corridors(branches, components, driver_box, specs, pinmap, gap, shunt_layout=None):
    """Reserve the source-pin lanes occupied by real serial signal branches."""
    corridors=[]
    for branch in branches:
        key=branch['source']
        if _pin_type(components,key) not in ('input','output'):
            continue
        pin=pinmap[key];direction=pin['direction']
        axis=0 if direction[0] else 1
        sign=direction[axis]
        if not sign:continue
        ref=branch['chain'][0][0]
        reach=specs[ref]['width' if axis==0 else 'height']+2*float(gap)
        edge=driver_box[axis+(2 if sign>0 else 0)]
        end=edge+sign*reach
        if axis==0 and _pin_type(components,key)=='input' and shunt_layout and sign==shunt_layout['side']:
            # Filtered inputs feed through the serial bank outside the taps.
            # Reserve that complete lane, not just a resistor-width stub by
            # the IC: otherwise a power rail looks crossing-free merely by
            # moving beyond the truncated estimate.
            bank_edge=shunt_layout['left' if sign<0 else 'right']
            end=bank_edge+sign*(specs[ref]['width']+2*float(gap))
        cross=float(pin['pos'][1-axis]);half=geom.GRID/2
        corridors.append([min(edge,end),cross-half,max(edge,end),cross+half] if axis==0
                         else [cross-half,min(edge,end),cross+half,max(edge,end)])
    return corridors


def _decoupling_candidates(decouplers, driver_box, positions, specs, pinmap, gap, local_returns=(), signal_corridors=()):
    """Place declared bypass parts beside the owning driver's real envelope.

    The old fallback put every decoupler above and to the right of the whole
    driver bank.  That uses page-level routing space for a local power pair
    and makes a VDD/GND capacitor look detached from its owner.  Generate a
    side candidates from the actual anchor-pin direction, reject measured
    body/field-envelope overlaps, then estimate the routed local pair. The
    candidate search only changes presentation positions; the declared
    anchor/return pin identities remain untouched by the caller.
    """
    if not decouplers:
        return []

    member_pins = {row[0]: row[3:5] for row in decouplers}
    def transverse_axis(ref):
        """Only tighten perpendicular to parallel, outward terminal leads."""
        pins = [pinmap[key] for key in member_pins.get(ref, ())]
        if len(pins) != 2 or not all(k in specs[ref] for k in ('_content_low', '_content_high')):
            return None
        for axis in (0, 1):
            if all(not pin['direction'][axis] and
                   abs(pin.get('port', pin['pos'])[axis]-pin['pos'][axis]) < .001
                   for pin in pins):
                return axis
        return None

    def box(ref, origin):
        spec = specs[ref]
        result = [
            origin[0] + spec["_low"][0],
            origin[1] + spec["_low"][1],
            origin[0] + spec["_low"][0] + spec["width"],
            origin[1] + spec["_low"][1] + spec["height"],
        ]
        axis = transverse_axis(ref)
        if axis is not None:
            # A horizontal capacitor needs its full left/right escape space,
            # but no imaginary vertical port margin between parallel rows.
            # Keep every measured field and both real terminal ordinates.
            ordinates = [pinmap[key]['pos'][axis] for key in member_pins[ref]]
            result[axis] = origin[axis] + min(spec['_content_low'][axis], *ordinates)
            result[axis+2] = origin[axis] + max(spec['_content_high'][axis], *ordinates)
        return result

    def overlaps(a, b):
        return (
            min(a[2], b[2]) - max(a[0], b[0]) > 0.1
            and min(a[3], b[3]) - max(a[1], b[1]) > 0.1
        )

    occupied = [
        box(ref, origin)
        for ref, origin in positions.items()
        if ref not in {item[0] for item in decouplers}
    ]
    occupied.extend(list(box) for box in signal_corridors)
    # Keep the driver itself in the rejection set even when a caller supplies
    # a partial position dictionary during a unit test.
    if not any(overlaps(driver_box, other) and other == driver_box for other in occupied):
        occupied.append(list(driver_box))

    first = decouplers[0]
    anchor = first[1]
    def absolute_pin(key):
        origin = positions.get(key.rsplit('.', 1)[0], [0, 0])
        return [origin[i] + pinmap[key]['pos'][i] for i in (0, 1)]

    def escape(key, point):
        pin = pinmap[key]
        if 'port' in pin:
            delta = [pin['port'][i] - pin['pos'][i] for i in (0, 1)]
        else:
            delta = [pin['direction'][i] * float(gap) for i in (0, 1)]
        delta = [delta[i] + pin['direction'][i]*geom.GRID for i in (0, 1)]
        return [point[i] + delta[i] for i in (0, 1)], sum(abs(v) for v in delta)

    def escapes_clear(candidate):
        origins={**positions,**candidate}
        boxes={ref:box(ref,origin) for ref,origin in origins.items()}
        for key,pin in pinmap.items():
            ref=key.rsplit('.',1)[0]
            if ref not in origins:continue
            start=[origins[ref][i]+pin['pos'][i] for i in (0,1)]
            end,_=escape(key,start)
            for other,other_box in boxes.items():
                if other==ref or ref not in candidate and other not in candidate:continue
                if geom.intersects(start,end,other_box):return False
        return True

    def route_estimate(source, target, origin):
        # Pin-to-pin distance overlooks the required outward terminal leads.
        # Include them, so a pin facing away from the owner pays for its U-turn.
        source_point = absolute_pin(source)
        target_point = [origin[i] + pinmap[target]['pos'][i] for i in (0, 1)]
        a, lead_a = escape(source, source_point)
        b, lead_b = escape(target, target_point)
        return lead_a + lead_b + sum(abs(a[i] - b[i]) for i in (0, 1))

    anchor_pos = absolute_pin(anchor)
    anchor_direction = pinmap[anchor]["direction"]
    normals = [
        tuple(anchor_direction),
        (0, -1),
        (0, 1),
        (-anchor_direction[0], -anchor_direction[1]),
        (-1, 0),
        (1, 0),
    ]
    unique_normals = []
    for normal in normals:
        normal = (int(normal[0]), int(normal[1]))
        if normal != (0, 0) and normal not in unique_normals:
            unique_normals.append(normal)

    refs = {item[0] for item in decouplers}
    best_by_profile = {}
    for normal in unique_normals:
        nx, ny = normal
        if nx < 0:
            edge = driver_box[0]
        elif nx > 0:
            edge = driver_box[2]
        elif ny < 0:
            edge = driver_box[1]
        else:
            edge = driver_box[3]
        # Retain routing envelopes along terminal escape directions. Only
        # a transverse bank of parallel leads can use measured body/field
        # spacing: no port exits into the preceding capacitor on that axis.
        tangent_axis = 1 if nx else 0
        axes={transverse_axis(ref) for ref in refs}
        bank_axes=[tangent_axis]
        if len(axes)==1 and None not in axes and next(iter(axes))!=tangent_axis:
            bank_axes.append(next(iter(axes)))
        # Bank orientation and bank location are independent choices. A
        # parallel row bank can sit above a device as well as beside it;
        # tying row direction to the chosen side excluded that compact case.
        for bank_axis in bank_axes:
            bank_size=max(box(ref,[0,0])[bank_axis+2]-box(ref,[0,0])[bank_axis] for ref in refs)
            parallel_rows=all(transverse_axis(ref)==bank_axis for ref in refs)
            clearance=min(float(gap),2.54) if parallel_rows else float(gap)
            pitch=math.ceil((bank_size+max(clearance,geom.GRID))/1.27)*1.27
            if not parallel_rows:pitch=max(pitch,10.16 if nx else 17.78)
            offset0=-.5*pitch*(len(decouplers)-1)
            # Probe beside measured obstacles as well as near the anchor.
            # A fixed +/- two-gap search misses a bank that clears the last
            # filter column by only one more native grid step.
            relative=[]
            for index,(ref,_,_,member,_) in enumerate(decouplers):
                origin=[-pinmap[member]['pos'][i] for i in (0,1)]
                origin[bank_axis]+=offset0+index*pitch
                relative.append(box(ref,origin))
            low=min(b[tangent_axis] for b in relative)
            high=max(b[tangent_axis+2] for b in relative)
            center=float(anchor_pos[tangent_axis])
            shifts={0.,-float(gap),float(gap),-2*float(gap),2*float(gap),-pitch,pitch}
            shifts.add((driver_box[tangent_axis]+driver_box[tangent_axis+2]-low-high)/2-center)
            for obstacle in occupied:
                shifts.add(obstacle[tangent_axis]-float(gap)-center-high)
                shifts.add(obstacle[tangent_axis+2]+float(gap)-center-low)
            tangents=sorted({_round(value) for value in shifts})
            for normal_offset in (float(gap),float(gap)*2,float(gap)*3,float(gap)*4):
                for shift in tangents:
                    candidate={};candidate_boxes=[];valid=True
                    for index,(ref,_,_,anchor_member,_) in enumerate(decouplers):
                        target=[float(anchor_pos[0]),float(anchor_pos[1])]
                        normal_axis=0 if nx else 1
                        target[normal_axis]=edge+(nx if nx else ny)*normal_offset
                        target[tangent_axis]+=shift
                        target[bank_axis]+=offset0+index*pitch
                        origin=[_round(target[i]-pinmap[anchor_member]['pos'][i]) for i in (0,1)]
                        current=box(ref,origin)
                        if any(overlaps(current,other) for other in occupied+candidate_boxes):
                            valid=False;break
                        candidate[ref]=origin;candidate_boxes.append(current)
                    if not valid or not escapes_clear(candidate):continue
                    distance=0.
                    for ref,anchor,return_pin,anchor_member,return_member in decouplers:
                        distance+=route_estimate(anchor,anchor_member,candidate[ref])
                        if return_pin not in local_returns:
                            distance+=route_estimate(return_pin,return_member,candidate[ref])
                    # A short owner-to-capacitor path can still append a new
                    # row beneath the entire circuit. Include the measured
                    # group envelope so existing space beside a signal bank
                    # competes fairly with an isolated, slightly nearer bank.
                    envelope=occupied+candidate_boxes
                    span=sum(max(b[axis+2] for b in envelope)-min(b[axis] for b in envelope) for axis in (0,1))
                    score=(distance+2*span,distance,unique_normals.index(normal),abs(shift),normal_offset,shift,bank_axis)
                    profile=(normal,bank_axis)
                    previous=best_by_profile.get(profile)
                    if previous is None or score<previous['score']:
                        best_by_profile[profile]={'score':score,'positions':candidate,'side':list(normal),'bankAxis':bank_axis}

    return sorted(best_by_profile.values(),key=lambda row:row['score'])


def _decoupling_positions(*args, **kwargs):
    candidates=_decoupling_candidates(*args,**kwargs)
    return candidates[0]['positions'] if candidates else {}


def _decoupling_signal_pairs(decouplers, positions, pinmap, netof):
    """Connect declared decouplers as local same-domain trunks.

    A declared capacitor is still electrically connected to the exact frozen
    anchor and return nets.  For presentation, however, independently routing
    every capacitor back to the owner pin makes a shared supply rail become a
    pair of long perimeter paths.  Group the capacitors by their two net
    domains, connect the nearest member to the owner, then chain the remaining
    members by geometric proximity.  The return side is handled separately by
    the caller, so a shared return rail is never inferred or renamed here.

    ``positions`` contains each symbol origin and ``pinmap`` contains local
    pin coordinates.  The ordering is derived from those coordinates and a
    stable pin key; serialized component order therefore cannot change the
    visual topology.
    """

    def absolute_pin(key):
        ref = key.rsplit(".", 1)[0]
        origin = positions.get(ref, [0.0, 0.0])
        local = pinmap[key]["pos"]
        return [float(origin[0]) + float(local[0]), float(origin[1]) + float(local[1])]

    domains = collections.defaultdict(list)
    for item in decouplers:
        ref, anchor, return_pin, anchor_member, return_member = item
        # Use the actual member nets where available.  They are checked by the
        # caller before routing; using them here keeps multiple declared
        # anchors with different supply domains independent.
        key = (netof.get(anchor_member), netof.get(return_member))
        domains[key].append(item)

    pairs = []
    for domain in sorted(domains, key=lambda value: tuple(str(part) for part in value)):
        items = sorted(
            domains[domain],
            key=lambda item: (item[1], item[3], item[0]),
        )
        if not items:
            continue
        # The owner anchor is the common origin for a declared driver group;
        # retaining the first item's anchor keeps the original endpoint
        # identity while distance chooses the nearest capacitor geometrically.
        owner = items[0][1]
        owner_point = absolute_pin(owner)
        ordered = sorted(
            items,
            key=lambda item: (
                math.dist(owner_point, absolute_pin(item[3])),
                item[3],
                item[0],
            ),
        )
        previous = owner
        for item in ordered:
            member = item[3]
            pairs.append((previous, member))
            previous = member
    return pairs


def decoupling_return_nodes(design, resources, groups):
    """Keep a driver's declared bypass return local to its supply bank.

    The rail is the existing electrical net. Only the owner and its declared
    capacitors lose independent label stubs; other groups and input filters
    remain independent. Frozen blocks retain their original drawing contract.
    """
    components={c['ref']:c for c in design['components']}
    netof,_=_net_index(design)
    fixed={r for b in resources.get('blocks',[]) for r in b.get('bindings',{}).values()}
    hints=decoupling_hints(design);nodes=set()
    for group in groups:
        refs=group['references'];drivers=_driver_candidates(refs,components)
        if len(drivers)!=1 or set(refs)&fixed:continue
        owner=drivers[0]
        if any(r!=owner and len(components[r].get('pins',[]))>2 for r in refs):continue
        for ref,relation in hints.get(owner,{}).items():
            if ref not in refs:continue
            target=relation['return'];rail=netof.get(target)
            matches=[p for p in _component_pin_keys(components[ref]) if netof.get(p)==rail]
            if rail and len(matches)==1:nodes.update((target,matches[0]))
    return nodes


def _complete_local_pairs(pairs, refs, design, positions, pinmap):
    """Connect all remaining local net islands, preserving existing branches.

    Recognizing a useful series/bypass motif does not cover every pin. In
    particular, tied control inputs and a feed's upstream pin still need a
    real local rail. Ground can use independent labels; other local terminals
    are joined by nearest physical ports, never by serialized node order.
    """
    result=list(pairs)
    refs=set(refs)
    for net in sorted(design['nets'],key=lambda net:net['name']):
        if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',net['name'],re.I):continue
        members=sorted(key for key in net['nodes'] if key.rsplit('.',1)[0] in refs)
        parents={key:key for key in members}
        def root(key):
            while parents[key]!=key:key=parents[key]
            return key
        for a,b in result:
            if a in parents and b in parents:parents[root(b)]=root(a)
        while len({root(key) for key in members})>1:
            choices=[]
            for i,a in enumerate(members):
                for b in members[i+1:]:
                    if root(a)==root(b):continue
                    pa,pb=_point(positions,pinmap,a,port=True),_point(positions,pinmap,b,port=True)
                    choices.append((sum(abs(pa[j]-pb[j]) for j in (0,1)),a,b))
            _,a,b=min(choices)
            result.append((a,b));parents[root(b)]=root(a)
    return result


def _place_driver_candidate(group, design, resources, specs, pinmap, gap, parts=None, bank_advance=0, power_choice=0, placement_only=False):
    """Place a source-side driver group, or return ``None`` when ambiguous."""

    refs = list(group.get("references", []))
    components = {c["ref"]: c for c in design.get("components", [])}
    if any(ref not in components for ref in refs):
        return None
    drivers = _driver_candidates(refs, components)
    if len(drivers) != 1:
        return None
    driver = drivers[0]
    # A second active endpoint belongs in its own visual island.  Treating it
    # as a local obstacle would recreate the large ELK perimeter loop.
    if any(
        ref != driver and len(components[ref].get("pins", [])) > 2
        for ref in refs
    ):
        return None
    netof, nodes = _net_index(design)
    branch_result = _branch_chains(refs, driver, design, resources, netof, nodes)
    if branch_result is None:
        return None
    branches, used = branch_result
    shunts, decouplers, leftovers = _classify_shunts(
        refs, driver, used, design, resources, netof
    )
    if leftovers or not branches:
        return None

    positions = {driver: [0.0, 0.0]}
    driver_low = specs[driver]["_low"]
    driver_box = [
        driver_low[0],
        driver_low[1],
        driver_low[0] + specs[driver]["width"],
        driver_low[1] + specs[driver]["height"],
    ]
    branch_pairs = []
    driver_inputs = [
        key
        for key in _component_pin_keys(components[driver])
        if _pin_type(components, key) == "input" and netof.get(key)
    ]
    input_source = {
        ref: next(
            (
                key
                for key in driver_inputs
                if netof.get(key) == netof.get(signal)
            ),
            None,
        )
        for ref, signal, _ in shunts
    }
    shunt_layout = None
    if shunts and driver_inputs and all(
        pinmap[key]["direction"][0] for key in driver_inputs
    ):
        input_sides = {
            -1 if pinmap[key]["direction"][0] < 0 else 1
            for key in driver_inputs
        }
        if len(input_sides) == 1 and all(input_source.values()):
            shunt_side = next(iter(input_sides))
            if all(
                _auto_shunt_orientation_allowed(ref, components, resources)
                for ref, _, _ in shunts
            ):
                same_side_branch_rows = [
                    pinmap[branch["source"]]["pos"][1]
                    for branch in branches
                    if pinmap[branch["source"]]["direction"][0]
                    and (-1 if pinmap[branch["source"]]["direction"][0] < 0 else 1)
                    == shunt_side
                ]
                shunt_layout = _input_shunt_array(
                    shunts,
                    input_source,
                    driver_inputs,
                    shunt_side,
                    driver_box,
                    specs,
                    pinmap,
                    gap,
                    same_side_branch_rows,
                    advance=bank_advance,
                )
            else:
                shunt_layout = _rowwise_input_shunt_array(
                    shunts,
                    input_source,
                    shunt_side,
                    driver_box,
                    specs,
                    pinmap,
                    gap,
                )
    # Reserve local supply bypasses before serial banks consume the space by
    # the owner pin. Input shunts already have a measured candidate band. A
    # conflicting signal branch can move outward locally; a bypass should not
    # be displaced to the far end of an entire bank as an afterthought.
    early_decouplers = None
    power_options=[]
    if decouplers:
        reserved = dict(positions)
        if shunt_layout:
            for ref,signal,_ in shunts:
                target=[shunt_layout['target_x'][ref],shunt_layout['target_y'][ref]]
                _place_component(reserved,ref,signal,target,pinmap)
        power_options = _decoupling_candidates(
            decouplers,driver_box,reserved,specs,pinmap,gap,
            local_returns=(),
            signal_corridors=_signal_corridors(branches,components,driver_box,specs,pinmap,gap,shunt_layout),
        )
        if power_options:
            if power_choice>=len(power_options):return None
            early_decouplers=power_options[power_choice]['positions']
        if early_decouplers:
            positions.update(early_decouplers)

    # The first passive body's height determines a readable bank pitch.  Each
    # side is ordered by the actual driver pin Y coordinate, not net array
    # order or reference text.
    by_side = collections.defaultdict(list)
    for branch in branches:
        source = branch["source"]
        direction = pinmap[source]["direction"]
        if direction[0]:
            side = -1 if direction[0] < 0 else 1
        elif direction[1]:
            side = -1 if direction[1] < 0 else 1
        else:
            return None
        branch["side"] = side
        by_side[tuple(direction)].append(branch)
    for cardinal, items in sorted(by_side.items()):
        side = next(value for value in cardinal if value)
        outward = pinmap[items[0]["source"]]["direction"]
        if any(
            bool(pinmap[item["source"]]["direction"][0]) != bool(outward[0])
            for item in items
        ):
            return None
        row_axis = 1 if outward[0] else 0
        items.sort(key=lambda branch: (_point(positions, pinmap, branch["source"])[row_axis], branch["source"]))
        desired_rows = [_point(positions, pinmap, branch["source"])[row_axis] for branch in items]
        branch_rows = _branch_row_coordinates(items, desired_rows, row_axis, specs, pinmap, gap)
        # Prefer the compact bank beside the driver, but move it outside a
        # same-side input array if its measured body/field boxes would touch.
        # ELK routing obstacles protect wires; they cannot repair two symbols
        # that were placed on top of one another, so this check belongs here.
        def content_box(ref, origin):
            low=specs[ref].get("_content_low",specs[ref]["_low"])
            high=specs[ref].get("_content_high",[
                specs[ref]["_low"][0]+specs[ref]["width"],
                specs[ref]["_low"][1]+specs[ref]["height"],
            ])
            return [origin[0]+low[0],origin[1]+low[1],origin[0]+high[0],origin[1]+high[1]]
        def routing_box(ref, origin):
            low=specs[ref]["_low"]
            return [
                origin[0]+low[0],
                origin[1]+low[1],
                origin[0]+low[0]+specs[ref]["width"],
                origin[1]+low[1]+specs[ref]["height"],
            ]
        def boxes_touch(left,right):
            return (
                min(left[2],right[2])-max(left[0],right[0])>.1
                and min(left[3],right[3])-max(left[1],right[1])>.1
            )
        def current_shunt_boxes():
            boxes=[]
            if not shunt_layout:return boxes
            for ref,signal,_ in shunts:
                target=[shunt_layout["target_x"][ref],shunt_layout["target_y"][ref]]
                origin=[
                    target[0]-pinmap[signal]["pos"][0],
                    target[1]-pinmap[signal]["pos"][1],
                ]
                boxes.append((content_box(ref,origin),routing_box(ref,origin)))
            return boxes
        shunt_boxes=current_shunt_boxes()
        branch_anchor_x=None
        if outward[0]:
            branch_left=min(specs[item["chain"][0][0]].get("_low",[0,0])[0] for item in items)
            branch_right=max(
                specs[item["chain"][0][0]].get("_low",[0,0])[0]
                + specs[item["chain"][0][0]]["width"]
                for item in items
            )
            adjacent_anchor=(
                _round(driver_box[0]-gap-branch_right)
                if side<0
                else _round(driver_box[2]+gap-branch_left)
            )
            outside_anchor=(
                _round(shunt_layout["left"]-gap-branch_right)
                if side<0
                else _round(shunt_layout["right"]+gap-branch_left)
            ) if shunt_layout and side==shunt_layout["side"] else adjacent_anchor
            def branch_boxes(anchor_x,branch_y,branch):
                cursor=[anchor_x,branch_y];boxes=[]
                for chain_index,(ref,source_pin,other_pin) in enumerate(branch["chain"]):
                    origin=[
                        cursor[0]-pinmap[source_pin]["pos"][0],
                        branch_y-pinmap[source_pin]["pos"][1],
                    ]
                    port=[
                        origin[0]+pinmap[source_pin]["port"][0]+pinmap[source_pin]["direction"][0]*geom.GRID,
                        origin[1]+pinmap[source_pin]["port"][1]+pinmap[source_pin]["direction"][1]*geom.GRID,
                    ]
                    boxes.append((content_box(ref,origin),routing_box(ref,origin),port))
                    end=[
                        origin[0]+pinmap[other_pin]["pos"][0],
                        origin[1]+pinmap[other_pin]["pos"][1],
                    ]
                    if chain_index + 1 < len(branch["chain"]):
                        next_ref,next_source_pin,_=branch["chain"][chain_index + 1]
                        next_target=_serial_next_target(
                            origin[0],
                            specs[ref]["_low"][0],
                            specs[ref]["width"],
                            end[0],
                            specs[next_ref]["_low"][0],
                            specs[next_ref]["width"],
                            pinmap[next_source_pin]["pos"][0],
                            side,
                            gap,
                        )
                        cursor=[next_target,branch_y]
                    else:
                        cursor=[_round(end[0]+side*(gap+5.08)),branch_y]
                return boxes
            # A route endpoint inside a shunt's reserved port box makes the
            # visibility router reject an otherwise valid short bank.  Move
            # the complete shunt array outward by the smallest native-grid
            # amount first; only a true body/field overlap falls back to the
            # wider outside bank.
            if shunt_layout and side==shunt_layout["side"] and shunt_boxes:
                for _ in range(8):
                    conflicts=[]
                    for branch in items:
                        for _,route_box,port in branch_boxes(adjacent_anchor,branch_rows[branch["source"]],branch):
                            for _,other_route in shunt_boxes:
                                if other_route[0]<port[0]<other_route[2] and other_route[1]<port[1]<other_route[3]:
                                    conflicts.append((port,other_route))
                    if not conflicts:break
                    delta=max(
                        (box[2]-point[0]+geom.GRID) if side<0 else (point[0]-box[0]+geom.GRID)
                        for point,box in conflicts
                    )
                    shift=_round(delta)
                    if shift<=0:break
                    shift=-shift if side<0 else shift
                    shunt_layout["target_x"]={
                        ref:_round(value+shift)
                        for ref,value in shunt_layout["target_x"].items()
                    }
                    shunt_layout["left"]=_round(shunt_layout["left"]+shift)
                    shunt_layout["right"]=_round(shunt_layout["right"]+shift)
                    shunt_boxes=current_shunt_boxes()
            content_conflict=shunt_boxes and any(
                boxes_touch(box,other[0])
                for branch in items
                for box,_,_ in branch_boxes(adjacent_anchor,branch_rows[branch["source"]],branch)
                for other in shunt_boxes
            )
            branch_anchor_x=outside_anchor if content_conflict else adjacent_anchor
        for branch in items:
            source = branch["source"]
            branch_y = branch_rows[source]
            outward = [
                float(pinmap[source]["direction"][0]),
                float(pinmap[source]["direction"][1]),
            ]
            if outward[0]:
                # Keep the complete passive body outside the driver's outward
                # lead.  A declared shunt column occupies the space between
                # the driver and its output bank, so the bank is pushed past
                # that column while retaining its side-specific pin geometry.
                branch_left = min(
                    specs[item["chain"][0][0]]["_low"][0] for item in items
                )
                branch_right = max(
                    specs[item["chain"][0][0]]["_low"][0]
                    + specs[item["chain"][0][0]]["width"]
                    for item in items
                )
                if shunt_layout and side == shunt_layout["side"]:
                    # Keep the output bank adjacent to the driver.  The
                    # input shunt array is already on the same pin side, but
                    # pushing the output bank beyond every shunt column
                    # creates a page-wide detour.  The obstacle-aware router
                    # will use a short local dogleg when the two banks share
                    # a vertical interval.
                    if side < 0:
                        anchor_x = _round(driver_box[0] - gap - branch_right)
                    else:
                        anchor_x = _round(driver_box[2] + gap - branch_left)
                    if branch_anchor_x is not None:
                        anchor_x=branch_anchor_x
                    if _pin_type(components,source)=='input' and any(
                        input_source.get(ref)==source for ref,_,_ in shunts
                    ):
                        # An input conditioner is a serial feed followed by
                        # a shunt tap. Keep its series chain outside the whole
                        # filter column bank so the source rows remain clear.
                        # Putting one resistor between the taps traps later
                        # signal routes behind its body/field reservation.
                        anchor_x=(_round(shunt_layout['left']-gap-branch_right) if side<0
                                  else _round(shunt_layout['right']+gap-branch_left))
                else:
                    anchor_x = (
                        driver_box[0] - (2 * gap) - 7.62
                        if side < 0
                        else driver_box[2] + gap + 7.62
                    )
                    # Labels and terminal reserves vary with the real symbol.
                    # A fixed pin gap can put both routing endpoints inside
                    # the opposite obstacle, forcing the whole circuit into
                    # the fallback layout. Move only as far as the measured
                    # source and first passive envelopes require.
                    clear_targets = [
                        _serial_next_target(0,driver_low[0],specs[driver]['width'],
                            pinmap[item['source']]['pos'][0],
                            specs[item['chain'][0][0]]['_low'][0],
                            specs[item['chain'][0][0]]['width'],
                            pinmap[item['chain'][0][1]]['pos'][0],side,gap)
                        for item in items
                    ]
                    anchor_x=(min([anchor_x,*clear_targets]) if side<0 else max([anchor_x,*clear_targets]))
                cursor = [anchor_x, branch_y]
            else:
                anchor_y = (
                    driver_box[1] - gap - 7.62
                    if side < 0
                    else driver_box[3] + gap + 7.62
                )
                clear_targets = [
                    _serial_next_target(0,driver_low[1],specs[driver]['height'],
                        pinmap[item['source']]['pos'][1],
                        specs[item['chain'][0][0]]['_low'][1],
                        specs[item['chain'][0][0]]['height'],
                        pinmap[item['chain'][0][1]]['pos'][1],side,gap)
                    for item in items
                ]
                anchor_y=(min([anchor_y,*clear_targets]) if side<0 else max([anchor_y,*clear_targets]))
                cursor = [branch_y, anchor_y]
            previous = source
            for chain_index, (ref, source_pin, other_pin) in enumerate(branch["chain"]):
                target = [cursor[0], branch_y] if outward[0] else [branch_y, cursor[1]]
                if early_decouplers and outward[0]:
                    for cap in early_decouplers:
                        cap_box=routing_box(cap,positions[cap])
                        origin=[target[0]-pinmap[source_pin]['pos'][0],target[1]-pinmap[source_pin]['pos'][1]]
                        port=[origin[0]+pinmap[source_pin]['port'][0]+pinmap[source_pin]['direction'][0]*geom.GRID,
                              origin[1]+pinmap[source_pin]['port'][1]+pinmap[source_pin]['direction'][1]*geom.GRID]
                        if boxes_touch(content_box(ref,origin),cap_box) or (cap_box[0]<port[0]<cap_box[2] and cap_box[1]<port[1]<cap_box[3]):
                            clear=_serial_next_target(positions[cap][0],specs[cap]['_low'][0],specs[cap]['width'],
                                cap_box[0] if side<0 else cap_box[2],specs[ref]['_low'][0],specs[ref]['width'],
                                pinmap[source_pin]['pos'][0],side,gap)
                            target[0]=min(target[0],clear) if side<0 else max(target[0],clear)
                _place_component(positions, ref, source_pin, target, pinmap)
                branch_pairs.append((previous, source_pin))
                end = _point(positions, pinmap, other_pin)
                previous = other_pin
                if chain_index + 1 < len(branch["chain"]):
                    # A serial chain has two adjacent passive bodies.  The
                    # old fixed ``gap + 5.08`` advance measured from the
                    # previous pin, so the next body's routing box could
                    # touch the current one and its outward lead landed
                    # inside the neighbour.  Reserve the measured boxes and
                    # place the next source pin only after both boxes clear.
                    next_ref, next_source_pin, _ = branch["chain"][chain_index + 1]
                    axis = 0 if outward[0] else 1
                    next_target = _serial_next_target(
                        positions[ref][axis],
                        specs[ref]["_low"][axis],
                        specs[ref]["width" if axis == 0 else "height"],
                        end[axis],
                        specs[next_ref]["_low"][axis],
                        specs[next_ref]["width" if axis == 0 else "height"],
                        pinmap[next_source_pin]["pos"][axis],
                        side,
                        gap,
                    )
                    cursor = (
                        [_round(next_target), branch_y]
                        if outward[0]
                        else [branch_y, _round(next_target)]
                    )
                elif outward[0]:
                    cursor = [_round(end[0] + side * (gap + 5.08)), branch_y]
                else:
                    cursor = [branch_y, _round(end[1] + side * (gap + 5.08))]

    # Input shunts follow the driver's input side and rows.  A vertical bank
    # keeps each signal local to its input; the horizontal fallback handles
    # symbols whose input pins are not a single horizontal side.
    if shunts:
        # The capacitor order follows the driver's actual input rows.  Pin
        # geometry is the stable tie breaker; serialized component/net order
        # must not decide which shunt is nearest to an input.
        shunts.sort(
            key=lambda item: (
                pinmap[input_source[item[0]]]["pos"][1]
                if input_source[item[0]]
                else float("inf"),
                item[0],
            )
        )
        if shunt_layout:
            targets = {
                ref: [shunt_layout["target_x"][ref], shunt_layout["target_y"][ref]]
                for ref, _, _ in shunts
            }
        else:
            cap_pitch = _round(max(specs[shunts[0][0]]["width"] + gap, 17.78))
            row_y = _round(
                driver_box[1]
                - max(specs[item[0]]["height"] for item in shunts)
                - gap
                - 10.16
                - gap
                - 2.54
            )
            row_x = _round(
                driver_box[0] - (len(shunts) - 1) * cap_pitch - 2 * gap
            )
            targets = {
                ref: [_round(row_x + index * cap_pitch), row_y]
                for index, (ref, _, _) in enumerate(shunts)
            }
        for ref, signal, ret in shunts:
            target = targets[ref]
            _place_component(positions, ref, signal, target, pinmap)
            source = input_source.get(ref)
            if source is None:
                return None
            branch_pairs.append((source, signal))
            return_pin = next(
                (
                    key
                    for key in _component_pin_keys(components[driver])
                    if netof.get(key) == netof.get(ret)
                ),
                None,
            )
            if return_pin and not _shared_return_net(netof.get(ret), design):
                branch_pairs.append((return_pin, ret))

        # The input bank has a short common return of its own. Keep that
        # physical rail even when its connection to the owner's ground is
        # represented by a label; independent capacitor stubs hide the bank.
        returns=collections.defaultdict(list)
        for _,_,ret in shunts:
            if _shared_return_net(netof.get(ret),design):returns[netof[ret]].append(ret)
        for members in returns.values():
            members.sort(key=lambda key:(_point(positions,pinmap,key),key))
            branch_pairs.extend(zip(members,members[1:]))

    if decouplers:
        if early_decouplers:
            decoupling_origins=early_decouplers
        else:
            power_options=_decoupling_candidates(decouplers,driver_box,positions,specs,pinmap,gap)
            if power_choice>=len(power_options):return None
            decoupling_origins=power_options[power_choice]['positions']
        if not decoupling_origins:
            return None
        for ref, anchor, return_pin, anchor_member, return_member in decouplers:
            positions[ref] = decoupling_origins[ref]
        # Route one short same-domain trunk for all declared decouplers after
        # their origins are known.  A direct owner-to-each-cap pair would make
        # the router independently detour around the driver body and fields,
        # producing the large U-shaped +5V loop seen in the native D replay.
        branch_pairs.extend(
            _decoupling_signal_pairs(decouplers, positions, pinmap, netof)
        )
        branch_pairs.extend(_decoupling_signal_pairs(
            [(ref,ret,anchor,ret_member,anchor_member) for ref,anchor,ret,anchor_member,ret_member in decouplers],
            positions,pinmap,netof))

    all_pairs = _complete_local_pairs(branch_pairs, refs, design, positions, pinmap)
    refs_in_layout = set([driver]) | {item[0] for branch in branches for item in branch["chain"]}
    refs_in_layout |= {item[0] for item in shunts} | {item[0] for item in decouplers}
    if refs_in_layout != set(refs):
        return None

    if placement_only:
        return {'_bankAdvanceLimit':shunt_layout.get('advanceLimit',0) if shunt_layout else 0,
                '_powerChoiceCount':max(1,len(power_options))}
    if not all_pairs:
        return None

    # Route every local pair through one obstacle-aware grid.  Same-net paths
    # may share a rail; distinct nets never occupy a common edge or T contact.
    bounds = _bounds(positions, refs, specs, all_pairs, pinmap)
    box = [bounds[0] - 25.4, bounds[1] - 25.4, bounds[2] + 25.4, bounds[3] + 25.4]
    obstacles = []
    for ref in refs:
        x, y = positions[ref]
        spec = specs[ref]
        obstacles.append(
            [
                _round(x + spec["_low"][0]),
                _round(y + spec["_low"][1]),
                _round(x + spec["_low"][0] + spec["width"]),
                _round(y + spec["_low"][1] + spec["height"]),
            ]
        )
    # Reserve the exact pin-to-outer-port leads before routing.  The router
    # accepts these as fixed fine-grid channels, so each emitted path can be
    # extended back to the real pin without becoming a dangling label stub.
    leads = []
    for source, target in all_pairs:
        net = netof.get(source) or netof.get(target)
        if not net or netof.get(source) != netof.get(target):
            return None
        leads.extend(
            [
                (net, _point(positions, pinmap, source), _point(positions, pinmap, source, port=True)),
                (net, _point(positions, pinmap, target), _point(positions, pinmap, target, port=True)),
            ]
        )
    router = geom.Router(box, obstacles, leads)
    # Emit the reserved leads independently. A new branch may join an existing
    # same-net trunk before reaching its originally requested source port.
    routes = [{"net":net,"points":[a,b]} for net,a,b in leads if a!=b]
    try:
        for index, (source, target) in enumerate(all_pairs):
            net = netof.get(source) or netof.get(target)
            if not net or netof.get(source) != netof.get(target):
                return None
            source_pin = _point(positions, pinmap, source)
            target_pin = _point(positions, pinmap, target)
            source_port = _point(positions, pinmap, source, port=True)
            target_port = _point(positions, pinmap, target, port=True)
            path = router.connect(
                net,
                source_port,
                target_port,
            )
            # The path may start on an existing same-net trunk. Reserved leads
            # above retain every exact pin endpoint in the physical wire tree.
            routes.append({"net": net, "points": path})
    except (KeyError, ValueError, IndexError):
        return None

    route_points = [point for route in routes for point in route["points"]]
    all_bounds = _bounds(positions, refs, specs, all_pairs, pinmap)
    if route_points:
        all_bounds = [
            min(all_bounds[0], *(point[0] for point in route_points)) - 5.08,
            min(all_bounds[1], *(point[1] for point in route_points)) - 5.08,
            max(all_bounds[2], *(point[0] for point in route_points)) + 5.08,
            max(all_bounds[3], *(point[1] for point in route_points)) + 5.08,
        ]
    left, top, right, bottom = all_bounds
    edges = []
    for route in routes:
        points = route["points"]
        if len(points) < 2:
            continue
        edges.append(
            {
                "net": route["net"],
                "sections": [
                    {
                        "startPoint": {"x": points[0][0] - left, "y": points[0][1] - top},
                        "bendPoints": [
                            {"x": pt[0] - left, "y": pt[1] - top}
                            for pt in points[1:-1]
                        ],
                        "endPoint": {"x": points[-1][0] - left, "y": points[-1][1] - top},
                    }
                ],
            }
        )
    return {
        "id": group["id"],
        "width": right - left,
        "height": bottom - top,
        "children": [
            {
                "id": ref,
                "x": positions[ref][0] + specs[ref]["_low"][0] - left,
                "y": positions[ref][1] + specs[ref]["_low"][1] - top,
            }
            for ref in refs
        ],
        "edges": edges,
        "placementRule": "topology-driver-local-series-shunts",
        "_bankAdvanceLimit": shunt_layout.get('advanceLimit', 0) if shunt_layout else 0,
        "_powerChoiceCount": max(1,len(power_options)),
    }


def place_driver(group, design, resources, specs, pinmap, gap, parts=None):
    """Select a compact layout only after its complete local routing succeeds.

    The baseline's route reserves remain a feasible fallback. Search inward on
    the native grid, within the measured body/field clearance limit, and score
    complete routed candidates rather than assuming closer parts mean shorter
    wires. No reference design, names or target coordinates participate.
    """
    from layout_quality import routed_metrics,complexity
    probe=_place_driver_candidate(group,design,resources,specs,pinmap,gap,parts,placement_only=True)
    if probe is None:
        return None
    steps=min(12,int(math.floor(probe['_bankAdvanceLimit']/geom.GRID+1e-9)))
    count=min(8,probe['_powerChoiceCount']);attempts=[];seen=set();best=None;best_score=None;chosen=(0,0)
    def attempt(power,index):
        nonlocal best,best_score,chosen
        if (power,index) in seen:return
        seen.add((power,index));advance=index*geom.GRID
        candidate=_place_driver_candidate(group,design,resources,specs,pinmap,gap,parts,advance,power)
        record={'powerCandidate':power,'advanceMm':round(advance,4),'routed':candidate is not None}
        attempts.append(record)
        if candidate is None:
            return
        candidate.pop('_bankAdvanceLimit',None);candidate.pop('_powerChoiceCount',None)
        metrics=routed_metrics(candidate)
        score=(complexity(metrics,candidate['width'],candidate['height']),metrics['crossings'],metrics['bends'],metrics['wireMm'])
        record.update(score=list(score),metrics=metrics)
        if best is None or score<best_score:best,best_score,chosen=candidate,score,(power,index)
    # Preserve every prior grid candidate for the initial power profile.
    # Additional side/orientation profiles get three measured advances;
    # refine the winning profile once on each neighboring native grid row.
    for index in range(steps+1):attempt(0,index)
    for power in range(1,count):
        for index in sorted({0,steps//2,steps}):attempt(power,index)
    power,index=chosen
    for nearby in (index-1,index+1):
        if 0<=nearby<=steps:attempt(power,nearby)
    if best is None:return None
    best['placementSearch']={'method':'coupled-power-and-filter-routing','candidates':attempts,'selectedScore':list(best_score),
                            'selectedPowerCandidate':chosen[0],'selectedAdvanceMm':round(chosen[1]*geom.GRID,4)}
    return best

