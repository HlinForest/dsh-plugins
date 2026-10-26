"""Infer readable schematic groups from component roles and net adjacency.

The library snapshot intentionally keeps appearance metadata for specialized
symbols only.  Ordinary symbols copied from KiCad's installed library (such
as ``Device:R`` and ``Device:C``) are still authoritative, but do not carry an
``appearance.kind`` field.  This module derives only the small set of
library-backed categories needed by the generic layout fallback.  It never
uses reference designators, coordinates, or a particular board name.
"""

import re


_POWER_NAME = re.compile(
    r"^(?:[+-]?(?:\d+(?:\.\d+)?V\d*|\d+V\d+)(?:[_-][A-Z0-9]+)*|"
    r"VCC|VDD|VSS|VEE|GND|GROUND|"
    r"SGND|AGND|DGND|PGND|PWR|POWER)$",
    re.I,
)
_POWER_TOKEN = re.compile(
    r"(?:^|[_-])(?:VCC|VDD|VSS|VEE|GND|GROUND|SGND|AGND|DGND|PGND)(?:$|[_-])",
    re.I,
)

# These aliases are deliberately narrow.  A two-terminal diode or transistor
# is not treated as a passive chain element: traversing it would make a layout
# appear connected in a way that is not a simple readable subgraph.
_PASSIVE_KINDS = {
    "resistor",
    "specified-resistor",
    "capacitor",
    "specified-capacitor",
    "inductor",
    "ferrite",
    "ferrite-bead",
}


def _record(component, resources):
    """Return the frozen symbol record for *component*, if available."""

    symbols = (resources or {}).get("symbols", {})
    ident = component.get("librarySymbol")
    return symbols.get(ident, {}) if isinstance(symbols, dict) else {}


def _kind(component, resources):
    """Derive a conservative functional kind from frozen library evidence."""

    record = _record(component, resources)
    appearance = record.get("appearance") or {}
    ident = str(component.get("librarySymbol") or "")
    drawing = record.get("drawingRules") or {}
    # A generated symbol can retain the installed-library identity in its
    # drawing rules even when the component's top-level id is an Evidence id.
    library_ident = str(drawing.get("librarySymbol") or ident)
    pins = component.get("pins") or []
    description = str(record.get("description") or "")

    # A separately recorded connector identity has priority over a generic
    # ``specified-box`` appearance.  This covers generated evidence symbols
    # whose geometry is box-shaped while their installed-library provenance
    # still identifies a connector.
    if component.get("componentKind") == "connector":
        return "connector"
    if len(pins) >= 2 and (
        re.search(
            r"(?:^|:)(?:Conn_|PinHeader_|TerminalBlock|Screw_Terminal|USB_)",
            library_ident,
            re.I,
        )
        or re.search(r"\bconnector\b", description, re.I)
    ):
        return "connector"

    explicit = appearance.get("kind")
    if isinstance(explicit, str) and explicit:
        return explicit

    two_passive = len(pins) == 2 and all(
        str(pin.get("type", "")).lower() == "passive" for pin in pins
    )

    # Standard KiCad Device:R/Device:C families.  The pin-count/type gate
    # prevents a malformed custom record from being pulled into a chain.
    if two_passive and re.fullmatch(r"Device:R(?:_|$).*", library_ident, re.I):
        return "resistor"
    if two_passive and re.fullmatch(r"Device:C(?:_|$).*", library_ident, re.I):
        return "capacitor"
    if two_passive and re.search(r"\bresistor\b", description, re.I):
        return "resistor"
    if two_passive and re.search(r"\b(?:capacitor|capacitance)\b", description, re.I):
        return "capacitor"
    if two_passive and re.fullmatch(r"Device:L(?:_|$).*", library_ident, re.I):
        return "inductor"
    if two_passive and re.search(r"(?:ferrite|bead)", library_ident, re.I):
        return "ferrite-bead"

    return None


def _is_kind(value, *wanted):
    """Compare explicit and normalized kinds without broad string matching."""

    if value in wanted:
        return True
    aliases = {
        "specified-resistor": "resistor",
        "specified-capacitor": "capacitor",
        "infrared": "infrared-receiver",
        "ir-receiver": "infrared-receiver",
        "specified-receiver": "infrared-receiver",
        "stepped-two-digit-display": "display",
    }
    return aliases.get(value) in wanted


def _is_passive(value):
    return value in _PASSIVE_KINDS


def _is_powered_load(component, kind):
    """Return true for a powered functional load, excluding connectors.

    Supply ownership is inferred from actual pin roles.  In particular, a
    custom ``specified-box`` can be a controller, while a connector may have
    several input/output pins but is not itself a load that should claim a
    local bypass branch.  ``power_out`` is also counted because evidenced
    display/power symbols can expose their supply terminal with that role.
    """

    if component.get("objectRole") == "process":
        return False
    if _is_passive(kind) or _is_kind(kind, "connector"):
        return False
    return any(
        str(pin.get("type", "")).lower() in {"power_in", "power_out"}
        for pin in component.get("pins", [])
    )


def _is_supply_endpoint(component, kind):
    """Return true for any non-passive symbol exposing a supply terminal."""

    if component.get("objectRole") == "process" or _is_passive(kind):
        return False
    return any(
        str(pin.get("type", "")).lower() in {"power_in", "power_out"}
        for pin in component.get("pins", [])
    )


