"""Topology-derived orientation for standard two-terminal symbols.

The orientation pass deliberately only returns defaults.  The caller merges
these values below explicit user rotations and removes members owned by a
frozen block, so this module must never mutate either the design or its layout.
"""


def _angle(pin):
    """Read a native pin angle as one of KiCad's four cardinal directions."""

    try:
        return float(pin[3]) % 360
    except (IndexError, TypeError, ValueError):
        return None


def _pin_angles(raw, children, child):
    """Return the first native angle for each pin number in a symbol tree."""

    result = {}
    for unit in children(raw, "symbol"):
        for pin in children(unit, "pin"):
            number = child(pin, "number")
            at = child(pin, "at")
            if number is None or at is None:
                continue
            angle = _angle(at)
            if angle is not None:
                result.setdefault(str(number[1]), angle)
    return result


def _cardinal_direction(angle):
    """Return the page direction produced by a native pin angle.

    ``generic_layout`` uses KiCad's page convention directly: angle zero
    points west and positive Y points down.  Keeping the conversion here
    avoids making input-filter orientation depend on a particular pin number
    or on a symbol's nominal axis.
    """

    try:
        value = round(float(angle)) % 360
    except (TypeError, ValueError):
        return None
    return {
        0: (-1, 0),
        90: (0, 1),
        180: (1, 0),
        270: (0, -1),
    }.get(value)


def _rotation_for_direction(native_angle, direction):
    """Return the cardinal instance rotation that faces ``direction``."""

    target = {
        (-1, 0): 0,
        (0, 1): 90,
        (1, 0): 180,
        (0, -1): 270,
    }.get(tuple(direction))
    if target is None or native_angle is None:
        return None
    return int((target - float(native_angle)) % 360)


