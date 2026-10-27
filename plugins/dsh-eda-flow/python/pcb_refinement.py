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