def _is_driver_candidate(component, kind):
    """Return true for an active multi-output driver.

    ``logic-ic`` keeps the established three-output guard.  A specified box
    has no library identity, so it is admitted only when its frozen pin roles
    show a power input and at least two outputs.  This also prevents a
    connector-like box with only signal pins from becoming the driver anchor.
    """

    outputs = sum(
        str(pin.get("type", "")).lower() == "output"
        for pin in component.get("pins", [])
    )
    if _is_kind(kind, "logic-ic"):
        return outputs >= 3
    return (
        _is_kind(kind, "specified-box")
        and any(
            str(pin.get("type", "")).lower() == "power_in"
            for pin in component.get("pins", [])
        )
        and outputs >= 2
    )


def _net_graph(design):
    """Build net-to-members and pin-to-net indexes from a frozen design."""

    netof = {}
    members = {}
    for net in design.get("nets", []):
        name = str(net.get("name") or "")
        if not name:
            continue
        refs = set()
        for node in net.get("nodes", []):
            node = str(node)
            netof[node] = name
            if "." in node:
                refs.add(node.rsplit(".", 1)[0])
        members[name] = refs
    return netof, members


def _blocked_net(name, supplied):
    """Return true for rails that must never be used as a chain shortcut."""

    if name in supplied:
        return True
    name = str(name)
    return bool(_POWER_NAME.fullmatch(name) or _POWER_TOKEN.search(name))


def _component_nets(ref, component, netof):
    return {
        netof[key]
        for pin in component.get("pins", [])
        for key in (ref + "." + str(pin.get("number")),)
        if key in netof
    }


def _same_net_passive(ref, component, netof):
    """Return true only when both terminals are explicitly on one net.

    A same-net two-terminal part is a visual cross-over/jumper marker.  It is
    intentionally kept out of a signal BFS so the later ``零欧跨线`` group can
    own it.  Missing or unconnected terminals do not qualify as same-net.
    """

    pins = component.get("pins", [])
    if len(pins) != 2:
        return False
    nets = [
        netof.get(ref + "." + str(pin.get("number")))
        for pin in pins
    ]
    return None not in nets and nets[0] == nets[1]


def _expand_signal_subgraph(
    start_ref,
    components,
    kinds,
    netof,
    members,
    blocked,
    *,
    include_endpoints=True,
    reserved_owners=None,
):
    """Expand through only two-terminal passive components.

    A non-passive endpoint on a signal net is included as the end of the
    readable subgraph, but its other nets are not traversed.  This keeps a
    connector or another IC from turning one shared interface into a large
    unrelated group.  Power/ground rails are never queued, which prevents all
    decouplers from collapsing into one group through SGND.
    """

    owned = {start_ref}
    queued = [
        name
        for name in _component_nets(start_ref, components[start_ref], netof)
        if not blocked(name)
    ]
    seen_nets = set()
    while queued:
        name = queued.pop(0)
        if name in seen_nets or blocked(name):
            continue
        seen_nets.add(name)
        for ref in members.get(name, ()):
            if ref == start_ref or ref not in components:
                continue
            # Explicit decoupling owners and their members are reserved for
            # that owner.  A neighbouring signal walk must not claim either
            # side before the owner group is emitted.
            if reserved_owners and reserved_owners.get(ref) not in (None, start_ref):
                continue
            kind = kinds.get(ref)
            if _is_passive(kind) and len(components[ref].get("pins", [])) == 2:
                if _same_net_passive(ref, components[ref], netof):
                    # Both pins already share the current net.  Keep this
                    # marker for the dedicated cross-over group; traversing it
                    # would make a driver/receiver swallow it permanently.
                    continue
                owned.add(ref)
                for other in _component_nets(ref, components[ref], netof):
                    if other != name and not blocked(other):
                        queued.append(other)
            elif kind is not None and include_endpoints:
                # Keep a functional endpoint (connector/display/IC/receiver)
                # in the group while stopping the traversal at that endpoint.
                owned.add(ref)
    return owned


def _is_active_module(component, kind):
    """Return true for a powered, multi-pin functional endpoint.

    A connector is deliberately excluded even when its frozen pins contain
    ``power_out``.  The shared-interface pass uses this predicate to count
    the modules served by a connector; otherwise a connector could become its
    own ``driver`` merely because it exposes several electrical terminals.
    ``objectRole=process`` is likewise presentation metadata rather than an
    electrical module.
    """

    if (
        component.get("objectRole") == "process"
        or kind is None
        or _is_passive(kind)
        or _is_kind(kind, "connector")
        or len(component.get("pins", [])) < 3
    ):
        return False
    return _is_powered_load(component, kind)


