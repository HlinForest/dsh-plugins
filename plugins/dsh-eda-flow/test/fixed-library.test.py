import copy,hashlib,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'mcp'))
from precise_mcp import Engine
from fixed_components import symbol, check_frozen

LIB=json.loads((ROOT/'libraries/display-board-fixed.json').read_text(encoding='utf8'))

class FixedLibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        payload=json.dumps(LIB,ensure_ascii=False).encode()
        (self.root/'.fixed-components.json').write_bytes(payload)
        (self.root/'.fixed-components.sha256').write_text(hashlib.sha256(payload).hexdigest())
        self.e=Engine(self.root,'D:/Kicad/bin/kicad-cli.exe')
        self.e.call('precise_create',{'request_key':'create','name':'fixed','paper':'A3'})

    def test_original_display_geometry_survives_independent_placement(self):
        self.e.call('precise_place_fixed',{'request_key':'place','components':[{'reference':'*','at':[200,100]}]})
        st=self.e.load();c=next(i for i in st['items'].values() if i['kind']=='component')
        self.assertEqual(st['symbols'][c['symbol']],symbol(next(c for c in LIB['objects'] if c['ref']=='*')))
        self.assertEqual(len(st['symbols'][c['symbol']]['graphics']),8)
        self.assertEqual(len(st['symbols'][c['symbol']]['pins']),10)
        self.assertFalse(check_frozen(st,LIB))
        self.assertTrue(check_frozen(st,LIB,complete=True))
        rb=self.e.call('precise_read',{})
        self.assertEqual(next(p for p in rb['pins'] if p['number']=='5')['native_at'],[223.368,102.54])

    def test_previous_three_digit_redraw_and_shortened_pins_are_rejected_atomically(self):
        self.e.call('precise_place_fixed',{'request_key':'place','components':[{'reference':'*','at':[200,100]}]})
        st=self.e.load();s=next(iter(st['symbols'].values()));before=(self.root/'fixed.kicad_sch').read_bytes()
        for changed in [dict(s,graphics=[{'kind':'rectangle','start':[0,0],'end':[90,130]}]),dict(s,pins=[dict(p,length=2.54) for p in s['pins']])]:
            with self.assertRaisesRegex(ValueError,'fixed|固定'):
                self.e.call('precise_apply',{'request_key':'bad','symbols':[changed]})
            self.assertEqual((self.root/'fixed.kicad_sch').read_bytes(),before)

    def test_material_override_rejected_but_field_move_allowed(self):
        self.e.call('precise_place_fixed',{'request_key':'place','components':[{'reference':'C2','at':[80,80],'fields':[{'name':'Reference','at':[90,70]}]}]})
        st=self.e.load();c=next(iter(st['items'].values()));c['value']='10uF'
        with self.assertRaisesRegex(ValueError,'fixed|固定'):
            self.e.call('precise_apply',{'request_key':'bad-value','items':[c]})
        self.assertTrue(self.e.call('precise_read',{})['file_matches_model'])

    def test_library_tampering_rejected(self):
        (self.root/'.fixed-components.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'fingerprint|指纹'):
            self.e.call('precise_fixed_library',{})

    def test_actual_kicad_export_checks_incomplete_design(self):
        self.e.call('precise_place_fixed',{'request_key':'place','components':[{'reference':'*','at':[150,100]}]})
        result=self.e.call('precise_check_export',{'request_key':'export','formats':['pdf','netlist','bom','erc']})
        self.assertEqual(result['fixedConsistency']['status'],'failed')
        self.assertIn('Missing fixed component U1',result['fixedConsistency']['errors'])
        self.assertTrue(any('*.5' in n['nodes'] for n in result['fixedConsistency']['actualGeneratedNets']))
        self.assertEqual(result['layoutConsistency']['status'],'passed')
        self.assertEqual(result['layoutConsistency']['fieldCount'],2)

    def test_label_on_original_pin_number_is_rejected_then_can_move(self):
        self.e.call('precise_place_fixed',{'request_key':'place','components':[{'reference':'U1','at':[80,80]}]})
        p=next(p for p in self.e.call('precise_read',{})['pins'] if p['number']=='1')
        label={'id':'din-label','kind':'label','text':'DIN','at':p['native_at'],'font':{'size':[1.27,1.27],'justify':['left','bottom']}}
        self.e.call('precise_apply',{'request_key':'label','items':[label]})
        a=self.e.call('precise_check_export',{'request_key':'a','formats':['pdf','bom']})
        self.assertTrue(any('pin' in e for e in a['layoutConsistency']['errors']),a['layoutConsistency'])
        label['at']=[60,60]
        self.e.call('precise_apply',{'request_key':'move','items':[label]})
        b=self.e.call('precise_check_export',{'request_key':'b','formats':['pdf','bom']})
        self.assertEqual(b['layoutConsistency']['status'],'passed',b['layoutConsistency'])

    def test_wire_crossing_original_body_is_rejected(self):
        self.e.call('precise_place_fixed',{'request_key':'place','components':[{'reference':'U1','at':[80,80]}]})
        self.e.call('precise_apply',{'request_key':'cross','items':[{'id':'cross','kind':'wire','points':[[75,60],[110,60]]}]})
        a=self.e.call('precise_check_export',{'request_key':'a','formats':['pdf','bom']})
        self.assertTrue(any(x['reference']=='U1' and x['wire']=='cross' for x in a['layoutConsistency']['wireBodyCrossings']))

    def test_complete_library_with_only_isolated_parts_cannot_pass_visible_wiring(self):
        parts=[{'reference':c['ref'],'at':[30+(i%5)*70,50+(i//5)*27]} for i,c in enumerate(LIB['objects'])]
        for offset in range(0,len(parts),20):
            self.e.call('precise_place_fixed',{'request_key':'batch-'+str(offset),'components':parts[offset:offset+20]})
        a=self.e.call('precise_check_export',{'request_key':'isolated','formats':['pdf','bom']})
        expected={c['ref'] for c in LIB['objects'] if c['pins']}
        self.assertEqual(set(a['layoutConsistency']['labelOnlyComponents']),expected)
        self.assertEqual(a['layoutConsistency']['status'],'failed')

if __name__=='__main__':unittest.main()
