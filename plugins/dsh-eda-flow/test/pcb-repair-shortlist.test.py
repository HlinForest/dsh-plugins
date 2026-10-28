import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_refinement import repair_shortlist,repair_time_budget
def candidate(name,length,shorts,opens=1,violations=0,passed=False):
 return ({'output':name},{'drc':{'passed':passed,'unconnected':opens,'errors':opens+violations,'warnings':0,'parity':0,'violations':violations},'routingQuality':{'trackLengthMm':length,'shortSegmentsUnder05mm':shorts,'degree2Bends':70}})
class Tests(unittest.TestCase):
 def test_fewer_short_fragments_cannot_remove_other_repair_seeds(self):
  rows=[candidate('least-fragmented-but-trapped',440,1),candidate('repairable',399,2),candidate('different-return-island',465,2),candidate('longer',494,6)]
  self.assertEqual([r[0]['output'] for r in repair_shortlist(rows)],['least-fragmented-but-trapped','repairable','different-return-island'])
 def test_passed_or_geometrically_invalid_candidates_are_not_repaired(self):
  rows=[candidate('passed',400,0,0,passed=True),candidate('collision',390,0,violations=1),candidate('open',420,3)]
  self.assertEqual([r[0]['output'] for r in repair_shortlist(rows)],['open'])
 def test_fewer_opens_precede_fragment_quality_and_search_is_bounded(self):
  rows=[candidate('many-opens',200,0,3)]+[candidate(str(i),500+i,i) for i in range(6)]
  self.assertEqual([r[0]['output'] for r in repair_shortlist(rows,2)],['0','1'])
 def test_fast_failed_seed_donates_time_to_next_geometry(self):
  self.assertEqual(repair_time_budget(360-11,2),300)
  self.assertGreater(repair_time_budget(360-11,2),173)
 def test_later_seeds_keep_minimum_budget_without_exceeding_total(self):
  self.assertEqual(repair_time_budget(50,3),20)
  self.assertEqual(repair_time_budget(29,2),0)
  self.assertEqual(repair_time_budget(27,1),27)
 def test_per_worker_budget_stays_bounded(self):
  self.assertEqual(repair_time_budget(1000,1),300)
  self.assertEqual(repair_time_budget(-1,1),0)
if __name__=='__main__':unittest.main()