def _shared_interface_connectors(
    components,
    kinds,
    netof,
    members,
    supplied,
    atomic_sets,
):
    """Find connectors that serve at least two active modules.

    Signal ownership is discovered by walking a connector pin's net through
    two-terminal passive chains.  Rails are blocked by both their declared
    supply identity and frozen pin roles, so a power entry cannot turn two
    otherwise unrelated modules into an interface group.  A connector that
    belongs to a frozen block or an explicit decoupling unit is left in that
    unit; presentation ownership is authoritative over this inferred split.
    """

    power_nets = set(supplied)
    for name, refs in members.items():
        if _blocked_net(name, supplied):
            power_nets.add(name)
            continue
        for ref in refs:
            component = components.get(ref)
            if not component:
                continue
            if any(
                netof.get(ref + "." + str(pin.get("number"))) == name
                and str(pin.get("type", "")).lower() in {"power_in", "power_out"}
                for pin in component.get("pins", [])
            ):
                power_nets.add(name)
                break

    def blocked(name):
        return name in power_nets or _blocked_net(name, supplied)

    connectors = {
        ref
        for ref, kind in kinds.items()
        if _is_kind(kind, "connector")
    }
    shared = set()
    for connector in sorted(connectors):
        component = components[connector]
        queue = []
        # Connector pin roles are authoritative even when a library snapshot
        # calls a power net by a non-standard name.
        for pin in component.get("pins", []):
            if str(pin.get("type", "")).lower() in {"power_in", "power_out"}:
                continue
            name = netof.get(connector + "." + str(pin.get("number")))
            if name and not blocked(name):
                queue.append(name)

        seen_nets = set()
        seen_passives = set()
        served = set()
        while queue:
            name = queue.pop(0)
            if name in seen_nets or blocked(name):
                continue
            seen_nets.add(name)
            for ref in sorted(members.get(name, ())):
                if ref == connector or ref not in components:
                    continue
                kind = kinds.get(ref)
                if _is_active_module(components[ref], kind):
                    served.add(ref)
                    continue
                if (
                    not _is_passive(kind)
                    or len(components[ref].get("pins", [])) != 2
                    or ref in seen_passives
                    or _same_net_passive(ref, components[ref], netof)
                ):
                    continue
                seen_passives.add(ref)
                for other in _component_nets(ref, components[ref], netof):
                    if other != name and not blocked(other):
                        queue.append(other)

        if len(served) < 2:
            continue
        # Do not pull a connector out of a user/frozen ownership unit.  The
        # normal atomic closure below will keep that unit together.
        if any(connector in unit and len(unit) > 1 for unit in atomic_sets):
            continue
        shared.add(connector)
    return shared


def decoupling_hints(design):
    """Return validated bypass and reviewed supply-storage ownership.

    ``functions[].layout`` is an optional presentation hint written by the
    reviewed design stage.  It is deliberately checked against the frozen
    electrical topology here as well: the generic fallback must never infer a
    capacitor owner merely because several parts share a supply rail.

    A supply-transient sizing row can extend an explicit bypass group with
    its named reservoir, only on the same actual supply and return domains.
    The return value is ``{anchor_ref: {member_ref: {anchor, return}}}``.
    Invalid entries
    fail closed with a useful error instead of silently changing grouping.
    """

    components = {
        c.get("ref"): c
        for c in design.get("components", [])
        if c.get("ref")
    }
    netof = {
        str(node): str(net.get("name") or "")
        for net in design.get("nets", [])
        for node in net.get("nodes", [])
    }
    result = {}
    owners = {}
    for function in design.get("functions", []) or []:
        if not isinstance(function, dict):
            continue
        entries = function.get("layout", []) or []
        if not isinstance(entries, list):
            raise ValueError("functions[].layout must be an array")
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("Invalid decoupling layout metadata")
            if entry.get("kind") != "decoupling":
                raise ValueError("Unsupported functions[].layout kind: " + str(entry.get("kind")))
            if set(entry) - {"kind", "anchor", "return", "members"}:
                raise ValueError("Unknown decoupling layout field")
            anchor = entry.get("anchor")
            return_pin = entry.get("return")
            members = entry.get("members")
            if (
                not isinstance(anchor, str)
                or "." not in anchor
                or not isinstance(return_pin, str)
                or "." not in return_pin
                or not isinstance(members, list)
                or not members
                or any(not isinstance(ref, str) for ref in members)
            ):
                raise ValueError("Invalid decoupling layout metadata")
            anchor_ref = anchor.rsplit(".", 1)[0]
            return_ref = return_pin.rsplit(".", 1)[0]
            if (
                anchor_ref not in components
                or return_ref not in components
                or anchor_ref != return_ref
                or anchor not in netof
                or return_pin not in netof
                or netof[anchor] == netof[return_pin]
                or len(set(members)) != len(members)
            ):
                raise ValueError("Invalid decoupling anchor/return metadata")
            valid_pins = {
                anchor_ref + "." + str(pin.get("number"))
                for pin in components[anchor_ref].get("pins", [])
            }
            if anchor not in valid_pins or return_pin not in valid_pins:
                raise ValueError("Unknown decoupling anchor/return pin")
            for member in members:
                if member not in components or member in (anchor_ref, return_ref):
                    raise ValueError("Invalid decoupling member metadata: " + str(member))
                if member in owners:
                    raise ValueError("Decoupling member has multiple owners: " + member)
                pins = components[member].get("pins", [])
                if len(pins) != 2 or any(
                    str(pin.get("type", "")).lower() != "passive" for pin in pins
                ):
                    raise ValueError("Decoupling member is not a two-terminal passive: " + member)
                member_nets = {
                    netof.get(member + "." + str(pin.get("number")))
                    for pin in pins
                }
                if member_nets != {netof[anchor], netof[return_pin]}:
                    raise ValueError("Decoupling member does not span anchor/return nets: " + member)
                owners[member] = anchor_ref
                result.setdefault(anchor_ref, {})[member] = {
                    "anchor": anchor,
                    "return": return_pin,
                }
    # A frozen supply-transient assessment already names the load whose
    # domain the reservoir supports. Reuse that explicit decision when a
    # real local bypass supplies unambiguous anchor/return pins. This does
    # not infer an owner from shared rail membership or alter frozen nets.
    candidates = {}
    for row in design.get('operatingPoints', []) or []:
        if not isinstance(row, dict) or row.get('kind') != 'supply-transient':
            continue
        owner = row.get('owner')
        bindings = {(r['anchor'], r['return']) for r in result.get(owner, {}).values()}
        for member in row.get('components', []):
            component = components.get(member)
            if not component or member in owners or component.get('dnp') is True or component.get('in_bom') is False:
                continue
            kind = _kind(component, {})
            if not (_is_kind(kind, 'capacitor') or (kind is None and component.get('componentKind') == 'capacitor')):
                continue
            pins = component.get('pins', [])
            if len(pins) != 2 or any(p.get('type') != 'passive' for p in pins):
                continue
            member_nets = {netof.get(member+'.'+str(p['number'])) for p in pins}
            matches = {(a, b) for a, b in bindings if member_nets == {netof[a], netof[b]}}
            if len(matches) == 1:
                anchor, return_pin = next(iter(matches))
                candidates.setdefault(member, set()).add((owner, anchor, return_pin))
    for member, claims in candidates.items():
        if len(claims) == 1:
            owner, anchor, return_pin = next(iter(claims))
            result.setdefault(owner, {})[member] = {'anchor': anchor, 'return': return_pin, 'derivedFrom': 'supply-transient'}
    return result


