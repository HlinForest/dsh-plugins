import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'mcp'))
from precise_mcp import Engine
from fixed_components import check_frozen
from functional_layout import physical_graph


class FunctionalLayoutTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        lib=json.loads((ROOT/'libraries/display-board-fixed.json').read_text(encoding='utf8'))
        lib['objects']=[c for c in lib['objects'] if c['ref'] in ['R1','R2','R3','R4','R5','R6']]
        lib.pop('functionalPolicy',None);self.lib=lib
        data=json.dumps(lib,ensure_ascii=False).encode()
        (self.root/'.fixed-components.json').write_bytes(data)
        (self.root/'.fixed-components.sha256').write_text(hashlib.sha256(data).hexdigest())
        self.e=Engine(self.root,'D:/Kicad/bin/kicad-cli.exe')
        self.e.call('precise_create',{'request_key':'new','name':'test','paper':'A3'})
        self.plan={'request_key':'compose','groups':[{'id':'a','title':'Input network','columns':[['R1'],['R2'],['R3']]},{'id':'b','title':'Output network','columns':[['R4'],['R5'],['R6']]}],
                   'nets':[{'name':'N'+str(i),'nodes':['R'+str(i)+'.2','R'+str(i%6+1)+'.1']} for i in range(1,7)],'nc':[],'rotations':{'R3':90}}

    def export(self,key='export'):
        return self.e.call('precise_check_export',{'request_key':key,'formats':['pdf','netlist','bom','erc']})

    def test_real_kicad_topology_and_original_geometry_survive_autorouting(self):
        self.e.call('precise_compose',self.plan)
        self.assertEqual(check_frozen(self.e.load(),self.lib,True),[])
        result=self.export()
        for key in ['fixedConsistency','layoutConsistency','readabilityConsistency']:
            self.assertEqual(result[key]['status'],'passed',result[key])
        self.assertEqual(result['erc']['by_severity']['error'],0)
        # These frozen test symbols have on-grid local pins. Layout must not create
        # off-grid warnings merely from proportional text widths in its columns.
        self.assertEqual(result['erc']['by_severity']['warning'],0)
        self.assertEqual(result['readabilityConsistency']['localWireChecksPassed'],4)
        physical,_=physical_graph(self.e.load())
        self.assertEqual(physical['R1.2'],physical['R2.1'])

    def test_bad_topology_is_rejected_without_changing_cad(self):
        before=(self.root/'test.kicad_sch').read_bytes()
        for kind in ['missing','duplicate','foreign']:
            p=copy.deepcopy(self.plan)
            if kind=='missing':p['nets'].pop()
            elif kind=='duplicate':p['nets'][0]['nodes'].append('R3.1')
            else:p['nets'][0]['nodes'][0]='MadeUp.1'
            with self.assertRaises(ValueError):self.e.call('precise_compose',p)
            self.assertEqual((self.root/'test.kicad_sch').read_bytes(),before)

    def test_parallel_bank_aligns_terminals_and_preserves_native_connectivity(self):
        plan=copy.deepcopy(self.plan)
        plan['rotations']={}
        plan['nets']=[{'name':'RAIL'+str(pin),'nodes':['R'+str(i)+'.'+str(pin) for i in range(1,7)]} for pin in (1,2)]
        # Exercise the rail candidate directly; search may prefer a different
        # valid orientation for this artificial all-resistor fixture.
        for g in plan['groups']:
            g['_motif']='parallel_rails'
        plan['rotations']={c['ref']:(270-next(p for p in c['pins'] if p['number']=='1')['angle'])%360 for c in self.lib['objects']}
        from functional_layout import compose_candidate
        self.e.save(compose_candidate(self.e.load(),self.lib,plan))
        result=self.export()
        self.assertEqual(result['readabilityConsistency']['status'],'passed',result)
        self.assertEqual(result['layoutConsistency']['status'],'passed',result)
        self.assertEqual(check_frozen(self.e.load(),self.lib,True),[])
        read=self.e.call('precise_read',{})
        self.assertTrue(all(not any(k.startswith('_') for k in g) for g in read['composition_plan']['groups']))
        from functional_layout import world
        state=self.e.load()
        for refs in [['R1','R2','R3'],['R4','R5','R6']]:
            terminal_rows=[]
            for ref in refs:
                c=next(c for c in state['items'].values() if c.get('reference')==ref)
                terminal_rows.append(tuple(sorted(world(c,p['at'])[1] for p in state['symbols'][c['symbol']]['pins'])))
            self.assertEqual(len(set(terminal_rows)),1,terminal_rows)

    def test_adjacent_capacitor_leads_do_not_touch_after_grid_snapping(self):
        lib=json.loads((ROOT/'libraries/display-board-fixed.json').read_text(encoding='utf8'))
        lib['objects']=[c for c in lib['objects'] if c['ref'] in ['R1','R2','R4','C5','C6','C7']]
        lib.pop('functionalPolicy',None)
        data=json.dumps(lib,ensure_ascii=False).encode()
        (self.root/'.fixed-components.json').write_bytes(data)
        (self.root/'.fixed-components.sha256').write_text(hashlib.sha256(data).hexdigest())
        plan={'request_key':'capacitors','groups':[{'id':'filters','title':'Input filters','columns':[['R1','R2'],['C5','C6','C7']]},
              {'id':'external','title':'External series resistor','columns':[['R4']]}],
              'nets':[{'name':'INPUT','nodes':['R1.1','R2.1','R4.1']},{'name':'GND','nodes':['C5.2','C6.2','C7.2']}]+[
                  {'name':'S'+str(i),'nodes':[r+'.2',c+'.1']} for i,(r,c) in enumerate(zip(['R1','R2','R4'],['C5','C6','C7']))], 'nc':[]}
        self.e.call('precise_compose',plan)
        result=self.export()
        self.assertEqual(result['readabilityConsistency']['status'],'passed',result['readabilityConsistency'])
        self.assertEqual(result['layoutConsistency']['status'],'passed',result['layoutConsistency'])
        self.assertEqual(result['erc']['by_severity']['error'],0)
        self.assertTrue(all(w['width']==.18 for w in self.e.load()['items'].values() if w['kind']=='wire'))
        junctions=[i for i in self.e.load()['items'].values() if i['kind']=='junction']
        self.assertTrue(junctions)
        self.assertTrue(all(j['diameter']==.7 for j in junctions))

    def test_labels_cannot_replace_local_wires_even_when_native_netlist_is_identical(self):
        self.e.call('precise_compose',self.plan)
        read=self.e.call('precise_read',{})
        pins={p['reference']+'.'+p['number']:p['native_at'] for p in read['pins']}
        labels=[{'id':'replacement-'+node,'kind':'label','text':n['name'],'at':pins[node]} for n in self.plan['nets'] for node in n['nodes']]
        delete=[i['id'] for i in read['items'] if i['kind'] in ['wire','junction','label']]
        self.e.call('precise_apply',{'request_key':'regress','delete_ids':delete,'items':labels})
        result=self.export()['readabilityConsistency']
        self.assertTrue(result['modelTopologyMatchesNative'])
        self.assertEqual(result['status'],'failed')
        self.assertEqual(result['localWireChecksPassed'],0)
        self.assertEqual(result['visibleConnectivityCoverage'],0)

    def test_source_functional_policy_does_not_generate_the_netlist(self):
        from functional_layout import compose
        state=self.e.load();base=compose(state,self.lib,{k:v for k,v in self.plan.items() if k!='request_key'})
        altered=copy.deepcopy(self.lib);altered['functionalPolicy']={'nets':'arbitrary invalid private data'}
        other=compose(state,altered,{k:v for k,v in self.plan.items() if k!='request_key'})
        self.assertEqual(base,other)


if __name__=='__main__':unittest.main()