def defaults(design, resources):
    import native_resources as nr
    from design_audit import child, children
    # Reuse the same conservative library-backed classification as functional
    # grouping.  Device:R/Device:C snapshots often have neither appearance nor
    # drawingRules metadata, but their installed-library identity and native
    # description still provide sufficient evidence.
    from functional_groups import _is_kind, _kind

    symbols = (resources or {}).get("symbols", {})
    components = design.get("components", [])
    nets = design.get("nets", [])
    netof = {key: n["name"] for n in nets for key in n.get("nodes", [])}

    def node(ref, number):
        return f"{ref}.{number}"

    # A named ground pin is stronger evidence than a net name supplied by the
    # model.  This also preserves SGND/AGND/etc. when the net is renamed.
    ground_names = {"GND", "SGND", "AGND", "DGND", "PGND", "VSS"}
    ground = {
        netof.get(node(c["ref"], p["number"]))
        for c in components
        for p in c.get("pins", [])
        if str(p.get("name", "")).upper() in ground_names
    }

    # Build pin-angle evidence from the native anchor symbols.  The angle is
    # keyed by the actual component/pin identity, never by a reference name or
    # a particular board's numbering convention.
    outputs = {
        node(c["ref"], p["number"])
        for c in components
        if len(c.get("pins", [])) > 2
        for p in c.get("pins", [])
        if p.get("type") == "output"
    }
    output_angles = {}
    entry_angles = {}
    power_angles = {}
    native_angles = {}
    for hub in components:
        symbol = symbols.get(hub.get("librarySymbol"), {})
        native = symbol.get("native")
        if not native:
            continue
        try:
            raw = nr.parse(native)
        except (TypeError, ValueError):
            continue
        angles = _pin_angles(raw, children, child)
        native_angles[hub["ref"]] = angles
        pin_by_number = {str(p.get("number")): p for p in hub.get("pins", [])}
        for number, angle in angles.items():
            key = node(hub["ref"], number)
            if key in outputs:
                output_angles[key] = angle
            # A unique non-ground power-anchor direction can orient a decoupling
            # capacitor toward that anchor.  Include power_out connector pins as
            # well as power_in IC pins; two-terminal passives are not anchors.
            if len(hub.get("pins", [])) > 2:
                pin = pin_by_number.get(number, {})
                if pin.get("type") in ("power_in", "power_out"):
                    if _is_kind(_kind(hub, resources), 'connector'):
                        entry_angles[key] = angle
                    net = netof.get(key)
                    if net not in ground and net:
                        power_angles.setdefault(net, set()).add(angle)

    result = {}
    supplied = (set(design.get("supplied_nets", [])) | {
        netof.get(node(c["ref"], p["number"]))
        for c in components for p in c.get("pins", [])
        if p.get("type") == "power_out"
    }) - ground - {None}
    # Input shunts need a presentation orientation that agrees with the
    # topology bank selected by ``topology_layout``.  A driver with output
    # branches on the same side as its horizontal inputs gets an above-source
    # bank (the lower side is occupied by the branch rows); the signal pin
    # therefore faces down and the return pin faces up.  With no same-side
    # branch, the compact below-source bank is preferred and the signal faces
    # up.  This is derived from pin roles and native directions, never from
    # reference or net names.  Explicit request rotations are merged after
    # this function and therefore still win.
    input_shunt_roles = {}
    kind_by_ref = {
        component["ref"]: _kind(component, resources)
        for component in components
    }
    local_signal_angles = {
        node(c['ref'],p['number']):native_angles[c['ref']][str(p['number'])]
        for c in components
        if len(c.get('pins',[]))>2 and not _is_kind(kind_by_ref[c['ref']], 'connector')
        for p in c.get('pins',[])
        if p.get('type') in ('input','output') and str(p['number']) in native_angles.get(c['ref'],{})
    }
    for driver in components:
        driver_pins = driver.get("pins", [])
        if len(driver_pins) <= 2 or sum(
            str(pin.get("type") or "").lower() == "output"
            for pin in driver_pins
        ) < 3:
            continue
        angles = native_angles.get(driver["ref"], {})
        input_pins = [
            pin for pin in driver_pins
            if str(pin.get("type") or "").lower() == "input"
            and netof.get(node(driver["ref"], pin.get("number")))
        ]
        if not input_pins:
            continue
        input_directions = {
            _cardinal_direction(angles.get(str(pin.get("number"))))
            for pin in input_pins
        }
        if None in input_directions or any(
            not direction or not direction[0]
            for direction in input_directions
        ) or len(input_directions) != 1:
            # The topology motif only has a horizontal input bank.  Other
            # orientations remain on the conservative ground-down default.
            continue
        input_nets = {
            netof.get(node(driver["ref"], pin.get("number")))
            for pin in input_pins
        }
        return_nets = {
            netof.get(node(driver["ref"], pin.get("number")))
            for pin in driver_pins
            if str(pin.get("type") or "").lower() in {"power_in", "power_out"}
            and netof.get(node(driver["ref"], pin.get("number")))
        }
        output_pins = [
            pin for pin in driver_pins
            if str(pin.get("type") or "").lower() == "output"
        ]
        output_nets = {
            netof.get(node(driver["ref"], pin.get("number")))
            for pin in output_pins
            if netof.get(node(driver["ref"], pin.get("number")))
        }
        # Only output nets that actually feed a passive branch participate in
        # the above/below choice.  A bare output pin should not force an input
        # filter bank away from its nearest side.
        branch_nets = set()
        for candidate in components:
            if candidate["ref"] == driver["ref"] or len(candidate.get("pins", [])) != 2:
                continue
            if not _is_kind(kind_by_ref.get(candidate["ref"]), "resistor", "capacitor"):
                continue
            candidate_nets = {
                netof.get(node(candidate["ref"], pin.get("number")))
                for pin in candidate.get("pins", [])
            }
            branch_nets.update(candidate_nets & output_nets)
        output_directions = {
            _cardinal_direction(angles.get(str(pin.get("number"))))
            for pin in output_pins
            if netof.get(node(driver["ref"], pin.get("number"))) in branch_nets
        }
        same_side = bool(output_directions & input_directions)
        band = "above" if same_side else "below"
        for candidate in components:
            if not _is_kind(kind_by_ref.get(candidate["ref"]), "capacitor"):
                continue
            if len(candidate.get("pins", [])) != 2:
                continue
            candidate_keys = [
                node(candidate["ref"], pin.get("number"))
                for pin in candidate.get("pins", [])
            ]
            signal_keys = [key for key in candidate_keys if netof.get(key) in input_nets]
            return_keys = [key for key in candidate_keys if netof.get(key) in return_nets]
            if len(signal_keys) != 1 or len(return_keys) != 1:
                continue
            signal_number = signal_keys[0].rsplit(".", 1)[1]
            input_shunt_roles[candidate["ref"]] = (signal_number, band)
    for component in components:
        if len(component.get("pins", [])) != 2:
            continue
        symbol = symbols.get(component.get("librarySymbol"), {})
        native = symbol.get("native")
        if not native:
            continue
        # _kind handles both explicit appearance.kind and ordinary installed
        # Device:R/Device:C records with missing appearance metadata.
        kind = _kind(component, resources)
        if not (_is_kind(kind, "resistor") or _is_kind(kind, "capacitor")):
            continue
        # A specified resistor/capacitor carries an evidence-backed geometric
        # contract (axis, terminal span and native pin angles).  Its native
        # orientation is part of that contract; treating the alias as a
        # standard resistor/capacitor would silently rotate horizontal R6-like
        # symbols and dimensioned capacitors before strict layout matching.
        if _is_kind(kind, "specified-resistor", "specified-capacitor"):
            continue
        try:
            raw = nr.parse(native)
        except (TypeError, ValueError):
            continue
        angles = _pin_angles(raw, children, child)
        if any(str(p.get("number")) not in angles for p in component.get("pins", [])):
            # An incomplete native record cannot safely be oriented.
            continue

        ref = component["ref"]
        if _is_kind(kind, "resistor"):
            pin_keys = [node(ref, p["number"]) for p in component["pins"]]
            linked = [
                key
                for key in pin_keys
                if any(key in n.get("nodes", []) and outputs.intersection(n.get("nodes", [])) for n in nets)
            ]
            local_linked = [key for key in pin_keys if any(
                netof.get(anchor)==netof.get(key) for anchor in local_signal_angles)]
            # Local IC input ownership takes precedence over a remote connector
            # output. Otherwise the input resistor faces the connector and its
            # pin escape points away from the owning IC, forcing a routing loop.
            anchor_angles=output_angles
            if len(local_linked)==1:
                linked=local_linked
                anchor_angles=local_signal_angles
            # A standalone series resistor is horizontal by default.  When its
            # driver anchor is known, make the actual driver-side terminal face
            # that anchor, independent of reference/net names.
            result[ref] = 90
            if len(linked) == 1:
                peers = [key for key in anchor_angles if netof.get(key) == netof.get(linked[0])]
                facing = {anchor_angles[key] for key in peers}
                if len(facing) == 1:
                    number = linked[0].rsplit(".", 1)[1]
                    result[ref] = int((next(iter(facing)) + 180 - angles[number]) % 360)

            # A resistor between a driven net and a declared supply is a pull-up
            # (or pull-down analogue); keep its supply terminal above the body.
            supply_pins = [
                p["number"]
                for p in component["pins"]
                if netof.get(node(ref, p["number"])) in supplied
            ]
            if len(linked) == 1 and len(supply_pins) == 1 and linked[0].rsplit(".", 1)[1] != supply_pins[0]:
                result[ref] = int((270 - angles[supply_pins[0]]) % 360)
            # A unique connector feed/return is also a real local branch.
            # Orient its connected terminal toward the port, including named
            # ground nets, while retaining active input ownership precedence.
            if component.get('electricalRole') in ('routing-bridge', 'supply-filter') and not local_linked:
                entry_peers = [(key, peer) for net in nets if len(net.get('nodes', [])) == 2
                               for key in pin_keys if key in net['nodes']
                               for peer in net['nodes'] if peer in entry_angles]
                if len(entry_peers) == 1:
                    key, peer = entry_peers[0]
                    result[ref] = int((entry_angles[peer]+180-angles[key.rsplit('.',1)[1]]) % 360)
        else:
            ground_pins = [
                p["number"]
                for p in component["pins"]
                if netof.get(node(ref, p["number"])) in ground
            ]
            if len(ground_pins) != 1:
                continue
            # Default for an unpolarized capacitor: ground terminal down.
            result[ref] = int((90 - angles[ground_pins[0]]) % 360)

            # If exactly one non-ground terminal is on a net whose power anchor
            # has one unambiguous direction, face that terminal toward it.  The
            # known anchor direction takes precedence over the generic ground-
            # down fallback; ambiguous or absent anchor evidence stays vertical.
            supply_pins = [p["number"] for p in component["pins"] if p["number"] not in ground_pins]
            if len(supply_pins) == 1:
                net = netof.get(node(ref, supply_pins[0]))
                facing = power_angles.get(net, set())
                if len(facing) == 1:
                    # ``facing`` is the owner's outward pin direction.  The
                    # capacitor's supply terminal must point back toward that
                    # owner, so use the opposite page direction just as the
                    # series-resistor orientation does above.
                    result[ref] = int((next(iter(facing)) + 180 - angles[supply_pins[0]]) % 360)
            role = input_shunt_roles.get(ref)
            if role is not None:
                signal_number, band = role
                desired = (0, 1) if band == "above" else (0, -1)
                oriented = _rotation_for_direction(angles.get(signal_number), desired)
                if oriented is not None:
                    # Input-filter role is stronger than the generic
                    # ground-down fallback.  It is still weaker than an
                    # explicit request rotation, which is merged by the
                    # caller after this default map is returned.
                    result[ref] = oriented
    return result