def _local_supply_hints(
    components,
    kinds,
    netof,
    members,
    supplied,
    decoupling,
):
    """Infer passive ownership for a supply net with one powered load.

    This deliberately examines one blocked net at a time.  A shared +5V or
    ground net therefore has no owner when it feeds multiple active parts,
    while a local rail such as ``IR_VCC`` can claim the R/C parts that touch
    it.  The other terminal may be a shared rail: it is not traversed and does
    not make every shared-rail capacitor belong to the local load.

    Explicit decoupling metadata is authoritative.  Its anchors and members
    are left for ``decoupling_hints`` and atomic closure rather than being
    re-assigned by this conservative inference.
    """

    active_by_net = {}
    for name, refs in members.items():
        endpoints = {
            ref
            for ref in refs
            if ref in components
            and _is_supply_endpoint(components[ref], kinds.get(ref))
        }
        active = {
            ref
            for ref in endpoints
            if _is_powered_load(components[ref], kinds.get(ref))
        }
        # A power-out connector is not an owner, but it still makes a rail
        # shared.  Require one total supply endpoint and one real load so a
        # connector cannot make a local-rail claim while also preventing a
        # shared +5V from being mistaken for a unique D1 rail.
        if (
            _blocked_net(name, supplied)
            and len(endpoints) == 1
            and len(active) == 1
        ):
            active_by_net[name] = next(iter(active))

    if not active_by_net:
        return {}

    declared_members = {
        member
        for owner in decoupling.values()
        for member in owner
    }
    result = {}
    for ref, component in components.items():
        kind = kinds.get(ref)
        if ref in declared_members or not _is_kind(kind, "resistor", "capacitor"):
            continue
        if len(component.get("pins", [])) != 2:
            continue
        names = _component_nets(ref, component, netof)
        if not names or _same_net_passive(ref, component, netof):
            continue
        owners = {
            active_by_net[name]
            for name in names
            if name in active_by_net
        }
        # A passive spanning two separately-owned local rails is ambiguous;
        # leave it to an explicit layout hint or the ordinary signal pass.
        if len(owners) != 1:
            continue
        owner = next(iter(owners))
        # An explicit anchor/member pair remains authoritative for its
        # declared members, but it does not hide another unclaimed R/C on the
        # same unique local rail.  That part can still follow the same owner.
        result.setdefault(owner, set()).add(ref)
    return result


def _power_nets(components, netof, members, supplied):
    """Return rails identified by the frozen net names or pin roles."""

    def supply_pin(pin):
        pin_type = str(pin.get("type", "")).lower()
        if pin_type in {"power_in", "power_out"}:
            return True
        pin_name = str(pin.get("name") or "")
        return bool(_POWER_NAME.fullmatch(pin_name) or _POWER_TOKEN.search(pin_name))

    power_nets = set(supplied)
    for name, refs in members.items():
        if _blocked_net(name, supplied):
            power_nets.add(name)
            continue
        for ref in refs:
            component = components.get(ref)
            if not component:
                continue
            if any(
                netof.get(ref + "." + str(pin.get("number"))) == name
                and supply_pin(pin)
                for pin in component.get("pins", [])
            ):
                power_nets.add(name)
                break
    return power_nets


