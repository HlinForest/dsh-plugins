"""A reviewed sizing owner is usable layout intent, not a saved placement."""
import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from functional_groups import decoupling_hints
from topology_layout import _decoupling_positions, _signal_corridors

def circuit():
    def part(ref,library,kind):
        return {'ref':ref,'librarySymbol':library,'pins':[{'number':str(n),'type':kind} for n in (1,2)]}
    return {'components':[part('CTRL','Logic:Controller','power_in'),part('PEER','Logic:Controller','power_in'),
        part('LOCAL','Device:C','passive'),{**part('STORE','Device:C','passive'),'electricalRole':'other','purpose':'Supply reservoir'},
        part('PEER_CAP','Device:C','passive')],
        'nets':[{'name':'VMAIN','nodes':['CTRL.1','PEER.1','LOCAL.1','STORE.1','PEER_CAP.1']},
                {'name':'RETURN','nodes':['CTRL.2','PEER.2','LOCAL.2','STORE.2','PEER_CAP.2']}],
        'functions':[{'layout':[{'kind':'decoupling','anchor':'CTRL.1','return':'CTRL.2','members':['LOCAL']},
                               {'kind':'decoupling','anchor':'PEER.1','return':'PEER.2','members':['PEER_CAP']}]}],
        'operatingPoints':[{'id':'storage','kind':'supply-transient','owner':'CTRL','components':['LOCAL','STORE']}]}

