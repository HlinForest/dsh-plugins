"""Bounded quality search for already-connected routing bridges.

The ordinary local-repair worker handles incomplete nets.  This module is the
separate opt-in path for a declared zero-ohm bridge that is already connected:
strip the entire physical tail, preserve every remaining external copper
group, and reconnect the moved bridge to every group.  A candidate is useful
only when native checks and all three routing metrics pass together.
"""

import math
from pathlib import Path

import pcbnew as p

from pcb_power_routes import reserve_power_routes
from pcb_route_cleanup import route_metrics
from record_io import write_json


def _xy(value):
    return value.x, value.y


def _overlaps(first, second, gap=0):
    return (first[0] < second[2] + gap and first[2] > second[0] - gap and
            first[1] < second[3] + gap and first[3] > second[1] - gap)


def _box(footprint):
    items = list(footprint.Pads()) + [
        graphic for graphic in footprint.GraphicalItems()
        if graphic.IsOnCopperLayer() or graphic.GetLayer() in
        (p.F_CrtYd, p.B_CrtYd, p.F_Fab, p.B_Fab)
    ]
    if not items:
        items = [footprint]
    bounds = [item.GetBoundingBox() for item in items]
    margin = p.FromMM(.35)
    return (
        min(item.GetX() for item in bounds) - margin,
        min(item.GetY() for item in bounds) - margin,
        max(item.GetRight() for item in bounds) + margin,
        max(item.GetBottom() for item in bounds) + margin,
    )


def _tail_tracks(board, bridge, pads):
    """Collect the complete unlocked track tails attached to bridge pads.

    Connectivity traversal continues through track-to-track junctions and
    stops at pads belonging to another footprint.  A locked track is reported
    as a blocker; leaving it behind would create a dangling old branch after
    the bridge footprint moves.
    """
    board.BuildConnectivity()
    connectivity = board.GetConnectivity()
    removable = {}
    external = {}
    locked = set()
    for pad in pads:
        net = pad.GetNetCode()
        external.setdefault(net, {})
        stack = [pad]
        seen_tracks = set()
        seen_pads = {pad.m_Uuid.AsString()}
        while stack:
            item = stack.pop()
            for track in list(connectivity.GetConnectedTracks(item)):
                uid = track.m_Uuid.AsString()
                if uid in seen_tracks:
                    continue
                seen_tracks.add(uid)
                if track.IsLocked():
                    locked.add(uid)
                else:
                    removable[uid] = track
                stack.append(track)
            for other in list(connectivity.GetConnectedPads(item)):
                uid = other.m_Uuid.AsString()
                if uid in seen_pads:
                    continue
                seen_pads.add(uid)
                owner = other.GetParentFootprint()
                if owner is not None and owner != bridge:
                    external[net][uid] = other
                else:
                    stack.append(other)
    return list(removable.values()), external, locked


def _external_groups(board, layer, bridge_ref):
    """Return current physical pad groups with the bridge pad excluded."""
    from pcb_local_repair import copper_networks

    audit = copper_networks(board, layer)
    groups = {}
    for row in audit['networks']:
        net = row['net']
        net_groups = []
        for group in row['connectedPadGroups']:
            members = [member for member in group['members']
                       if member['ref'] != bridge_ref]
            if members:
                net_groups.append(members)
        groups[net] = net_groups
    return groups, audit


def _protected_refs(request):
    protected = set(request.get('plan', {}).get('placements', {}))
    for relation in request.get('process', {}).get('relations', []):
        protected.add(relation.get('ref'))
        for key in ('anchor', 'return'):
            endpoint = relation.get(key)
            if endpoint:
                protected.add(endpoint.get('ref'))
    return {ref for ref in protected if ref}


