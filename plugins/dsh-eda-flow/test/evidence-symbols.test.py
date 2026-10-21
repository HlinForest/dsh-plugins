"""R6 semantic extraction must survive native symbol generation."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'mcp'))
import evidence_symbols as es,native_resources as nr,generic_layout as gl
from unittest.mock import patch
from topology_motifs import native_matches
from design_audit import child,children

class EvidenceSymbols(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows=json.loads((ROOT/'src/mock-r6-records.json').read_text(encoding='utf8'))
    def test_display_matches_r6_outline_and_pin_order(self):
        s=es.build('Evidence:R6_Display',self.rows);units=children(nr.parse(s['native']),'symbol')
        for kind,count in [('rectangle',2),('arc',4),('polyline',2)]:self.assertEqual(len(children(units[0],kind)),count)
        pins=children(units[1],'pin')
        self.assertEqual([child(p,'number')[1] for p in pins],['10','9','8','7','6','1','2','3','4','5'])
        self.assertEqual([child(p,'name')[1] for p in pins],['D','E','C','G','F','DIG3','DIG2','DIG1','B','A'])
        self.assertEqual([float(child(p,'at')[3]) for p in pins],[270]*5+[90]*5)
        for pin in pins:
            for coordinate in child(pin,'at')[1:3]:
                self.assertAlmostEqual(float(coordinate)/1.27,round(float(coordinate)/1.27))
    def test_missing_appearance_rejected(self):
        rows=copy.deepcopy(self.rows);del next(r for r in rows if r['id']=='display-appearance')['appearance']
        with self.assertRaisesRegex(ValueError,'appearance'):es.build('Evidence:R6_Display',rows)
    def test_indicator_dimensions_drive_native_graphics(self):
        rows=copy.deepcopy(self.rows);next(r for r in rows if r['id']=='display-appearance')['appearance']['indicatorRadiusMm']=2
        self.assertNotEqual(es.build('Evidence:R6_Display',rows)['sha256'],es.build('Evidence:R6_Display',self.rows)['sha256'])
    def test_pin_order_cannot_duplicate_pins(self):
        rows=copy.deepcopy(self.rows);next(r for r in rows if r['id']=='display-appearance')['appearance']['topPinOrder'][0]='9'
        with self.assertRaisesRegex(ValueError,'each specified pin'):es.build('Evidence:R6_Display',rows)
    def test_all_41_symbols_preserve_pin_contract(self):
        rows=[r for r in self.rows if r.get('symbolId')];self.assertEqual(len(rows),41)
        for row in rows:
            s=es.build(row['symbolId'],self.rows)
            pins=[p for unit in children(nr.parse(s['native']),'symbol') for p in children(unit,'pin')]
            self.assertEqual({(child(p,'number')[1],child(p,'name')[1],p[1]) for p in pins},{(p['number'],p['name'],p['type']) for p in row['pins']},row['symbolId'])
    def test_supply_marker_does_not_duplicate_power_output(self):
        d={'components':[{'ref':'J1','pins':[{'number':'1','type':'power_out'},{'number':'2','type':'passive'}]}], 'nets':[{'name':'V','nodes':['J1.1']},{'name':'G','nodes':['J1.2']}],'supplied_nets':['V','G']}
        self.assertEqual(gl.supply_helpers(d),{'#PWR02':'G'})
    def test_named_return_requires_explicit_same_net(self):
        d={'components':[{'ref':'R1','pins':[{'number':'1'},{'number':'2'}]}],'nets':[{'name':'G','nodes':['R1.1','R1.2']}]}
        self.assertEqual(gl.same_net_terminals(d),{'R1.1','R1.2'})
        d['nets']=[{'name':'A','nodes':['R1.1']},{'name':'B','nodes':['R1.2']}]
        self.assertEqual(gl.same_net_terminals(d),set())
    def test_label_on_short_lead_cannot_float_past_bend(self):
        routes=[([0,0],[0,-2.54]),([0,-2.54],[-10,-2.54])]
        self.assertEqual(gl.connected_label_point([0,0],[0,-1],routes,7.62),[0,-2.54])
        with self.assertRaisesRegex(ValueError,'No outward wire'):
            gl.connected_label_point([0,0],[1,0],routes,3.81)
    def test_wire_tees_split_but_crossovers_stay_disconnected(self):
        tee=gl.split_wire_vertices([([0,0],[10,0]),([5,0],[5,5])])
        self.assertEqual(tee,{((0,0),(5,0)),((5,0),(10,0)),((5,0),(5,5))})
        cross=gl.split_wire_vertices([([0,0],[10,0]),([5,-5],[5,5])])
        self.assertEqual(cross,{((0,0),(10,0)),((5,-5),(5,5))})
    def test_mock_layout_cannot_fragment_functional_circuits(self):
        import subprocess
        fixture=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {r6Design,r6Layout} from './test/r6-fixture.js';console.log(JSON.stringify({design:r6Design(),layout:r6Layout()}))"],cwd=ROOT,encoding='utf8'))
        resources={'mockEvidence':self.rows,'symbols':{r['symbolId']:es.build(r['symbolId'],self.rows) for r in self.rows if r.get('symbolId')}}
        self.assertTrue(gl.normalize_layout(fixture['layout'],fixture['design'],resources))
        for ref in ['U1','D1','SS']:
            layout=copy.deepcopy(fixture['layout'])
            next(g for g in layout['groups'] if ref in g['references'])['references'].remove(ref)
            layout['groups'].append({'id':'isolated','title':'Isolated','references':[ref]})
            with self.assertRaisesRegex(ValueError,'functional circuit'):
                gl.normalize_layout(layout,fixture['design'],resources)
    def test_cli_export_stages_identical_files_at_short_paths(self):
        import tempfile,shutil,types,hashlib
        from controlled_layout import export
        directory=Path(tempfile.mkdtemp(prefix='eda-export-test-'))
        out=gl.io_path(directory/('a'*90)/('b'*90)/('c'*90));out.mkdir(parents=True)
        sch=out/'Circuit.kicad_sch';sch.write_text('same schematic bytes',encoding='utf8')
        def run(args,**kwargs):
            self.assertNotIn('\\?\\',args[-1]);self.assertLess(len(args[-1]),240)
            self.assertEqual(Path(args[-1]).read_bytes(),sch.read_bytes())
            target=Path(args[args.index('-o')+1])
            if args[3]=='svg':target.mkdir();(target/'Circuit.svg').write_text('<svg/>')
            else:target.write_text('{}')
            return types.SimpleNamespace(returncode=0,stdout='',stderr='')
        try:
            with patch('controlled_layout.subprocess.run',side_effect=run) as mocked:export(out,'kicad-cli',sch)
            self.assertEqual(mocked.call_count,4)
            self.assertTrue((out/'Circuit.pdf').is_file())
            self.assertEqual(gl.read(out/'kicad-commands.json')[0]['sourceSchematicSha256'],hashlib.sha256(sch.read_bytes()).hexdigest())
        finally:
            self.assertTrue(directory.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))
            shutil.rmtree(gl.io_path(directory))
    def test_surrounding_parts_do_not_break_aligned_bank(self):
        import tempfile
        from series_surround import surround
        bank={'id':'main','width':40,'height':30,'children':[{'id':'U','x':20,'y':15},{'id':'R','x':0,'y':15}],
              'edges':[{'sections':[{'startPoint':{'x':10,'y':15},'endPoint':{'x':20,'y':15}}]}]}
        specs={r:{'id':r,'_low':[0,0]} for r in ['U','R']}
        specs['C']={'id':'C','_low':[0,0],'width':15,'height':15,'ports':[{'id':'C.1','x':15,'y':5,'width':0,'height':0,'layoutOptions':{'elk.port.side':'EAST'}}],'layoutOptions':{'elk.portConstraints':'FIXED_POS'}}
        pinmap={'U.2':{'pos':[0,-10],'direction':[-1,0]}}
        edges=[{'id':'external','sources':['C.1'],'targets':['U.2']}]
        with tempfile.TemporaryDirectory(prefix='eda-surround-') as tmp:
            placed=surround(bank,['U','R','C'],specs,pinmap,edges,3.81,lambda graph:gl.elk(graph,Path(tmp),'group','node'))
        nodes={c['id']:c for c in placed['children']}
        self.assertEqual(set(nodes),{'U','R','C'})
        self.assertAlmostEqual(nodes['U']['x']-nodes['R']['x'],20)
        self.assertAlmostEqual(nodes['U']['y'],nodes['R']['y'])
        segments=[s for e in placed['edges'] for s in e['sections']]
        self.assertTrue(any(abs(s['startPoint']['y']-nodes['U']['y'])<.001 and s['startPoint']['y']==s['endPoint']['y'] and abs(s['endPoint']['x']-s['startPoint']['x']-10)<.001 for s in segments))
    def test_page_packing_prioritizes_functional_reading_order(self):
        groups=[({'id':name},{'width':w,'height':h}) for name,w,h in [('driver',40,30),('display',20,25),('input',30,20),('process',30,10)]]
        result=gl.pack_groups(groups,100,100,5)
        placed={p['id']:p for p in result['children']}
        order=[(placed[g['id']]['y'],placed[g['id']]['x']) for g,_ in groups]
        self.assertEqual(order,sorted(order))
    def test_page_rows_do_not_scatter_later_groups_into_short_column_gaps(self):
        dimensions=[(110.49,68.58),(134.422,64.77),(110.306,62.23),(88.696,48.02),(54.598,68.34),(44.46,106.68),(142.1,77.23)]
        groups=[({'id':str(i)},{'width':w,'height':h}) for i,(w,h) in enumerate(dimensions)]
        result=gl.pack_groups(groups,400,242,3.81)
        placed=result['children']
        self.assertEqual(len({p['y'] for p in placed}),2)
        self.assertEqual(placed[3]['x'],0)
        self.assertAlmostEqual(result['height'],179.07)
        for i,p in enumerate(placed):
            for q in placed[i+1:]:
                self.assertTrue(p['x']+p['width']+3.81<=q['x']+.001 or p['y']+p['height']+3.81<=q['y']+.001)
    def test_functional_row_boundary_keeps_ancillary_groups_below_active_circuits(self):
        groups=[({'id':str(i)},{'width':w,'height':h}) for i,(w,h) in enumerate([(160,65),(156,97),(45,107),(55,69),(142,78)])]
        placed=gl.pack_groups(groups,400,242,3.81,[2])['children']
        self.assertEqual(placed[0]['y'],placed[1]['y'])
        self.assertGreater(placed[2]['y'],placed[1]['y'])
        self.assertEqual(placed[2]['y'],placed[4]['y'])
        self.assertIsNone(gl.pack_groups(groups,400,100,3.81,[2]))
    def test_nested_workflow_json_supports_windows_long_paths(self):
        import tempfile,shutil
        directory=Path(tempfile.mkdtemp(prefix='eda-long-path-'))
        try:
            target=directory/('a'*90)/('b'*90)/('c'*90)/'response.json'
            self.assertGreater(len(str(target)),260)
            gl.write(target,{'status':'passed','symbol':'Evidence:R6_Display'})
            self.assertEqual(gl.read(target)['symbol'],'Evidence:R6_Display')
        finally:
            self.assertTrue(directory.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))
            shutil.rmtree(gl.io_path(directory))
    def test_mock_mode_never_scans_frozen_cad_fragments(self):
        with patch.object(Path,'glob',side_effect=AssertionError('historical fragment scan')):
            self.assertEqual(native_matches({'mockEvidence':self.rows},{}),[])
        with self.assertRaisesRegex(ValueError,'forbids frozen CAD'):
            nr.snapshot({'mockEvidence':self.rows},{'blockInstances':[{'blockId':'old-cad'}]})

if __name__=='__main__':unittest.main()

