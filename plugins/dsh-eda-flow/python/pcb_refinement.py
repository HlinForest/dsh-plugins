"""Bounded routing-feedback search independent of board names or coordinates."""
class FeedbackSearch:
    def __init__(self,minimum,has_relations,copper_nets,limit=9):
        self.minimum=minimum;self.copper=set(copper_nets);self.limit=limit;self.tried=set();self.count=0
        first=minimum if has_relations else max(minimum,1.5)
        self.queue=[(first,())];self.fallbacks=[(gap,()) for gap in [minimum,max(minimum,1.5),max(minimum,3.0)]]
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