def bridge_quality_candidates(source, dest, request, selected_ref=None):
    """Run the bounded, opt-in bridge quality search."""
    source = Path(source).resolve()
    dest = Path(dest).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    plan = request['plan']
    name = Path(request['schematic']).stem
    layer = p.B_Cu if plan.get('activeLayers') == ['B.Cu'] else p.F_Cu
    report = {
        'mode': 'quality',
        'geometrySource': 'current generated native PCB only',
        'selectedRef': selected_ref,
        'candidates': [],
        'adopted': False,
        'fixedCoordinatesAdded': False,
        'electricalAssignmentsChanged': False,
        'nativeDrcRequired': True,
        'protectedRefs': sorted(_protected_refs(request)),
    }
    if len(plan.get('activeLayers', [])) != 1:
        report['reason'] = 'quality bridge search currently supports one explicit routing layer'
        write_json(dest / 'result.json', report)
        return report

    from pcb_local_repair import compatibility_identity, copy_project, native_check, copper_networks

    board_file = source / (name + '.kicad_pcb')
    source_board = p.LoadBoard(str(board_file))
    baseline_quality = route_metrics(source_board)
    baseline_copper = copper_networks(source_board, layer)
    report['baseline'] = {
        'quality': baseline_quality,
        'allPhysicalCopperConnected': baseline_copper['allPhysicalPadNetworksConnected'],
    }

    all_refs = list(request.get('process', {}).get('jumpers', []))
    refs = [selected_ref] if selected_ref else all_refs
    protected = _protected_refs(request)
    refs = [ref for ref in refs if ref in all_refs and ref not in protected]
    if not refs:
        report['reason'] = 'no movable declared routing bridge remains after fixed/process constraints'
        write_json(dest / 'result.json', report)
        return report

    max_attempts = min(12, max(4, 2 * len(refs)))
    per_ref_attempts = max(1, max_attempts // min(2, len(refs)))
    grid = p.FromMM(.5)
    radius = 4
    attempts = 0

    for ref in refs[:2]:
        if attempts >= max_attempts:
            break
        ref_attempts = 0
        probe = p.LoadBoard(str(board_file))
        probe_fp = next((footprint for footprint in probe.GetFootprints()
                         if footprint.GetReference() == ref), None)
        if (probe_fp is None or probe_fp.IsLocked() or
                len(list(probe_fp.Pads())) != 2):
            continue
        probe_pads = list(probe_fp.Pads())
        probe_nets = [pad.GetNetCode() for pad in probe_pads]
        if any(net <= 0 for net in probe_nets) or probe_nets[0] == probe_nets[1]:
            continue
        origin = _xy(probe_fp.GetPosition())
        orientation = probe_fp.GetOrientationDegrees()
        poses = []
        for angle_delta in (0, 90, 180, 270):
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    if not (dx or dy or angle_delta):
                        continue
                    poses.append((dx * grid, dy * grid, angle_delta,
                                  (dx * dx + dy * dy) * .25))
        poses.sort(key=lambda row: (row[3], row[2], row[0], row[1]))

        for dx, dy, angle_delta, _ in poses:
            if attempts >= max_attempts or ref_attempts >= per_ref_attempts:
                break
            attempts += 1
            ref_attempts += 1
            board = p.LoadBoard(str(board_file))
            footprints = {footprint.GetReference(): footprint
                          for footprint in board.GetFootprints()}
            bridge = footprints.get(ref)
            if bridge is None:
                continue
            pads = list(bridge.Pads())
            removed, external, locked = _tail_tracks(board, bridge, pads)
            candidate_prefix = {
                'ref': ref,
                'offsetMm': [p.ToMM(dx), p.ToMM(dy)],
                'angleDelta': angle_delta,
                'removedTailSegments': len(removed),
            }
            if locked:
                report['candidates'].append({**candidate_prefix, 'routed': False,
                                             'reason': 'protected track attached to bridge'})
                continue
            for track in removed:
                board.Remove(track)
            bridge.SetOrientationDegrees((orientation + angle_delta) % 360)
            bridge.SetPosition(p.VECTOR2I(origin[0] + dx, origin[1] + dy))
            bridge_box = _box(bridge)
            other_boxes = [(_box(item), item.GetLayer())
                           for item in footprints.values() if item != bridge]
            if any(side == bridge.GetLayer() and
                   _overlaps(bridge_box, other, p.FromMM(plan.get('componentGapMm', 0)))
                   for other, side in other_boxes):
                report['candidates'].append({**candidate_prefix, 'routed': False,
                                             'reason': 'component clearance'})
                continue

            # Refill once before discovering the resulting physical external
            # groups.  This catches the common case where the old tail was a
            # shared trunk and the remaining copper split into several islands.
            board.BuildConnectivity()
            p.ZONE_FILLER(board).Fill(board.Zones())
            groups, _ = _external_groups(board, layer, ref)
            relations = []
            route_chains = []
            route_ok = True
            for pad in pads:
                net_groups = groups.get(pad.GetNetname(), [])
                if not net_groups:
                    route_ok = False
                    break
                # Reconnect each physical group as a nearest-neighbour chain.
                # The first link starts at the bridge; subsequent links start
                # at the previous group's real pad, so this reuses the copper
                # tree instead of routing every group as a bridge-pad star.
                pending_groups = list(net_groups)
                source_ref = ref
                source_pad = pad.GetNumber()
                source_uuid = pad.m_Uuid.AsString()
                source_xy = _xy(pad.GetPosition())
                chain = []
                while pending_groups:
                    choices = []
                    for group_index, group in enumerate(pending_groups):
                        targets = []
                        for member in group:
                            owner = member['ref']
                            target_fp = footprints.get(owner)
                            if target_fp is None:
                                continue
                            targets.extend(q for q in target_fp.Pads()
                                           if q.m_Uuid.AsString() == member['uuid'] and
                                           q.IsOnLayer(layer))
                        if targets:
                            target = min(
                                targets,
                                key=lambda q: (
                                    math.dist(source_xy, _xy(q.GetPosition())),
                                    q.GetParentFootprint().GetReference(),
                                    q.GetNumber(),
                                    q.m_Uuid.AsString(),
                                ),
                            )
                            choices.append((
                                math.dist(source_xy, _xy(target.GetPosition())),
                                target.GetParentFootprint().GetReference(),
                                target.GetNumber(),
                                group_index,
                                target,
                            ))
                    if not choices:
                        route_ok = False
                        break
                    _, _, _, group_index, target = min(choices)
                    pending_groups.pop(group_index)
                    relations.append({
                        'ref': source_ref,
                        'kind': 'routing-bridge-quality',
                        'supplyPad': source_pad,
                        '_sourcePhysicalUuid': source_uuid,
                        'anchor': {
                            'ref': target.GetParentFootprint().GetReference(),
                            'pad': target.GetNumber(),
                            '_physicalUuid': target.m_Uuid.AsString(),
                        },
                    })
                    chain.append({
                        'from': source_ref + '.' + source_pad,
                        'to': (target.GetParentFootprint().GetReference() +
                               '.' + target.GetNumber()),
                    })
                    source_ref = target.GetParentFootprint().GetReference()
                    source_pad = target.GetNumber()
                    source_uuid = target.m_Uuid.AsString()
                    source_xy = _xy(target.GetPosition())
                route_chains.append({
                    'net': pad.GetNetname(),
                    'groups': len(chain),
                    'links': chain,
                })
                if not route_ok:
                    break

            candidate_prefix['groupRouteChains'] = route_chains

            routes = {'routes': []}
            if route_ok:
                try:
                    # Each external group must receive its own route.  Joining
                    # an existing tree would treat later groups as already
                    # reached through the bridge pad and silently skip them.
                    routes = reserve_power_routes(
                        board,
                        {'relations': relations, 'routeRoles': ['anchor'],
                         'joinExistingTree': False},
                        plan,
                        lock=False,
                    )
                    route_ok = (len(routes.get('routes', [])) == len(relations) and
                                all(row.get('adopted') for row in routes['routes']))
                except Exception as error:
                    route_ok = False
                    routes = {'routes': [], 'reason': str(error)}

            if not route_ok:
                report['candidates'].append({**candidate_prefix, 'routed': False,
                                             'routes': routes,
                                             'reason': 'could not reconnect every external copper group'})
                continue

            board.BuildConnectivity()
            p.ZONE_FILLER(board).Fill(board.Zones())
            audit = copper_networks(board, layer)
            folder = dest / ('quality-' + str(len(report['candidates'])) + '-' + ref)
            folder.mkdir(parents=True, exist_ok=True)
            copy_project(source, folder)
            p.SaveBoard(str(folder / (name + '.kicad_pcb')), board)
            try:
                native = native_check(folder, request)
            except Exception as error:
                native = {
                    'counts': {'violations': -1, 'unconnected_items': -1,
                               'schematic_parity': -1},
                    'passed': False,
                    'error': str(error),
                }
            after = route_metrics(board)
            identity_preserved = (compatibility_identity(source_board) ==
                                  compatibility_identity(board))
            source_sides = {item.GetReference(): item.GetLayer()
                            for item in source_board.GetFootprints()}
            sides_preserved = all(source_sides.get(item.GetReference()) == item.GetLayer()
                                  for item in board.GetFootprints())
            quality_improved = (
                all(after[key] <= baseline_quality[key] + 1e-6
                    for key in ('trackLengthMm', 'shortSegmentsUnder05mm',
                                'degree2Bends')) and
                any(after[key] < baseline_quality[key] - 1e-6
                    for key in ('trackLengthMm', 'shortSegmentsUnder05mm',
                                'degree2Bends'))
            )
            row = {
                **candidate_prefix,
                'routes': routes,
                'routed': True,
                'quality': after,
                'native': native,
                'copper': audit,
                'identityPreserved': identity_preserved,
                'assemblySidesPreserved': sides_preserved,
                'qualityImproved': quality_improved,
                'passed': bool(native.get('passed') and
                               audit['allPhysicalPadNetworksConnected'] and
                               identity_preserved and sides_preserved and
                               quality_improved),
            }
            report['candidates'].append(row)
            if row['passed']:
                report.update({'adopted': True, 'candidate': str(folder),
                               'after': after})
                break
        if report['adopted']:
            break

    report['attempts'] = attempts
    if not report['adopted']:
        report['reason'] = ('no candidate passed full physical connectivity, native '
                            'DRC/parity, identity, and joint routing-quality gates')
    write_json(dest / 'result.json', report)
    return report
