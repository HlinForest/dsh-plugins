import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_refinement import FeedbackSearch
class Tests(unittest.TestCase):
 def test_signal_focus_before_plane_and_regression_does_not_freeze_search(self):
  s=FeedbackSearch(.5,True,['SUPPLY','RETURN']);a=s.next();self.assertEqual(a['nets'],[])
  s.feedback(a,['SUPPLY','RETURN','CONTROL']);a=s.next();self.assertEqual(a['nets'],['CONTROL'])
  s.feedback(a,['CLOCK']);a=s.next();self.assertEqual(a['nets'],['CLOCK','CONTROL'])
  # Even if this cumulative branch has more failures, the next is distinct.
  s.feedback(a,['OTHER']);b=s.next();self.assertNotEqual(a,b)
 def test_unique_and_bounded_including_spacing_alternatives(self):
  s=FeedbackSearch(.5,True,['P'],limit=9);items=[]
  while (a:=s.next()) is not None:
   items.append((a['componentGapMm'],tuple(a['nets'])));s.feedback(a,['N'+str(len(items)),'P'])
  self.assertEqual(len(items),len(set(items)));self.assertLessEqual(len(items),9)
  self.assertIn((1.5,()),items);self.assertIn((3.0,()),items)
 def test_duplicate_failures_still_explore_different_focus(self):
  s=FeedbackSearch(.5,True,[]);a=s.next();s.feedback(a,['X','Y']);a=s.next();s.feedback(a,['X','Y']);b=s.next()
  self.assertEqual(a['nets'],['X','Y']);self.assertEqual(b['nets'],['X'])
if __name__=='__main__':unittest.main()
