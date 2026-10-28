"""Transactional, bounded post-route repair; each native board gets its own process.

 This avoids lifetime hazards in pcbnew's aggregate SWIG proxies. Failed poses
 stay in the evidence directory and never replace the selected design.
"""
import sys,subprocess,time,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from record_io import read_json as read,write_json as write
from pcb_refinement import copper_partition_progress,anchored_copper_progress,diverse_filter_poses

def repair(request,source,dest):
 source=Path(source).resolve();dest=Path(dest).resolve();dest.mkdir(parents=True,exist_ok=True)
 report={'adopted':False,'attempts':[],'geometrySource':'current generated board only','fixedCoordinatesAdded':False,'electricalAssignmentsChanged':False}
 plan=request['plan']
 if len(plan.get('activeLayers',[]))!=1:
  report['reason']='bounded local repair currently supports one routing layer';write(dest/'result.json',report);return report
 request_file=dest/'request.json';write(request_file,request);worker=Path(__file__).with_name('pcb_local_repair.py');started=time.monotonic()
 budget=min(300,max(15,float(request.get('_localRepairSeconds',300))))
 def run(mode,board,out,*args):
  remaining=budget-(time.monotonic()-started)
  if remaining<=0:raise TimeoutError('Bounded local repair budget exhausted')
  result=subprocess.run([sys.executable,str(worker),mode,str(request_file),str(board),str(out),*map(str,args)],capture_output=True,timeout=min(180,remaining),creationflags=0x08000000 if os.name=='nt' else 0)
  with (dest/'worker.log').open('ab') as stream:stream.write(result.stdout+result.stderr)
  if result.returncode:raise ValueError('Native local repair worker failed: '+result.stderr.decode('utf8',errors='replace')[-1200:])
 def candidate_facts(candidate):
  facts_file=candidate/'board-facts.json';run('facts',candidate,facts_file);facts=read(facts_file)
  protected=set(plan.get('placements',{}))|{ref for ref,v in before['poses'].items() if v['locked']}
  for relation in request.get('process',{}).get('relations',[]):
   protected.add(relation['ref']);protected.update(relation[k]['ref'] for k in ('anchor','return') if k in relation)
  preserved=facts['identity']==before['identity'] and facts['lockedCopper']==before['lockedCopper'] and all(facts['poses'].get(ref)==before['poses'].get(ref) for ref in protected)
  sides=all(facts['poses'][ref]['side']==pose['side'] for ref,pose in before['poses'].items())
  contract=preserved and sides and set(facts['layers'])<=set(plan['activeLayers']) and (plan.get('allowVias',True) or not facts['vias'])
  return facts,contract,{'identityAndProtectedGeometryPreserved':preserved,'assemblySidesPreserved':sides,'physicalCopperConnected':facts['copper']['allPhysicalPadNetworksConnected']}
 def acceptable(candidate):
  facts,contract,checks=candidate_facts(candidate)
  valid=contract and facts['copper']['allPhysicalPadNetworksConnected']
  if valid or not report['adopted']:
   report['checks']=checks
  if valid:report.update({'adopted':True,'candidate':str(candidate),'before':before['quality'],'after':facts['quality']})
  return valid
 def repair_filters(seed,label):
  current=seed;facts,contract,_=candidate_facts(current)
  if not contract:return False
  anchors={(r['return']['ref'],str(r['return']['pad'])) for r in request.get('process',{}).get('relations',[])}
  poses_file=dest/(label+'-poses.json');run('filter-poses',current,poses_file);poses=diverse_filter_poses(read(poses_file)['poses'])
  for index in range(16):
   if not poses:break
   pose=poses.pop(0);posefile=dest/'pose.json';write(posefile,pose);result_dir=dest/(label+'-'+str(index))
   run('filter',current,result_dir,posefile);result=read(result_dir/'repair-result.json')
   report['attempts'].append({'filter':pose,'source':str(current),'drc':result['native']['counts'],'passed':result['passed'],'quality':result['quality']})
   if result['passed'] and acceptable(result_dir):return True
   counts=result['native']['counts']
   if not counts['violations'] and not counts['schematic_parity']:
    updated,valid,checks=candidate_facts(result_dir)
    if valid and anchored_copper_progress(facts['copper'],updated['copper'],anchors):
     report.setdefault('filterProgress',[]).append({'ref':pose['ref'],'source':str(current),'candidate':str(result_dir),'checks':checks,'adoptedAsFinal':False})
     current=result_dir;facts=updated;run('filter-poses',current,poses_file);poses=diverse_filter_poses(read(poses_file)['poses'])
   write(dest/'result.json',report)
  return False
 try:
  run('facts',source,dest/'before.json');before=read(dest/'before.json')
  working_source=source;working_facts=before;report['partialProgress']=[]
  if before['copper']['allPhysicalPadNetworksConnected']:
   cleaned=dest/'connected-candidate';run('simplify',source,cleaned);cleaned_result=read(cleaned/'simplification-result.json')
   if cleaned_result['passed'] and acceptable(cleaned):
    report['simplification']=cleaned_result;report['seconds']=round(time.monotonic()-started,3);write(dest/'result.json',report);return report
  # A plane-island fault need not involve a failed jumper. Repair reviewed
  # filters directly, and carry owner-connected progress between candidates.
  repair_filters(source,'initial-filter')
  # Keep a strictly better partial seed so separate bridge faults can be
  # repaired cumulatively. It remains unpublished until the entire board passes.
  for bridge_index,ref in enumerate([] if report['adopted'] else sorted(request.get('process',{}).get('jumpers',[]))):
   work=dest/('bridge-'+str(bridge_index));run('bridges',working_source,work,ref);bridges=read(work/'result.json')
   for row in bridges.get('candidates',[]):
    counts=row.get('drc',{})
    if not row.get('routed') or counts.get('violations',1) or counts.get('schematic_parity',1):continue
    candidate=Path(row['file']).parent
    if row.get('passed') and acceptable(candidate):break
    repair_filters(candidate,'bridge-'+str(bridge_index)+'-filter-'+str(row['rank']))
    if report['adopted']:break
    facts,contract,checks=candidate_facts(candidate)
    if contract and copper_partition_progress(working_facts['copper'],facts['copper']):
     report['partialProgress'].append({'bridge':ref,'source':str(working_source),'candidate':str(candidate),'checks':checks,'drc':counts,'adoptedAsFinal':False})
     working_source=candidate;working_facts=facts
     write(dest/'result.json',report)
     break
   if report['adopted']:report['lastBridge']=ref;break
  if report['adopted']:
   candidate=Path(report['candidate']);optimized=dest/'simplified'
   if report.get('lastBridge'):
    try:
     options=dest/'tree-options.json';write(options,{'ref':report['lastBridge'],'originalTrackIds':before['trackIds']});tree=dest/'shorter-tree'
     run('tree',candidate,tree,options);tree_result=read(tree/'tree-result.json');report['treeOptimization']=tree_result
     if tree_result['passed'] and acceptable(tree):candidate=tree
    except Exception as error:report['treeOptimization']={'adopted':False,'reason':str(error)}
   try:
    run('simplify',candidate,optimized);simplified=read(optimized/'simplification-result.json');report['simplification']=simplified
    if simplified['passed']:acceptable(optimized)
   except Exception as error:report['simplification']={'adopted':False,'reason':str(error)}
  else:report['reason']='no complete candidate passed within the bounded search'
 except Exception as error:report['reason']=str(error)
 report['seconds']=round(time.monotonic()-started,3);write(dest/'result.json',report);return report

if __name__=='__main__':repair(read(sys.argv[1]),sys.argv[2],sys.argv[3])
