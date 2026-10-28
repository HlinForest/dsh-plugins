from pathlib import Path
import copy,sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from interface_clusters import recognize,local_return_nodes,alternatives,column_fields
from orientation_search import candidates


def circuit(links=True,upstream=False):
    def part(ref,kind,pins):return {'ref':ref,'componentKind':kind,'librarySymbol':'X:'+ref,'pins':[{'number':str(n),'name':name,'type':t} for n,name,t in pins]}
    comps=[part('SENSOR','infrared-receiver',[(8,'VCC','power_in'),(3,'GND','power_in'),(6,'DATA','output')]),
           part('SOCKET','connector',[(20,'a','passive'),(4,'b','passive'),(13,'c','passive'),(9,'d','passive')])]
    for ref,kind in [('FEED','resistor'),('BIAS','resistor'),('BYPASS','capacitor')]+([('LINK','resistor'),('RETURN','resistor')] if links else []):
        comps.append(part(ref,kind,[(7,'a','passive'),(2,'b','passive')]))
    nets={'filtered':['SENSOR.8','FEED.7','BYPASS.7'], 'upstream':['FEED.2','SOCKET.20'],
          'signal':['SENSOR.6','BIAS.2'], 'return':['SENSOR.3','BYPASS.2'], 'unrelated':['SOCKET.9']}
    nets['upstream' if upstream else 'filtered'].append('BIAS.7')
    if links:
        nets['signal'].append('LINK.7');nets['external-signal']=['LINK.2','SOCKET.13']
        nets['return'].append('RETURN.7');nets['external-return']=['RETURN.2','SOCKET.4']
    else:nets['signal'].append('SOCKET.13');nets['return'].append('SOCKET.4')
    d={'components':comps,'nets':[{'name':k,'nodes':v} for k,v in nets.items()]}
    r={'symbols':{c['librarySymbol']:{'appearance':{'kind':c['componentKind']}} for c in comps}}
    for c in comps:
        if len(c['pins'])==2:r['symbols'][c['librarySymbol']]['native']='(symbol "Part" (symbol "Part_1_1" (pin passive line (at 0 3.81 90) (number "7")) (pin passive line (at 0 -3.81 270) (number "2"))))'
    return d,r


class Clusters(unittest.TestCase):
    def test_direct_and_series_paths_keep_pin_identity(self):
        for links in (False,True):
            for upstream in (False,True):
                d,r=circuit(links,upstream);before=copy.deepcopy((d,r))
                p=recognize([c['ref'] for c in d['components']],d,r)
                self.assertIsNotNone(p,(links,upstream))
                self.assertEqual(p['paths']['supply']['end'],'SOCKET.20')
                self.assertEqual(p['paths']['signal']['end'],'SOCKET.13')
                self.assertEqual(p['paths']['return']['end'],'SOCKET.4')
                self.assertEqual((d,r),before)
    def test_serialization_order_does_not_choose_a_different_role(self):
        d,r=circuit();refs=[c['ref'] for c in d['components']];p=recognize(refs,d,r)
        d['components'].reverse();d['nets'].reverse()
        for n in d['nets']:n['nodes'].reverse()
        self.assertEqual(recognize(refs[::-1],d,r),p)
    def test_additional_unknown_component_is_not_swallowed(self):
        d,r=circuit();extra=copy.deepcopy(d['components'][-1]);extra['ref']='EXTRA';d['components'].append(extra)
        self.assertIsNone(recognize([c['ref'] for c in d['components']],d,r))
    def test_ambiguous_parallel_paths_are_rejected(self):
        d,r=circuit();extra=copy.deepcopy(next(c for c in d['components'] if c['ref']=='FEED'));extra['ref']='SECOND';d['components'].append(extra)
        for n in d['nets']:
            n['nodes'] += [k.replace('FEED.','SECOND.') for k in list(n['nodes']) if k.startswith('FEED.')]
        self.assertIsNone(recognize([c['ref'] for c in d['components']],d,r))
    def test_return_obligations_cover_the_whole_local_path(self):
        d,r=circuit();g=[{'references':[c['ref'] for c in d['components']]}]
        self.assertEqual(local_return_nodes(d,r,g),{'SENSOR.3','BYPASS.2','RETURN.7','RETURN.2','SOCKET.4'})
    def test_caps_on_other_supply_are_not_inferred_as_local(self):
        d,r=circuit();next(n for n in d['nets'] if n['name']=='filtered')['nodes'].remove('BYPASS.7')
        next(n for n in d['nets'] if n['name']=='upstream')['nodes'].append('BYPASS.7')
        self.assertIsNone(recognize([c['ref'] for c in d['components']],d,r))
    def test_unused_interface_pin_can_remain_explicit_nc(self):
        d,r=circuit();d['nets']=[n for n in d['nets'] if n['name']!='unrelated'];d['nc']=['SOCKET.9']
        self.assertIsNotNone(recognize([c['ref'] for c in d['components']],d,r))
    def test_clusters_are_optional_and_explicit_geometry_stays_authoritative(self):
        d,r=circuit();refs=[c['ref'] for c in d['components']]
        layout={'groups':[{'id':'m','title':'Module','references':[x for x in refs if x not in ('SOCKET','RETURN')]},
                          {'id':'p','title':'Interface','references':['SOCKET','RETURN']}],'rotations':{}}
        before=copy.deepcopy((d,r,layout));alts=alternatives(d,r,layout)
        self.assertEqual(len(alts),1);self.assertEqual((d,r,layout),before)
        self.assertEqual(len(candidates(d,r,layout)[1]),1)
        self.assertEqual(len(candidates(d,r,layout,allow_clusters=True)[1]),2)
        self.assertEqual(alternatives(d,r,layout,merge_groups=False),[])
        combined=copy.deepcopy(layout);combined['groups']=[{'id':'only','title':'Explicit group','references':refs}]
        same_group=alternatives(d,r,combined,merge_groups=False)
        self.assertEqual(len(same_group),1)
        self.assertEqual(same_group[0]['layout']['groups'],combined['groups'])
        self.assertEqual(alternatives(d,r,layout,{'BIAS':0}),[])
        r['symbols']['X:BIAS']['drawingRules']={'preserve':True}
        self.assertEqual(alternatives(d,r,layout),[])
        self.assertNotIn('BIAS',column_fields(d,r,[{'references':refs}]))
        r['symbols']['X:BIAS'].pop('drawingRules');r['blocks']=[{'bindings':{'old':'SENSOR'}}]
        self.assertEqual(alternatives(d,r,layout),[])
    def test_additional_owned_capacitor_is_supported_without_guessing_ownership(self):
        d,r=circuit();c=copy.deepcopy(next(c for c in d['components'] if c['ref']=='BYPASS'));c['ref']='SECOND';d['components'].append(c)
        for n in d['nets']:n['nodes'] += [k.replace('BYPASS.','SECOND.') for k in list(n['nodes']) if k.startswith('BYPASS.')]
        refs=[c['ref'] for c in d['components']]
        self.assertIsNone(recognize(refs,d,r))
        d['functions']=[{'layout':[{'kind':'decoupling','anchor':'SENSOR.8','return':'SENSOR.3','members':['BYPASS','SECOND']}]}]
        self.assertEqual(len(recognize(refs,d,r)['caps']),2)

if __name__=='__main__':unittest.main()
