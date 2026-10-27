import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_refinement import FeedbackSearch,prefer_candidate
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
if __name__=='__main__':unittest.main()
