from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from functional_layout import Router,on,intersects

class WireBranches(unittest.TestCase):
    def router(self,obstacles=()):
        return Router([-2.54,-2.54,25.4,25.4],list(obstacles),[('A',(0,0),(20.32,0)),('A',(10.16,12.7),(10.16,15.24))])
    def test_branch_joins_existing_wire_without_parallel_step(self):
        r=self.router();path=r.connect('A',(0,0),(10.16,12.7))
        self.assertEqual(path,[(10.16,0),(10.16,12.7)])
    def test_disconnected_same_named_lead_is_not_a_shortcut(self):
        r=self.router();path=r.connect('A',(0,0),(10.16,12.7))
        self.assertEqual(path[0][1],0)
        self.assertGreater(len(path),1)
    def test_foreign_net_crossing_cannot_become_branch_junction(self):
        r=self.router();r.occupy('B',[(10.16,-2.54),(10.16,2.54)])
        path=r.connect('A',(0,0),(10.16,12.7))
        self.assertNotEqual(path[0],(10.16,0))
        self.assertTrue(all(not on(p,(10.16,-2.54),(10.16,2.54)) for p in path))
    def test_obstacle_keeps_necessary_bends(self):
        box=[7.62,2.54,12.7,10.16];r=self.router([box]);path=r.connect('A',(0,0),(10.16,12.7))
        self.assertGreater(len(path),2)
        self.assertTrue(all(not intersects(a,b,box) for a,b in zip(path,path[1:])))
    def test_parallel_rail_extends_straight_instead_of_making_small_step(self):
        r=Router([-2.54,-2.54,25.4,25.4],[],[
            ('A',(0,0),(0,12.7)),('A',(0,12.7),(10.16,12.7)),
            ('A',(1.27,20.32),(10.16,20.32))])
        path=r.connect('A',(0,0),(1.27,20.32),join_target_tree=True)
        self.assertEqual(len(path),2)
        self.assertEqual(path[0][0],path[1][0])
        self.assertEqual([p[1] for p in path],[12.7,20.32])
        self.assertTrue(1.27<=path[0][0]<=10.16)
    def test_shared_rail_alignment_can_outweigh_a_shorter_dogleg(self):
        r=Router([-2.54,-2.54,27.94,25.4],[],[
            ('A',(0,0),(0,12.7)),('A',(0,12.7),(25.4,12.7)),
            ('A',(12.7,20.32),(25.4,20.32))])
        path=r.connect('A',(0,0),(12.7,20.32),join_target_tree=True)
        self.assertEqual(len(path),2)
        self.assertEqual(path[0][0],path[1][0])
        self.assertTrue(12.7<=path[0][0]<=25.4)
        self.assertEqual([p[1] for p in path],[12.7,20.32])
    def test_target_tree_cannot_cross_foreign_net_at_attachment(self):
        r=self.router();r.occupy('B',[(7.62,13.97),(12.7,13.97)])
        path=r.connect('A',(0,0),(10.16,12.7),join_target_tree=True)
        self.assertNotEqual(path[-1],(10.16,13.97))
    def test_disconnected_target_alias_is_not_a_branch_target(self):
        r=self.router();r.occupy('A',[(0,2.54),(20.32,2.54)])
        path=r.connect('A',(0,0),(10.16,12.7),join_target_tree=True)
        self.assertTrue(on(path[-1],(10.16,12.7),(10.16,15.24)))
    def test_planned_trunk_target_remains_authoritative_by_default(self):
        r=Router([-2.54,-2.54,27.94,25.4],[],[
            ('A',(0,0),(0,12.7)),('A',(0,12.7),(25.4,12.7)),
            ('A',(12.7,20.32),(25.4,20.32))])
        self.assertEqual(r.connect('A',(0,0),(12.7,20.32)),[(0,12.7),(0,20.32),(12.7,20.32)])

if __name__=='__main__':unittest.main()
