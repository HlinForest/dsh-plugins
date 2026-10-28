"""Bounded presentation search over independently checked complete drawings."""
import copy,itertools,json,math,shutil,tempfile,time
from pathlib import Path
from functional_groups import _kind,decoupling_hints
from shunt_fields import column_candidates


def candidates(design,resources,layout,explicit_rotations=(),allow_clusters=False,merge_groups=True):
    components={c['ref']:c for c in design['components']}
    fixed={r for b in resources.get('blocks',[]) for r in b.get('bindings',{}).values()}
    eligible={ref for ref,c in components.items() if ref not in fixed and ref not in explicit_rotations
              and _kind(c,resources)=='capacitor' and len(c.get('pins',[]))==2
              and not resources['symbols'][c['librarySymbol']].get('drawingRules')}
    filters=column_candidates(design,resources,layout['groups']);hints=decoupling_hints(design)
    banks=[]
    for group in layout['groups']:
        refs=set(group['references'])
        owners=[r for r in refs if sum(p.get('type')=='output' for p in components[r].get('pins',[]))>=3]
        if len(owners)!=1 or any(r!=owners[0] and len(components[r].get('pins',[]))>2 for r in refs):continue
        for role,members in [('input-filter',refs&filters),('power-bypass',refs&set(hints.get(owners[0],{})))]:
            if not members or role=='input-filter' and len(members)<2:continue
            # Preserve the whole bank when any member has explicit geometry.
            if not members<=eligible or not members<=set(layout['rotations']):continue
            if len({layout['rotations'][r]%180 for r in members})!=1:continue
            banks.append({'group':group['id'],'role':role,'references':sorted(members)})
    banks.sort(key=lambda b:(-len(b['references']),b['role'],b['group']))
    if len(banks)<=3:choices=list(itertools.product((0,1),repeat=len(banks)))
    else:
        choices=[(0,)*len(banks)]
        choices.extend(tuple(int(i==j) for j in range(len(banks))) for i in range(min(6,len(banks))))
        choices.append((1,)*len(banks))
    plans=[]
    for index,bits in enumerate(choices):
        candidate=copy.deepcopy(layout)
        for flip,bank in zip(bits,banks):
            if flip:
                for ref in bank['references']:candidate['rotations'][ref]=(candidate['rotations'][ref]+180)%360
        plans.append({'id':index,'flippedBanks':[i for i,flip in enumerate(bits) if flip],'layout':candidate})
    if allow_clusters:
        from interface_clusters import alternatives
        variants=alternatives(design,resources,layout,explicit_rotations,merge_groups=merge_groups)
        original=list(plans)
        # Retain every original orientation. Add at most eight cluster
        # alternatives; no unsuccessful merge can remove the baseline.
        for variant in variants:
            for prior in original[:max(1,8//len(variants))]:
                candidate=copy.deepcopy(variant['layout'])
                for i in prior['flippedBanks']:
                    for ref in banks[i]['references']:candidate['rotations'][ref]=(candidate['rotations'][ref]+180)%360
                plans.append({'id':len(plans),'flippedBanks':prior['flippedBanks'],
                              'layout':candidate,'cluster':variant['cluster']})
    return banks,plans


def select_candidate(plans,out,render,measure):
    """Publish one checked candidate; failed attempts never replace it.

    Render owns native/net/PDF verification; measure owns an explicit score.
    The selector accepts no design, netlist, AD file, or component coordinate.
    """
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    scratch=Path(tempfile.mkdtemp(prefix='.orientation-',dir=out)).resolve()
    # Only the exact newly-created directory can be recursively cleaned.
    if scratch.parent!=out.resolve() or not scratch.name.startswith('.orientation-'):
        raise ValueError('Candidate directory escaped its output root')
    records=[];winner=None;partitions={}
    try:
        for plan in plans:
            print(json.dumps({'event':'command','name':'原理图候选','args':[str(len(records)+1)+' / '+str(len(plans))]},ensure_ascii=False),flush=True)
            started=time.monotonic()
            directory=scratch/str(plan['id']);directory.mkdir()
            record={'id':plan['id'],'flippedBanks':plan['flippedBanks'],'rotations':plan['layout']['rotations']}
            if plan.get('cluster'):record['cluster']=plan['cluster']
            try:
                report=render(copy.deepcopy(plan['layout']),directory)
                record.update(status=report.get('status'),errors=report.get('errors',[]))
                if report.get('status')=='passed':
                    measured=measure(directory,report);record.update(measured)
                    if not measured.get('score') or any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in measured['score']):
                        raise ValueError('Candidate score must contain finite numbers')
                    if measured.get('routingStatus','passed')!='passed':record['status']='failed'
                    else:
                        partition=tuple(sorted(tuple(sorted(g['references'])) for g in plan['layout'].get('groups',[])))
                        orientation_score=measured.get('orientationScore',measured['score'])
                        if not orientation_score or any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in orientation_score):
                            raise ValueError('Orientation score must contain finite numbers')
                        local_key=tuple(orientation_score)+(plan['id'],)
                        key=tuple(measured['score'])+(plan['id'],)
                        if partition not in partitions or local_key<partitions[partition][0]:
                            partitions[partition]=(local_key,key,directory,report,plan['id'])
            except Exception as error:record.update(status='failed',errors=[str(error)])
            record['seconds']=round(time.monotonic()-started,3);records.append(record)
        if partitions:
            _,key,directory,report,ident=min(partitions.values(),key=lambda row:row[1])
            winner=(key,directory,report,ident)
        local_winners={row[4] for row in partitions.values()}
        for record in records:record['orientationWinnerForGrouping']=record['id'] in local_winners
        summary={'method':'checked-whole-drawing-presentation-search',
                 'selection':'First minimize physical drawing complexity within each grouping; then compare grouping winners including label-island span.',
                 'candidates':records,
                 'selected':winner[3] if winner else None,'scope':'Presentation alternatives only; not AD equivalence or global optimality.'}
        (out/'orientation-search.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
        if winner is None:raise ValueError('No independently checked orientation candidate; see orientation-search.json')
        for entry in winner[1].iterdir():
            if entry.is_symlink():raise ValueError('Unexpected generated symlink')
            target=out/entry.name
            if entry.is_dir():shutil.copytree(entry,target,dirs_exist_ok=True)
            else:shutil.copy2(entry,target)
        return winner[2],summary
    finally:
        shutil.rmtree(scratch)
