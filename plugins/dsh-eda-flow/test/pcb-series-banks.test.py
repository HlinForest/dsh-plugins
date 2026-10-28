import sys, unittest, copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_series_banks import series_channels,pad_row_banks,propose_bank


class SeriesBanksTest(unittest.TestCase):
    def circuit(self):
        parts=[{'ref':'driver','pins':[{'number':str(i),'type':'output'} for i in range(4)]},
               {'ref':'load','pins':[{'number':str(i),'type':'passive'} for i in range(4)]}]
        nets={}
        for i in range(4):
            ref='limit'+str(i);parts.append({'ref':ref,'electricalRole':'current-limit'})
            nets.update({('driver',str(i)):'up'+str(i),(ref,'1'):'up'+str(i),
                         (ref,'2'):'down'+str(i),('load',str(i)):'down'+str(i)})
        return parts,nets
    def test_only_unambiguous_reviewed_branches(self):
        parts,nets=self.circuit();self.assertEqual(len(series_channels(parts,nets)),4)
        nets[('extra','1')]='up1';parts[-1]['electricalRole']='pull-up'
        self.assertEqual([c['ref'] for c in series_channels(parts,nets)],['limit0','limit2'])
    def test_bidirectional_or_unknown_driver_is_not_inferred(self):
        parts,nets=self.circuit()
        for pin in parts[0]['pins']:pin['type']='bidirectional'
        self.assertEqual(series_channels(parts,nets),[])
    def test_rows_follow_geometry_under_rotation_and_renaming(self):
        parts,nets=self.circuit();channels=series_channels(parts,nets)
        points={('driver',str(i)):((-4 if i<2 else 4),i%2*2-1) for i in range(4)}
        points.update({('driver','extraA'):(-4,3),('driver','extraB'):(4,3)})
        banks=pad_row_banks(channels,points,{'driver':(0,0)})
        self.assertEqual([len(b['members']) for b in banks],[2,2])
        self.assertEqual({b['normalAxis'] for b in banks},{0})
        rotated={k:(-v[1]+18,v[0]+9) for k,v in points.items()}
        new=pad_row_banks(channels,rotated,{'driver':(18,9)})
        self.assertEqual({b['normalAxis'] for b in new},{1})
        self.assertEqual({tuple(m['ref'] for m in b['members']) for b in banks},
                         {tuple(reversed([m['ref'] for m in b['members']])) for b in new})
    def test_bank_proposal_is_atomic_and_uses_actual_envelopes(self):
        parts,nets=self.circuit();channels=series_channels(parts,nets)[:2]
        points={('driver','0'):(-4,-1),('driver','1'):(-4,1)}
        bank=pad_row_banks(channels,points,{'driver':(0,0)})[0]
        geometry={m['ref']:[{'rotation':0,'box':[-2,-1,2,1],'pads':{'1':(1,0),'2':(-1,0)}}] for m in bank['members']}
        anchors={(m['ref'],'1'):[m['driverAtMm']] for m in bank['members']}
        self.assertIsNone(propose_bank(bank,geometry,[-4,-5,4,5],.5,lambda p,previous:p['ref']!='limit1',anchors))
        result=propose_bank(bank,geometry,[-4,-5,4,5],.5,lambda p,previous:True,anchors)
        self.assertEqual(len(result['poses']),2)
        self.assertAlmostEqual(result['poses'][1]['yMm']-result['poses'][0]['yMm'],2.5)
        self.assertTrue(all(p['xMm']+2<=-4.5 for p in result['poses']))
    def test_unknown_or_multiple_physical_anchor_does_not_form_row(self):
        parts,nets=self.circuit();channels=series_channels(parts,nets)
        self.assertEqual(pad_row_banks(channels,{('driver','0'):(-4,0)},{'driver':(0,0)}),[])
    def test_long_package_end_pins_follow_pad_row_not_center_vector(self):
        parts,nets=self.circuit();channels=series_channels(parts,nets)
        points={('driver',str(i)):(-9+i*2,3) for i in range(4)}
        points.update({('driver','other'+str(i)):(-9+i*2,-3) for i in range(4)})
        banks=pad_row_banks(channels,points,{'driver':(0,0)})
        self.assertEqual(len(banks),1)
        self.assertEqual(banks[0]['normalAxis'],1)
        self.assertEqual(len(banks[0]['members']),4)


if __name__=='__main__':unittest.main()
