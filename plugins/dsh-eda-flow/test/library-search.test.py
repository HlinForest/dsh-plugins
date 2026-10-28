import json,sys,tempfile,unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from design_audit import lookup
from native_resources import query

class LibrarySearch(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        (self.root/'symbols').mkdir();(self.root/'footprints/Resistor_SMD.pretty').mkdir(parents=True)
        (self.root/'symbols/Device.kicad_sym').write_text('(kicad_symbol_lib\n\t(symbol "R_Small")\n\t(symbol "R")\n\t(symbol "C")\n)',encoding='utf-8')
        (self.root/'symbols/Transistor.kicad_sym').write_text('(kicad_symbol_lib\n\t(symbol "IRFTEST")\n)',encoding='utf-8')
        (self.root/'symbols/OptoDevice.kicad_sym').write_text('(kicad_symbol_lib\n\t(symbol "R_LDR")\n)',encoding='utf-8')
        (self.root/'footprints/Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod').write_text('(footprint "R_0805_2012Metric")',encoding='utf-8')
        self.addCleanup(self.tmp.cleanup)

    def test_qualified_symbol_is_searchable(self):
        rows=lookup(self.root,'search','Device:R')['matches']
        self.assertEqual(rows[0]['id'],'Device:R')
        self.assertTrue(all(r['id'].startswith('Device:R') for r in rows))

    def test_library_name_finds_footprints(self):
        rows=lookup(self.root,'search','Resistor_SMD')['matches']
        self.assertEqual(rows,[{'kind':'footprint','id':'Resistor_SMD:R_0805_2012Metric'}])

    def test_single_character_exact_symbol_precedes_fuzzy_hits(self):
        rows=lookup(self.root,'search','R')['matches']
        self.assertEqual(rows[0]['id'],'Device:R')
        self.assertGreater(len(rows),1)
        self.assertEqual(rows,lookup(self.root,'search','R')['matches'])

    def test_empty_and_unbounded_queries_are_rejected(self):
        for query in ['', '   ', 'x'*81]:
            with self.assertRaises(ValueError):lookup(self.root,'search',query)

    def test_allowlisted_search_ranks_before_truncation_without_exposing_other_parts(self):
        catalog=self.root/'catalog.json'
        catalog.write_text(json.dumps({'schema':1,'symbols':[f'Allowed:R_{i}' for i in range(75)]+['Device:R'],'footprints':[]}),encoding='utf-8')
        r=query({'libraryRoot':str(self.root),'catalogFile':str(catalog),'kind':'search','query':'R'})
        self.assertEqual(r['matches'][0]['id'],'Device:R')
        self.assertEqual(r['total'],76)
        self.assertEqual(len(r['matches']),60)
        self.assertTrue(r['truncated'])
        self.assertFalse(any(x['id']=='Transistor:IRFTEST' for x in r['matches']))

    def test_allowlisted_search_has_the_same_query_validation(self):
        catalog=self.root/'catalog.json'
        catalog.write_text(json.dumps({'schema':1,'symbols':['Device:R'],'footprints':[]}),encoding='utf-8')
        with self.assertRaises(ValueError):query({'libraryRoot':str(self.root),'catalogFile':str(catalog),'kind':'search','query':' '})

if __name__=='__main__':unittest.main()