class PowerDomainLayout(unittest.TestCase):
    def test_signal_lanes_follow_filtered_input_bank_and_ignore_power_pins(self):
        components={'H':{'pins':[{'number':'1','type':'input'},{'number':'2','type':'power_in'}, {'number':'3','type':'output'}]}}
        pins={f'H.{n}':{'pos':[-10,y],'direction':[-1,0]} for n,y in ((1,-5),(2,0),(3,5))}
        branches=[{'source':f'H.{n}','chain':[('Z','Z.1','Z.2')]} for n in (1,2,3)]
        specs={'Z':{'width':25,'height':10}}
        plain=_signal_corridors(branches,components,[-14,-20,20,20],specs,pins,5)
        filtered=_signal_corridors(branches,components,[-14,-20,20,20],specs,pins,5,{'side':-1,'left':-60,'right':-25})
        self.assertEqual(len(filtered),2)
        self.assertLess(filtered[0][0],plain[0][0])
        self.assertEqual(filtered[1],plain[1])
        self.assertLess(filtered[0][1],-5);self.assertGreater(filtered[0][3],-5)

    def test_parallel_bank_can_use_space_above_owner_beyond_initial_tangent_samples(self):
        for count in (2,3):
            specs={'H':{'_low':[-14,-23],'width':34,'height':52},
                   'L':{'_low':[-110,-60],'width':90,'height':140},
                   'R':{'_low':[20,-10],'width':90,'height':90},
                   'B':{'_low':[-20,29],'width':40,'height':51}}
            pins={'H.1':{'pos':[-10,-2.54],'port':[-14,-2.54],'direction':[-1,0]},
                  'H.2':{'pos':[10,-7.62],'port':[20,-7.62],'direction':[1,0]}}
            rows=[]
            for i in range(count):
                ref='K'+str(i)
                specs[ref]={'_low':[-13.97,-5.08],'width':24.13,'height':10.16,'_content_low':[-7.58,-2.032],'_content_high':[9.606,2.932]}
                pins[ref+'.1']={'pos':[3.81,0],'port':[10.16,0],'direction':[1,0]}
                pins[ref+'.2']={'pos':[-3.81,0],'port':[-13.97,0],'direction':[-1,0]}
                rows.append((ref,'H.1','H.2',ref+'.1',ref+'.2'))
            positions={ref:[0,0] for ref in ('H','L','R','B')}
            before=copy.deepcopy((rows,specs,pins,positions))
            result=_decoupling_positions(rows,[-14,-23,20,29],positions,specs,pins,5.08,{'H.2'})
            self.assertEqual(len(result),count)
            self.assertEqual(len({at[0] for at in result.values()}),1)
            self.assertTrue(all(at[1]+2.932 < -23 for at in result.values()))
            self.assertTrue(all(at[0]-13.97 > -20 for at in result.values()))
            self.assertEqual((rows,specs,pins,positions),before)

    def test_parallel_cap_bank_keeps_real_fields_clear_without_unused_port_margin(self):
        specs = {'CTRL': {'_low': [-13.97, -22.86], 'width': 34.29, 'height': 52.07}}
        pinmap = {'CTRL.1': {'pos': [-10.16, -2.54], 'port': [-13.97, -2.54], 'direction': [-1, 0]},
                  'CTRL.2': {'pos': [10.16, -7.62], 'port': [20.32, -7.62], 'direction': [1, 0]}}
        rows = []
        for ref in ('LOCAL', 'STORE'):
            specs[ref] = {'_low': [-13.97, -5.08], 'width': 24.13, 'height': 10.16,
                          '_content_low': [-7.58, -2.032], '_content_high': [9.606, 2.932]}
            pinmap[ref+'.1'] = {'pos': [3.81, 0], 'port': [10.16, 0], 'direction': [1, 0]}
            pinmap[ref+'.2'] = {'pos': [-3.81, 0], 'port': [-13.97, 0], 'direction': [-1, 0]}
            rows.append((ref, 'CTRL.1', 'CTRL.2', ref+'.1', ref+'.2'))
        before = copy.deepcopy(specs)
        result = _decoupling_positions(rows, [-13.97, -22.86, 20.32, 29.21],
                                      {'CTRL': [0, 0]}, specs, pinmap, 5.08, {'CTRL.2'})
        self.assertEqual(set(result), {'LOCAL', 'STORE'})
        ys = sorted(origin[1] for origin in result.values())
        # The two real field envelopes clear by a routing grid, while the
        # common rail fits between the adjacent signal pin rows.
        self.assertGreaterEqual(ys[1]-2.032-(ys[0]+2.932), 2.54)
        self.assertLess(ys[1]-ys[0], 10.16)
        self.assertEqual(specs, before)

    def test_storage_uses_reviewed_owner_and_actual_domains_without_mutating_design(self):
        d=circuit();before=copy.deepcopy(d)
        hints=decoupling_hints(d)
        self.assertIn('STORE',hints['CTRL'])
        self.assertEqual(hints['CTRL']['STORE']['anchor'],'CTRL.1')
        self.assertEqual(hints['CTRL']['STORE']['return'],'CTRL.2')
        self.assertEqual(d,before)

    def test_common_supply_alone_does_not_assign_reservoir(self):
        d=circuit();d['operatingPoints']=[]
        self.assertNotIn('STORE',decoupling_hints(d)['CTRL'])

    def test_ambiguous_owners_leave_the_shared_reservoir_unclaimed(self):
        d=circuit();d['operatingPoints'].append({'id':'peer','kind':'supply-transient','owner':'PEER','components':['PEER_CAP','STORE']})
        for rows in (d['operatingPoints'],list(reversed(d['operatingPoints']))):
            d['operatingPoints']=rows
            self.assertFalse(any('STORE' in members for members in decoupling_hints(d).values()))

    def test_wrong_rail_or_non_capacitor_cannot_be_borrowed_as_storage(self):
        d=circuit();d['nets'][0]['nodes'].remove('STORE.1');d['nets'].append({'name':'OTHER','nodes':['STORE.1']})
        self.assertNotIn('STORE',decoupling_hints(d)['CTRL'])
        d=circuit();d['components'][3]['librarySymbol']='Device:R'
        d['components'][3]['componentKind']='capacitor'
        self.assertNotIn('STORE',decoupling_hints(d)['CTRL'])

if __name__=='__main__':unittest.main()