def _is_shared_return_net(name, components, netof, members, supplied, power_nets):
    """Return true only for a supply/ground-like shared capacitor return."""

    if not name:
        return False
    # A declared rail or a conventional ground/power identity is authoritative
    # even when the snapshot contains only the capacitor on that named net.
    if name in power_nets or _blocked_net(name, supplied):
        return True
    refs = members.get(name, ())
    if len(refs) < 2:
        return False
    # Non-standard rail names are accepted only when the frozen pin roles
    # prove that the net is a supply domain.  A passive net shared by two
    # arbitrary endpoints is not enough evidence for an input filter.
    return any(
        any(
            netof.get(ref + "." + str(pin.get("number"))) == name
            and (
                str(pin.get("type", "")).lower() in {"power_in", "power_out"}
                or _POWER_NAME.fullmatch(str(pin.get("name") or ""))
                or _POWER_TOKEN.search(str(pin.get("name") or ""))
            )
            for pin in component.get("pins", [])
        )
        for ref in refs
        if (component := components.get(ref))
    )


def _active_endpoint_refs(name, components, kinds, netof, members):
    """Return non-connector active symbols terminating a signal net."""

    active_pin_types = {
        "input",
        "output",
        "bidirectional",
        "inout",
        "tri_state",
        "open_collector",
        "open_emitter",
        "power_in",
        "power_out",
    }
    result = set()
    for ref in members.get(name, ()):
        component = components.get(ref)
        kind = kinds.get(ref)
        if (
            not component
            or component.get("objectRole") == "process"
            or _is_passive(kind)
            or _is_kind(kind, "connector")
        ):
            continue
        if any(
            netof.get(ref + "." + str(pin.get("number"))) == name
            and str(pin.get("type", "")).lower() in active_pin_types
            for pin in component.get("pins", [])
        ):
            result.add(ref)
    return result


def _output_bank_claims(components, kinds, netof, members, supplied):
    """Reserve required active output banks before any input walk runs.

    ``required_visual_groups`` requires a non-connector hub and at least
    three directly attached resistor branches to stay together.  Mirroring
    that evidence here prevents a later input walk from claiming one of those
    branches merely because the same net also reaches another driver's input.
    Overlapping source claims are merged into one atomic unit; such overlap is
    already an ambiguous required-circuit ownership and cannot be split.
    """

    owner_refs = {}
    banks = []
    for source, component in components.items():
        if (
            len(component.get("pins", [])) <= 2
            or component.get("objectRole") == "process"
            or _is_passive(kinds.get(source))
            or _is_kind(kinds.get(source), "connector")
        ):
            continue
        branches = set()
        for pin in component.get("pins", []):
            if str(pin.get("type", "")).lower() != "output":
                continue
            source_key = source + "." + str(pin.get("number"))
            name = netof.get(source_key)
            if not name or _blocked_net(name, supplied):
                continue
            for ref in members.get(name, ()):
                if (
                    ref != source
                    and _is_kind(kinds.get(ref), "resistor")
                    and len(components[ref].get("pins", [])) == 2
                    and not _same_net_passive(ref, components[ref], netof)
                ):
                    branches.add(ref)
        if len(branches) < 3:
            continue
        banks.append(frozenset({source, *branches}))
        for ref in branches:
            owner_refs.setdefault(ref, set()).add(source)

    # Merge transitively overlapping required banks.  This only joins active
    # endpoints when the required circuits themselves overlap.
    units = []
    for bank in banks:
        merged = set(bank)
        changed = True
        while changed:
            changed = False
            for index, unit in enumerate(units):
                if merged.intersection(unit):
                    merged.update(unit)
                    units.pop(index)
                    changed = True
                    break
        units.append(frozenset(merged))

    unique_owners = {
        ref: next(iter(owners))
        for ref, owners in owner_refs.items()
        if len(owners) == 1
    }
    ambiguous = {
        ref
        for ref, owners in owner_refs.items()
        if len(owners) > 1
    }
    return unique_owners, ambiguous, units


