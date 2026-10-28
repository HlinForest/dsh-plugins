"""Align an isolated series pair or connector feed by its facing terminal axes."""
import math


def place(group, design, specs, pinmap, gap, resources=None):
    refs = group["references"]
    if len(refs) != 2:
        return None
    comps = {c["ref"]: c for c in design["components"]}
    if any(len(comps[r]["pins"]) != 2 for r in refs):
        from functional_groups import interface_feed_nets
        if not resources or not interface_feed_nets(design, resources, [group]):
            return None
    shared = [n for n in design["nets"] if all(any(k.rsplit(".", 1)[0] == r for k in n["nodes"]) for r in refs)]
    if len(shared) != 1 or len(shared[0]["nodes"]) != 2:
        return None
    a, b = shared[0]["nodes"]
    ar, br = a.rsplit(".", 1)[0], b.rsplit(".", 1)[0]
    ap, bp = pinmap[a], pinmap[b]
    direction = ap["direction"]
    if direction not in ([1, 0], [-1, 0], [0, 1], [0, -1]) or bp["direction"] != [-v for v in direction]:
        return None
    axis = 0 if direction[0] else 1
    sign = direction[axis]
    size = "width" if axis == 0 else "height"
    sa, sb = specs[ar], specs[br]
    if sign > 0:
        clearance = sa["_low"][axis] + sa[size] - sb["_low"][axis] - ap["pos"][axis] + bp["pos"][axis]
    else:
        clearance = sb["_low"][axis] + sb[size] - sa["_low"][axis] + ap["pos"][axis] - bp["pos"][axis]
    distance = math.ceil(max(7.62, clearance + gap) / 1.27) * 1.27
    end = [ap["pos"][i] + direction[i] * distance for i in range(2)]
    positions = {ar: [0, 0], br: [end[i] - bp["pos"][i] for i in range(2)]}
    low = [min(positions[r][i] + specs[r]["_low"][i] for r in refs) - (5.08 if i == 0 else 10.16) for i in range(2)]
    high = [max(positions[r][i] + specs[r]["_low"][i] + specs[r]["width" if i == 0 else "height"] for r in refs) + 5.08 for i in range(2)]
    return {
        "id": group["id"], "width": high[0] - low[0], "height": high[1] - low[1],
        "children": [{"id": r, "x": positions[r][0] + specs[r]["_low"][0] - low[0],
                      "y": positions[r][1] + specs[r]["_low"][1] - low[1]} for r in refs],
        "edges": [{"sections": [{"startPoint": {"x": ap["pos"][0] - low[0], "y": ap["pos"][1] - low[1]},
                                 "endPoint": {"x": end[0] - low[0], "y": end[1] - low[1]}}]}],
    }
