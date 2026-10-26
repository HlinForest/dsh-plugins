import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from generic_layout import _align_group_origin


class ConnectionGridTest(unittest.TestCase):
    def test_fractional_text_bounds_shift_whole_electrical_group(self):
        placed={'children':[{'id':'A','x':5.08,'y':3.81},{'id':'B','x':17.78,'y':3.81}]}
        specs={r:{'_low':[-2.54,-2.54]} for r in ('A','B')}
        pins={'A.1':{'pos':[-3.81,0]},'A.2':{'pos':[3.81,0]},'B.1':{'pos':[-3.81,0]},'B.2':{'pos':[3.81,0]}}
        old=[10,15];new=_align_group_origin(old,placed,specs,pins,6.35)
        for item in placed['children']:
            for key,pin in pins.items():
                if not key.startswith(item['id']+'.'):continue
                for axis in (0,1):
                    value=new[axis]+(6.35 if axis else 0)+item['xy'[axis]]-specs[item['id']]['_low'][axis]+pin['pos'][axis]
                    self.assertAlmostEqual(value/1.27,round(value/1.27))
        for before,after in zip(old,new):self.assertTrue(0<=after-before<1.27)
        # Translation does not alter any within-group pin/route displacement.
        self.assertAlmostEqual(placed['children'][1]['x']-placed['children'][0]['x'],12.7)

    def test_incompatible_pin_phases_are_not_individually_snapped(self):
        placed={'children':[{'id':'A','x':0,'y':0}]};specs={'A':{'_low':[0,0]}}
        pins={'A.1':{'pos':[0,0]},'A.2':{'pos':[0.254,1.27]}}
        new=_align_group_origin([10,15],placed,specs,pins,0)
        self.assertEqual(new[0],10)
        self.assertAlmostEqual(new[1]/1.27,round(new[1]/1.27))
        self.assertEqual(pins['A.2']['pos'],[0.254,1.27])

    def test_aligned_origin_is_unchanged(self):
        self.assertEqual(_align_group_origin([12.7,25.4],{'children':[{'id':'Z','x':0,'y':0}]},{'Z':{'_low':[0,0]}},{'Z.1':{'pos':[0,0]}},0),[12.7,25.4])

if __name__=='__main__':unittest.main()
