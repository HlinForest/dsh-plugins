"""A shared net name must not hide labels on disconnected filter returns."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from generic_layout import route_islands, prune_unanchored_wire_tails

class ReturnIslands(unittest.TestCase):
    def test_separate_return_stubs_remain_distinct(self):
        islands=route_islands([((0,0),(0,5)),((10,0),(10,5)),((20,0),(20,5))])
        self.assertEqual(len({islands[(x,0)] for x in (0,10,20)}),3)

    def test_shared_rail_deduplicates_at_taps(self):
        islands=route_islands([((0,0),(0,5)),((10,0),(10,5)),((20,0),(20,5)),((0,5),(20,5))])
        self.assertEqual(len({islands[(x,0)] for x in (0,10,20)}),1)

    def test_interior_crossing_is_not_a_junction(self):
        islands=route_islands([((-5,0),(5,0)),((0,-5),(0,5))])
        self.assertNotEqual(islands[(-5,0)],islands[(0,-5)])

    def test_unused_tail_stops_at_interior_label(self):
        self.assertEqual(prune_unanchored_wire_tails([((0,0),(10,0))],[(0,0),(8,0)]),{((0,0),(8,0))})

    def test_branch_tail_pruning_preserves_anchored_path(self):
        routes=[((0,0),(10,0)),((5,0),(5,4)),((5,4),(7,4))]
        self.assertEqual(prune_unanchored_wire_tails(routes,[(0,0),(10,0)]),{((0,0),(5,0)),((5,0),(10,0))})

    def test_crossing_anchored_paths_remain_disconnected(self):
        routes=[((-5,0),(5,0)),((0,-5),(0,5))]
        self.assertEqual(prune_unanchored_wire_tails(routes,[p for edge in routes for p in edge]),set(routes))

if __name__=='__main__':unittest.main()