def _input_conditioning_groups(
    components,
    kinds,
    netof,
    members,
    supplied,
    drivers,
    atomic_sets,
):
    """Find unambiguous driver-input series-R plus shunt-C subgraphs.

    The returned mapping is ``{driver_ref: {resistor_ref, capacitor_ref}}``.
    It deliberately recognizes only one resistor on a driver's input net,
    one capacitor on the resistor's signal net, and a return net evidenced by
    a supplied name or a frozen power pin.  Any competing passive candidate
    fails closed so the ordinary signal walk retains ownership.
    """

    if not drivers:
        return {}

    power_nets = _power_nets(components, netof, members, supplied)
    atomic_refs = set().union(*(set(unit) for unit in atomic_sets)) if atomic_sets else set()
    candidates = {}

    for driver in sorted(drivers):
        component = components[driver]
        input_nets = {
            netof.get(driver + "." + str(pin.get("number")))
            for pin in component.get("pins", [])
            if str(pin.get("type", "")).lower() == "input"
            and netof.get(driver + "." + str(pin.get("number")))
            and not _blocked_net(
                netof.get(driver + "." + str(pin.get("number"))), supplied
            )
        }
        for input_net in sorted(input_nets):
            # An active source sharing the driver's input net makes the
            # resistor a possible member of that source's output bank.  A
            # connector endpoint is intentionally excluded: interface pins
            # are allowed to feed an otherwise unambiguous local filter.
            if _active_endpoint_refs(
                input_net, components, kinds, netof, members
            ) - {driver}:
                continue
            input_resistors = sorted(
                ref
                for ref in members.get(input_net, ())
                if ref != driver
                and _is_kind(kinds.get(ref), "resistor")
                and len(components[ref].get("pins", [])) == 2
                and not _same_net_passive(ref, components[ref], netof)
            )
            # A direct input shunt, a second resistor, or another passive
            # branch makes the input topology ambiguous.  Keep the legacy
            # driver group in that case.
            input_passives = {
                ref
                for ref in members.get(input_net, ())
                if ref in components and _is_passive(kinds.get(ref))
            }
            if len(input_resistors) != 1 or input_passives != set(input_resistors):
                continue
            resistor = input_resistors[0]
            if resistor in atomic_refs:
                continue
            resistor_pins = [
                resistor + "." + str(pin.get("number"))
                for pin in components[resistor].get("pins", [])
            ]
            resistor_signal = [
                netof.get(key)
                for key in resistor_pins
                if netof.get(key) and netof.get(key) != input_net
            ]
            if len(resistor_signal) != 1:
                continue
            signal_net = resistor_signal[0]
            if _blocked_net(signal_net, supplied) or signal_net in power_nets:
                continue
            # A second active endpoint on the resistor/capacitor junction
            # would make the intended local branch ambiguous.  Keep the
            # ordinary signal traversal in charge in that case.
            if _active_endpoint_refs(
                signal_net, components, kinds, netof, members
            ):
                continue

            signal_passives = {
                ref
                for ref in members.get(signal_net, ())
                if ref in components and _is_passive(kinds.get(ref))
            }
            signal_caps = sorted(
                ref
                for ref in signal_passives
                if _is_kind(kinds.get(ref), "capacitor")
                and len(components[ref].get("pins", [])) == 2
                and not _same_net_passive(ref, components[ref], netof)
            )
            if len(signal_caps) != 1 or signal_passives != {resistor, signal_caps[0]}:
                continue
            capacitor = signal_caps[0]
            if capacitor in atomic_refs:
                continue
            capacitor_pins = [
                capacitor + "." + str(pin.get("number"))
                for pin in components[capacitor].get("pins", [])
            ]
            capacitor_other = [
                netof.get(key)
                for key in capacitor_pins
                if netof.get(key) and netof.get(key) != signal_net
            ]
            if len(capacitor_other) != 1:
                continue
            return_net = capacitor_other[0]
            if not _is_shared_return_net(
                return_net,
                components,
                netof,
                members,
                supplied,
                power_nets,
            ):
                continue

            pair = (resistor, capacitor)
            candidates.setdefault(pair, set()).add(driver)

    # A passive pair that appears reachable from two drivers is not assigned
    # to either one.  This keeps shared input nets conservative and preserves
    # exact-once ownership for the later ordinary walks.
    result = {}
    for (resistor, capacitor), owners in candidates.items():
        if len(owners) != 1:
            continue
        owner = next(iter(owners))
        result.setdefault(owner, set()).update((resistor, capacitor))
    return result


def _interface_feed_claims(connectors, components, kinds, netof, assigned, atomic_sets, supplied):
    """Keep unambiguous series supply/return entry branches with their port.

    Walk only degree-two terminal nets from connector power/return pins. Stop
    at any fanout, active load, another connector or previously owned part;
    a shared rail is never traversed to claim its decouplers. Competing ports
    do not get a serialization-dependent winner.
    """
    endpoints = {}
    for key, net in netof.items():
        endpoints.setdefault(net, set()).add(key)
    atomic = set().union(*atomic_sets) if atomic_sets else set()
    claims = {}
    for connector in sorted(connectors):
        for pin in components[connector].get('pins', []):
            start = connector+'.'+str(pin['number'])
            net = netof.get(start)
            if net is None or not (pin.get('type') in ('power_in', 'power_out') or _blocked_net(net, supplied)):
                continue
            current, seen, branch = start, set(), set()
            while current in netof:
                peers = endpoints.get(netof[current], set())-{current}
                if len(peers) != 1:
                    break
                other = next(iter(peers)); ref = other.rsplit('.', 1)[0]
                part = components.get(ref)
                if part and _is_kind(kinds.get(ref), 'connector'):
                    branch.clear()
                    break
                if (not part or ref in assigned or ref in atomic or ref in seen
                    or not _is_kind(kinds.get(ref), 'resistor', 'inductor', 'ferrite', 'ferrite-bead')
                    or part.get('electricalRole') not in ('routing-bridge', 'supply-filter')
                    or len(part.get('pins', [])) != 2):
                    break
                terminals = {ref+'.'+str(p['number']) for p in part['pins']}
                if other not in terminals or len(terminals) != 2 or len(_component_nets(ref, part, netof)) != 2:
                    break
                branch.add(ref); seen.add(ref)
                current = next(iter(terminals-{other}))
            for ref in branch:
                claims.setdefault(ref, set()).add(connector)
    return {ref: next(iter(owners)) for ref, owners in claims.items() if len(owners) == 1}


