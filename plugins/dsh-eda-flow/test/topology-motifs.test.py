import unittest,json,copy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'mcp'))
from topology_motifs import find_match,model,native_kind
class MatcherTests(unittest.TestCase):
 def setUp(self):
  b=json.loads((ROOT/'libraries/blocks/series-pin-array.json').read_text(encoding='utf8'));self.p=model(b['design']['components'],b['design'],native_kind)
 def renamed(self,prefix):
  p=copy.deepcopy(self.p);p['parts']={prefix+r:c for r,c in p['parts'].items()}
  for n in p['nets']:n['name']=prefix+n['name'];n['nodes']=[prefix+k for k in n['nodes']]
  p['nc']=[prefix+k for k in p['nc']];return p
 def test_renamed_and_repeated(self):
  a,b=self.renamed('a'),self.renamed('b');host={'parts':{**a['parts'],**b['parts']},'nets':a['nets']+b['nets'],'nc':[]}
  first=find_match(self.p,host);second=find_match(self.p,host,first['bindings'].values());self.assertIsNotNone(second);self.assertFalse(set(first['bindings'].values())&set(second['bindings'].values()))
 def test_external_boundary(self):
  h=self.renamed('external');h['parts']['OTHER']={'kind':'other','pins':['1']};h['nets'][0]['nodes'].append('OTHER.1');self.assertIsNotNone(find_match(self.p,h))
 def test_merge_rejected(self):
  h=copy.deepcopy(self.p);h['nets'][0]['nodes']+=h['nets'][1]['nodes'];del h['nets'][1];self.assertIsNone(find_match(self.p,h))
 def test_missing_pin_rejected(self):
  h=copy.deepcopy(self.p);next(iter(h['parts'].values()))['pins'].pop();self.assertIsNone(find_match(self.p,h))
 def test_nc_rejected(self):
  h=copy.deepcopy(self.p);k=h['nets'][0]['nodes'].pop();h['nc'].append(k);self.assertIsNone(find_match(self.p,h))
 def test_search_bounded(self):self.assertIsNone(find_match(self.p,self.p,budget=0))
if __name__=='__main__':unittest.main()
