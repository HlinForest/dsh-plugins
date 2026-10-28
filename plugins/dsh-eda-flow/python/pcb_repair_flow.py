"""Transactional, bounded post-route repair; each native board gets its own process.

 This avoids lifetime hazards in pcbnew's aggregate SWIG proxies. Failed poses
 stay in the evidence directory and never replace the selected design.
"""
import sys,subprocess,time,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from record_io import read_json as read,write_json as write

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
 def acceptable(candidate):
  facts_file=candidate/'board-facts.json';run('facts',candidate,facts_file);facts=read(facts_file)
  protected=set(plan.get('placements',{}))|{ref for ref,v in before['poses'].items() if v['locked']}
  for relation in request.get('process',{}).get('relations',[]):
   protected.add(relation['ref']);protected.update(relation[k]['ref'] for k in ('anchor','return') if k in relation)
  preserved=facts['identity']==before['identity'] and facts['lockedCopper']==before['lockedCopper'] and all(facts['poses'].get(ref)==before['poses'].get(ref) for ref in protected)
  sides=all(facts['poses'][ref]['side']==pose['side'] for ref,pose in before['poses'].items())
  valid=preserved and sides and set(facts['layers'])<=set(plan['activeLayers']) and (plan.get('allowVias',True) or not facts['vias']) and facts['copper']['allPhysicalPadNetworksConnected']
  if valid or not report['adopted']:
   report['checks']={'identityAndProtectedGeometryPreserved':preserved,'assemblySidesPreserved':sides,'physicalCopperConnected':facts['copper']['allPhysicalPadNetworksConnected']}
  if valid:report.update({'adopted':True,'candidate':str(candidate),'before':before['quality'],'after':facts['quality']})
  return valid
 try:
  run('facts',source,dest/'before.json');before=read(dest/'before.json')
  if before['copper']['allPhysicalPadNetworksConnected']:
   cleaned=dest/'connected-candidate';run('simplify',source,cleaned);cleaned_result=read(cleaned/'simplification-result.json')
   if cleaned_result['passed'] and acceptable(cleaned):
    report['simplification']=cleaned_result;report['seconds']=round(time.monotonic()-started,3);write(dest/'result.json',report);return report
  # Existing declared bridges are tried separately. No components, nets or
  # mechanical datums are invented to make an unroutable board appear valid.
  for bridge_index,ref in enumerate(sorted(request.get('process',{}).get('jumpers',[]))):
   work=dest/('bridge-'+str(bridge_index));run('bridges',source,work,ref);bridges=read(work/'result.json')
   for row in bridges.get('candidates',[]):
    counts=row.get('drc',{})
    if not row.get('routed') or counts.get('violations',1) or counts.get('schematic_parity',1):continue
    candidate=Path(row['file']).parent
    if row.get('passed') and acceptable(candidate):break
    poses_file=candidate/'filter-poses.json';run('filter-poses',candidate,poses_file);poses=read(poses_file)
    for index,pose in enumerate(poses['poses'][:16]):
     posefile=dest/'pose.json';write(posefile,pose);result_dir=candidate/('filter-'+str(index))
     run('filter',candidate,result_dir,posefile);result=read(result_dir/'repair-result.json')
     report['attempts'].append({'bridge':ref,'bridgeRank':row['rank'],'filter':pose,'drc':result['native']['counts'],'passed':result['passed'],'quality':result['quality']})
     if result['passed'] and acceptable(result_dir):break
    if report['adopted']:break
   if report['adopted']:break
  if report['adopted']:
   candidate=Path(report['candidate']);optimized=dest/'simplified'
   try:
    options=dest/'tree-options.json';write(options,{'ref':ref,'originalTrackIds':before['trackIds']});tree=dest/'shorter-tree'
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