def groups(design, resources):
    """Return deterministic functional groups for a generic layout.

    The caller may still supply explicit groups.  This fallback is used when
    the model leaves them out; every result covers each component exactly once
    and only existing net adjacency is used to attach passive chains.
    """

    symbols = (resources or {}).get("symbols", {})
    # Either host-owned drawing rules or an explicit appearance kind is enough
    # to identify a frozen symbol.  Specialized evidence snapshots often have
    # the latter without copying renderer metadata; rejecting them collapses
    # the whole design into generic ``Circuit`` fallback grouping.
    if not symbols or not any(
        isinstance(symbol, dict)
        and (
            bool(symbol.get("drawingRules"))
            or (
                isinstance((symbol.get("appearance") or {}).get("kind"), str)
                and bool((symbol.get("appearance") or {}).get("kind"))
            )
        )
        for symbol in symbols.values()
    ):
        return None

    components = {
        c["ref"]: c for c in design.get("components", []) if c.get("ref")
    }
    if not components:
        return None
    kinds = {ref: _kind(c, resources) for ref, c in components.items()}
    netof, members = _net_graph(design)
    supplied = set(design.get("supplied_nets", []))
    blocked = lambda name: _blocked_net(name, supplied)
    decoupling = decoupling_hints(design)
    local_supply = _local_supply_hints(
        components,
        kinds,
        netof,
        members,
        supplied,
        decoupling,
    )
    declared_members = {
        member
        for owner in decoupling.values()
        for member in owner
    }
    # Reserve every declared anchor and member during signal expansion.  This
    # keeps receiver, driver and ordinary-IC ownership stable even when two
    # anchors share a power domain or appear on a neighbouring signal net.
    reserved_owners = {owner: owner for owner in decoupling}
    reserved_owners.update(
        {
            member: owner
            for owner, owned in decoupling.items()
            for member in owned
        }
    )
    output_bank_owners, output_bank_ambiguous, output_bank_units = _output_bank_claims(
        components,
        kinds,
        netof,
        members,
        supplied,
    )
    block_sets = []
    for instance in design.get("blockInstances", []) or []:
        bindings = instance.get("bindings", {}) if isinstance(instance, dict) else {}
        refs = {
            ref
            for ref in bindings.values()
            if isinstance(ref, str) and ref in components
        } if isinstance(bindings, dict) else set()
        if refs:
            block_sets.append(frozenset(refs))
    # A frozen block and a declared decoupling owner/member pair are both
    # indivisible presentation units.  Closing over their union matters when
    # a block endpoint is claimed before the owner's ordinary local group: the
    # member must follow the owner instead of being left for a later rail pass.
    atomic_sets = block_sets + [
        frozenset({owner, *owned})
        for owner, owned in decoupling.items()
    ] + output_bank_units
    # Required output-bank branches must be claimed by their source before a
    # target driver's input walk can see the same net.  A branch with
    # competing source owners is held back by a marker and recovered through
    # the merged output-bank atomic unit when either source is emitted.
    reserved_owners.update(
        {
            ref: owner
            for ref, owner in output_bank_owners.items()
            if ref not in declared_members
        }
    )
    reserved_owners.update(
        {
            ref: "output-bank-ambiguous"
            for ref in output_bank_ambiguous
            if ref not in declared_members
        }
    )
    drivers = [
        ref
        for ref, component in components.items()
        if _is_driver_candidate(component, kinds.get(ref))
    ]
    input_conditioning = _input_conditioning_groups(
        components,
        kinds,
        netof,
        members,
        supplied,
        drivers,
        atomic_sets,
    )
    # Input-conditioning members are deliberately kept out of both the
    # driver and receiver signal walks.  Use a marker distinct from the
    # driver reference: decoupling members are allowed back into their own
    # owner's group, whereas input RC parts become a separate local group.
    reserved_owners.update(
        {
            member: "input-conditioning:" + owner
            for owner, owned in input_conditioning.items()
            for member in owned
        }
    )
    assigned = set()
    result = []

    def atomic_refs(refs):
        """Expand references to complete block and decoupling units."""

        expanded = {ref for ref in refs if ref in components}
        changed = True
        while changed:
            changed = False
            for unit in atomic_sets:
                if expanded.intersection(unit) and not unit.issubset(expanded):
                    expanded.update(unit)
                    changed = True
        return expanded

    def add(title, refs):
        refs = atomic_refs(refs)
        selected = [
            ref for ref in components if ref in refs and ref not in assigned
        ]
        if selected:
            result.append(
                {
                    "id": "functional-" + str(len(result) + 1),
                    "title": title,
                    "references": selected,
                }
            )
            assigned.update(selected)

    # Emit each driver's complete set of independent input RC pairs before
    # ordinary signal expansion can claim either passive.  Keeping all pairs
    # for one driver together lets the generic local graph route each R-C
    # signal edge inside a compact conditioning island.
    for owner in sorted(input_conditioning):
        add("输入调理", input_conditioning[owner])

    receivers = [
        ref
        for ref in components
        if _is_kind(kinds.get(ref), "infrared-receiver")
    ]
    shared_interfaces = _shared_interface_connectors(
        components,
        kinds,
        netof,
        members,
        supplied,
        atomic_sets,
    )

    # Walk receiver/driver signal branches.  This covers long chains such as
    # D1.OUT -> R16 -> R17 -> R15 -> J1 and U1.SEG -> R -> 0R -> DS1.
    for ref in receivers:
        owned = _expand_signal_subgraph(
            ref,
            components,
            kinds,
            netof,
            members,
            blocked,
            reserved_owners=reserved_owners,
        )
        owned.difference_update(shared_interfaces)
        owned.update(decoupling.get(ref, {}).keys())
        owned.update(local_supply.get(ref, set()))
        add("接口与接收", owned)
    for ref in drivers:
        owned = _expand_signal_subgraph(
            ref,
            components,
            kinds,
            netof,
            members,
            blocked,
            include_endpoints=False,
            reserved_owners=reserved_owners,
        )
        owned.difference_update(shared_interfaces)
        # A declared decoupling owner is the only permitted way for a
        # supply-rail capacitor to follow its active component.  Shared
        # +5V/GND membership alone is intentionally insufficient.
        owned.update(decoupling.get(ref, {}).keys())
        owned.update(local_supply.get(ref, set()))
        add("驱动与滤波", owned)

    # A connector serving multiple powered modules is a separate interface
    # island.  Its module-side branches keep their local passive chains while
    # the layout backend can connect this island with short labelled stubs.
    interface_feeds = _interface_feed_claims(shared_interfaces, components, kinds, netof,
                                            assigned, atomic_sets, supplied)
    add("共享接口", shared_interfaces | set(interface_feeds))

    # A reviewed decoupling anchor can be an ordinary IC (or another
    # multi-pin symbol) that is not a receiver and does not meet the driver's
    # output-count heuristic.  Give it an owner group before generic display,
    # rail and leftovers passes can separate its members.
    for owner, owned in decoupling.items():
        if owner not in assigned:
            add("局部去耦", {owner, *owned})

    # A unique powered load on a local blocked rail is the only implicit
    # owner.  Emit ordinary IC/box anchors before the generic supply pass so
    # their R/C members remain together.  Receiver and driver anchors were
    # extended above.
    for owner, owned in local_supply.items():
        if owner not in assigned:
            add("局部供电", {owner, *owned})

    # Display/endpoint symbols are separate visual islands.  Their pins get
    # short local stubs and the host's same-net labels connect them to the
    # source-side bank.  This avoids a display body becoming the far corner of
    # a driver group's ELK rectangle.
    display_refs = {
        ref for ref in components if _is_kind(kinds.get(ref), "display")
    }
    for owner in tuple(display_refs):
        display_refs.update(local_supply.get(owner, set()))
    add("显示模块", display_refs)

    # Decouplers whose two terminals are both on declared rails form a small
    # supply group.  They are attached by rail identity, but the rail itself
    # was never traversed, so unrelated signal shunts do not leak in.
    supply_parts = set()
    for ref, component in components.items():
        if not _is_passive(kinds.get(ref)) or len(component.get("pins", [])) != 2:
            continue
        names = _component_nets(ref, component, netof)
        if len(names) == 2 and names and all(blocked(name) for name in names):
            if ref not in declared_members:
                supply_parts.add(ref)
    add("电源与去耦", supply_parts)

    # Preserve the old compact group for explicit same-net two-terminal links.
    # A true serial 0R (two distinct nets) has already been captured by a
    # signal expansion and must not be reattached through a global label.
    same_net = set()
    for ref, component in components.items():
        if not _is_passive(kinds.get(ref)) or len(component.get("pins", [])) != 2:
            continue
        names = _component_nets(ref, component, netof)
        if len(names) == 1:
            same_net.add(ref)
    add("零欧跨线", same_net)

    leftovers = {
        ref
        for ref, component in components.items()
        if ref not in assigned and component.get("objectRole") != "process"
    }
    add("其他电路", leftovers)
    add(
        "工艺与装配说明",
        {
            ref
            for ref, component in components.items()
            if component.get("objectRole") == "process"
        },
    )
    return result


