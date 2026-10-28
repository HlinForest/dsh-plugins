import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_refinement import FeedbackSearch,prefer_candidate,copper_partition_progress,anchored_copper_progress,diverse_filter_poses
class Tests(unittest.TestCase):
 def test_signal_focus_before_plane_and_regression_does_not_freeze_search(self):
  s=FeedbackSearch(.5,True,['SUPPLY','RETURN']);a=s.next();self.assertEqual(a['nets'],[])
  s.feedback(a,['SUPPLY','RETURN','CONTROL']);a=s.next();self.assertEqual(a['nets'],['CONTROL'])
  s.feedback(a,['CLOCK']);a=s.next();self.assertEqual(a['nets'],['CLOCK','CONTROL'])
  # Even if this cumulative branch has more failures, the next is distinct.
  s.feedback(a,['OTHER']);b=s.next();self.assertNotEqual(a,b)
 def test_native_copper_alias_uses_actual_hierarchy_not_leaf_names(self):
  s=FeedbackSearch(.5,True,['RETURN']);a=s.next()
  s.bind_native_copper([{'name':'/sheetA/RETURN','logicalName':'RETURN'}])
  s.feedback(a,['/sheetA/RETURN','/sheetB/RETURN','/CONTROL'])
  self.assertEqual(s.next()['nets'],['/CONTROL','/sheetB/RETURN'])
 def test_unique_and_bounded_including_spacing_alternatives(self):
  s=FeedbackSearch(.5,True,['P'],limit=9);items=[]
  while (a:=s.next()) is not None:
   items.append((a['componentGapMm'],tuple(a['nets'])));s.feedback(a,['N'+str(len(items)),'P'])
  self.assertEqual(len(items),len(set(items)));self.assertLessEqual(len(items),9)
  self.assertIn((1.5,()),items);self.assertIn((3.0,()),items)
 def test_duplicate_failures_still_explore_different_focus(self):
  s=FeedbackSearch(.5,True,[]);a=s.next();s.feedback(a,['X','Y']);a=s.next();s.feedback(a,['X','Y']);b=s.next()
  self.assertEqual(a['nets'],['X','Y']);self.assertEqual(b['nets'],['X'])
 def test_quality_never_accepts_shorter_but_disconnected_or_more_bent_route(self):
  def result(length=500,short=2,bends=90,open=0):
   return {'drc':{'passed':open==0,'errors':open,'unconnected':open,'parity':0,'warnings':0},'routingQuality':{'trackLengthMm':length,'shortSegmentsUnder05mm':short,'degree2Bends':bends}}
  baseline=result()
  self.assertFalse(prefer_candidate(result(400,0,70,1),baseline))
  self.assertFalse(prefer_candidate(result(490,1,91),baseline))
  self.assertFalse(prefer_candidate(result(490,3,80),baseline))
  self.assertFalse(prefer_candidate(result(),baseline))
  self.assertTrue(prefer_candidate(result(490,1,80),baseline))
  self.assertTrue(prefer_candidate(result(),result(400,0,70,1)))
 def test_partial_copper_progress_preserves_every_connected_pair(self):
  def copper(groups):
   return {'networks':[{'net':net,'ambiguousPads':[],'connectedPadGroups':[{'members':[{'uuid':pin} for pin in group]} for group in partition]} for net,partition in groups.items()]}
  before=copper({'clock':[['a','b'],['c']],'strobe':[['d'],['e']]})
  intermediate=copper({'clock':[['a','b','c']],'strobe':[['d'],['e']]})
  complete=copper({'clock':[['a','b','c']],'strobe':[['d','e']]})
  self.assertTrue(copper_partition_progress(before,intermediate))
  self.assertTrue(copper_partition_progress(intermediate,complete))
  self.assertFalse(copper_partition_progress(before,before))
  self.assertFalse(copper_partition_progress(intermediate,before))
  # Fewer groups overall cannot justify splitting a previously connected pair.
  regressed=copper({'clock':[['a','c'],['b']],'strobe':[['d','e']]})
  self.assertFalse(copper_partition_progress(before,regressed))
  missing=copper({'clock':[['a','b']],'strobe':[['d','e']]})
  self.assertFalse(copper_partition_progress(before,missing))
  complete['networks'][0]['ambiguousPads']=[{'uuid':'a'}]
  self.assertFalse(copper_partition_progress(before,complete))
 def test_return_progress_tracks_reachability_to_owner_without_losing_main_tree(self):
  def copper(groups):
   return {'networks':[{'net':net,'ambiguousPads':[],'connectedPadGroups':[{'members':[{'uuid':pin,'ref':pin,'pin':'1'} for pin in group]} for group in partition]} for net,partition in groups.items()]}
  before=copper({'return':[['owner','existing'],['a','b'],['c']],'signal':[['x','y']]})
  moved=copper({'return':[['owner','existing','a'],['b'],['c']],'signal':[['x','y']]})
  anchors={('owner','1')}
  self.assertTrue(anchored_copper_progress(before,moved,anchors))
  self.assertFalse(copper_partition_progress(before,moved))
  lost=copper({'return':[['owner','a','b'],['existing'],['c']],'signal':[['x','y']]})
  self.assertFalse(anchored_copper_progress(before,lost,anchors))
  signal_split=copper({'return':[['owner','existing','a','b','c']],'signal':[['x'],['y']]})
  self.assertFalse(anchored_copper_progress(before,signal_split,anchors))
  ambiguous_owner={('owner','1'),('a','1')}
  self.assertFalse(anchored_copper_progress(before,moved,ambiguous_owner))
  self.assertFalse(anchored_copper_progress(before,before,anchors))
 def test_bounded_pose_search_covers_components_and_directions_before_neighbours(self):
  poses=[{'ref':'A','offsetMm':[0,-v],'joinsOwnerReturnEstimate':True} for v in range(1,20)]
  poses += [{'ref':'A','offsetMm':[0,7],'joinsOwnerReturnEstimate':True},
            {'ref':'B','offsetMm':[7,7],'joinsOwnerReturnEstimate':True},
            {'ref':'B','offsetMm':[0,0],'joinsOwnerReturnEstimate':False}]
  ranked=diverse_filter_poses(poses)
  self.assertEqual([(p['ref'],p['offsetMm']) for p in ranked[:3]],[('A',[0,-1]),('A',[0,7]),('B',[7,7])])
  self.assertEqual(len(ranked),len(poses))
  self.assertEqual({id(p) for p in ranked},{id(p) for p in poses})
  self.assertFalse(ranked[-1]['joinsOwnerReturnEstimate'])
if __name__=='__main__':unittest.main()
