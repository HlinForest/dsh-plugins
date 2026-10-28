"""Bounded routing-feedback search independent of board names or coordinates."""
class FeedbackSearch:
    def __init__(self,minimum,has_relations,copper_nets,limit=9):
        self.minimum=minimum;self.copper=set(copper_nets);self.limit=limit;self.tried=set();self.count=0
        first=minimum if has_relations else max(minimum,1.5)
        self.queue=[(first,())];self.fallbacks=[(gap,()) for gap in [minimum,max(minimum,1.5),max(minimum,3.0)]]
    def bind_native_copper(self,zones):
        # DRC uses names from the native PCB, including hierarchy paths.
        # Resolve through verified copper zones; never strip sheet prefixes
        # and accidentally merge distinct nets sharing a leaf name.
        self.copper={zone['name'] for zone in zones}

    def next(self):
        if self.count>=self.limit:return None
        while self.queue or self.fallbacks:
            gap,nets=(self.queue if self.queue else self.fallbacks).pop(0);key=(gap,tuple(sorted(set(nets))))
            if key in self.tried:continue
            self.tried.add(key);self.count+=1
            return {'componentGapMm':gap,'nets':list(key[1])}
        return None
    def feedback(self,candidate,failed):
        """Explore a new focus even when a previous cumulative focus regressed.

        Copper domains have already declared connectivity via fill. Prioritize
        remaining signal endpoints before accumulating all plane endpoints.
        Retain both branches; no result overwrites the best completed candidate.
        """
        failed=set(failed);current=set(candidate['nets']);gap=candidate['componentGapMm']
        combined=current|failed
        variants=[combined-self.copper,combined,failed-self.copper]
        variants += [{net} for net in sorted(failed,key=lambda n:(n in self.copper,n))]
        variants += [failed]
        fresh=[]
        for nets in variants:
            key=(gap,tuple(sorted(nets)))
            if nets and key not in self.tried and key not in fresh:fresh.append(key)
        # Reserve the final attempts for geometric gap alternatives; all are
        # still derived from visible minimum spacing, never reference positions.
        if self.count<self.limit-2:self.queue=fresh+[x for x in self.queue if x not in fresh]
        else:self.queue=[]


def quality_dominates(candidate,baseline):
    """Copper quality must improve without trading length for added tiny bends."""
    keys=('trackLengthMm','shortSegmentsUnder05mm','degree2Bends')
    return all(candidate[k]<=baseline[k]+1e-6 for k in keys) and any(candidate[k]<baseline[k]-1e-6 for k in keys)


def has_filter_bank_opportunity(relations):
    """Offer joint placement for reviewed shunts sharing a receiver/return."""
    groups={}
    for relation in relations.values():
        if relation.get('kind')!='signal-filter':continue
        key=(relation['anchor']['ref'],relation['return']['ref'],relation['returnNet'])
        groups[key]=groups.get(key,0)+1
    return any(count>=2 for count in groups.values())


def prefer_candidate(candidate,baseline):
    """Native connectivity/parity gates precede the copper-quality comparison."""
    if baseline is None:return True
    a,b=candidate['drc'],baseline['drc']
    if a['passed']!=b['passed']:return a['passed']
    if a['passed']:
        return a['warnings']<=b['warnings'] and quality_dominates(candidate['routingQuality'],baseline['routingQuality'])
    keys=('unconnected','parity','errors','warnings')
    sa=tuple(a.get(k,0) for k in keys);sb=tuple(b.get(k,0) for k in keys)
    return sa<sb or sa==sb and quality_dominates(candidate['routingQuality'],baseline['routingQuality'])

def repair_shortlist(candidates,limit=3):
    """Quality of an incomplete route must not choose its sole repair seed.

    Keep a bounded frontier of actual completed layouts. Distinct obstruction
    geometry may be repairable even when its raw short-fragment count is worse.
    """
    eligible=[row for row in candidates if not row[1]['drc']['passed'] and row[1]['drc']['unconnected'] and not row[1]['drc']['violations'] and not row[1]['drc']['parity']]
    def rank(row):
        d=row[1]['drc'];q=row[1]['routingQuality']
        return (d['unconnected'],d['errors'],d['warnings'],q['shortSegmentsUnder05mm'],q['trackLengthMm'],q['degree2Bends'])
    return sorted(eligible,key=rank)[:limit]


def repair_time_budget(remaining,seeds_left):
    """Reuse unused search time while reserving a minimum run for later seeds.

    The caller owns the total deadline. A quickly rejected geometry must not
    strand its unused time when another seed has reached native repair.
    """
    available=float(remaining)-15*max(0,int(seeds_left)-1)
    return min(300,available) if available>=15 else 0


def copper_partition_progress(before,after):
    """Accept an intermediate search seed only when copper groups merge.

    No previously connected pair may split, and every physical pad must still
    be accounted for. This does not accept the board or replace native DRC.
    """
    old={n['net']:n for n in before['networks']};new={n['net']:n for n in after['networks']}
    if set(old)!=set(new):return False
    improved=False
    for net,a in old.items():
        b=new[net]
        if a.get('ambiguousPads') or b.get('ambiguousPads'):return False
        groups=lambda n:[frozenset(p['uuid'] for p in g['members']) for g in n['connectedPadGroups']]
        ag,bg=groups(a),groups(b)
        if not ag or not bg or set().union(*ag)!=set().union(*bg):return False
        if any(not any(group<=other for other in bg) for group in ag):return False
        improved=improved or len(bg)<len(ag)
    return improved


def anchored_copper_progress(before,after,anchors):
    """Rank return repair by pads reaching the declared owner, not island count.

    Isolated peers may separate while one reaches the owner; already owner-
    connected pads and every unaffected network must retain their connections.
    """
    old={n['net']:n for n in before['networks']};new={n['net']:n for n in after['networks']}
    if set(old)!=set(new):return False
    improved=False
    for net,a in old.items():
        b=new[net]
        if a.get('ambiguousPads') or b.get('ambiguousPads'):return False
        groups=lambda n:[frozenset(p['uuid'] for p in g['members']) for g in n['connectedPadGroups']]
        ag,bg=groups(a),groups(b)
        if not ag or not bg or set().union(*ag)!=set().union(*bg):return False
        anchor_ids={p['uuid'] for g in a['connectedPadGroups'] for p in g['members'] if (p['ref'],p['pin']) in anchors}
        if anchor_ids:
            aa=[g for g in ag if anchor_ids<=g];bb=[g for g in bg if anchor_ids<=g]
            if len(aa)!=1 or len(bb)!=1 or not aa[0]<=bb[0]:return False
            improved=improved or len(bb[0])>len(aa[0])
        else:
            if any(not any(g<=h for h in bg) for g in ag):return False
            improved=improved or len(bg)<len(ag)
    return improved


def diverse_filter_poses(poses):
    """Try distinct obstruction directions before spending the budget nearby.

    Keep owner-return contact as the first priority; within each tier, take
    one pose per component and angular sector before repeating a sector.
    Coordinates are offsets from the current generated board only.
    """
    import math
    ordered=[]
    for contact in (True,False):
        queues={}
        for pose in poses:
            if bool(pose.get("joinsOwnerReturnEstimate"))!=contact:continue
            x,y=pose["offsetMm"]
            sector=int(math.floor(math.atan2(y,x)*4/math.pi+.5))%8 if x or y else -1
            queues.setdefault((pose["ref"],sector),[]).append(pose)
        while queues:
            for key in list(queues):
                ordered.append(queues[key].pop(0))
                if not queues[key]:del queues[key]
    return ordered