def interface_feed_nets(design, resources, visual_groups):
    """Return existing degree-two entry nets that must be shown with local wire.

    Supply/return label policy is relaxed only inside an already selected
    connector group, never across a shared rail or across explicit groups.
    """
    components = {c['ref']: c for c in design.get('components', [])}
    kinds = {ref: _kind(c, resources) for ref, c in components.items()}
    connectors = {r for r in components if _is_kind(kinds[r], 'connector')}
    groupof = {r: g['id'] for g in visual_groups for r in g['references']}
    port_groups = {groupof[r] for r in connectors if r in groupof}
    assigned = {r for r in components if groupof.get(r) not in port_groups}
    netof, _ = _net_graph(design)
    atomic = [frozenset(b.get('bindings', {}).values()) for b in design.get('blockInstances', [])]
    claims = _interface_feed_claims(connectors, components, kinds, netof, assigned, atomic,
                                    set(design.get('supplied_nets', [])))
    owners = {**claims, **{r: r for r in connectors}}
    result = set()
    for net in design.get('nets', []):
        refs = [k.rsplit('.', 1)[0] for k in net.get('nodes', [])]
        if (len(refs) == 2 and refs[0] != refs[1] and all(r in owners for r in refs)
            and owners[refs[0]] == owners[refs[1]] and groupof.get(refs[0]) == groupof.get(refs[1])):
            result.add(net['name'])
    return result
