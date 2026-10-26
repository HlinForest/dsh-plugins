from pathlib import Path
import copy,sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from symbol_styles import generate
from standard_symbols import generate as standard
from design_audit import child,children
import native_resources as nr

def pinfacts(native):
    return sorted((child(p,'number')[1],child(p,'name')[1],str(p[1]))
                  for u in children(nr.parse(native),'symbol') for p in children(u,'pin'))

class SymbolStyles(unittest.TestCase):
    def row(self,kind,n):
        return {'componentKind':kind,'value':'test','pins':[{'number':str(i),'name':'SIGNAL_'+str(i),'type':'passive'} for i in range(1,n+1)]}
    def test_display_style_preserves_identity_and_uses_numbered_rows(self):
        row=self.row('display',10);row['displayFeatures']={'digits':2,'indicatorCount':4};before=copy.deepcopy(row)
        native,rules=standard('Evidence:DifferentName',row,None)
        self.assertEqual(pinfacts(native),sorted((p['number'],p['name'],p['type']) for p in row['pins']))
        self.assertEqual(row,before);self.assertEqual(rules['rules'],'ad-readable-v1')
        pins=[p for u in children(nr.parse(native),'symbol') for p in children(u,'pin')]
        top=sorted((float(child(p,'at')[1]),child(p,'number')[1]) for p in pins if float(child(p,'at')[3])==270)
        self.assertEqual([n for _,n in top],['10','9','8','7','6'])
        row['pins'].reverse();self.assertEqual(generate('Evidence:DifferentName',row)[0],native)
    def test_connector_retains_fact_names_types_and_reverses_visual_order(self):
        row=self.row('connector',6);row['pins'][2]['type']='power_out'
        native,_=generate('Any:Port',row)
        self.assertEqual(pinfacts(native),sorted((p['number'],p['name'],p['type']) for p in row['pins']))
        self.assertIn('(at -7.62 20.32 0)',native)
    def test_receiver_icon_does_not_import_diode_pins(self):
        row={'componentKind':'infrared-receiver','pins':[{'number':'9','name':'VCC','type':'power_in'},{'number':'4','name':'GND','type':'power_in'},{'number':'7','name':'OUT','type':'open_collector'}]}
        native,_=generate('Other:Receiver',row)
        self.assertEqual(pinfacts(native),sorted((p['number'],p['name'],p['type']) for p in row['pins']))
        self.assertEqual(len(pinfacts(native)),3)
    def test_incompatible_devices_use_existing_fallback(self):
        for row in [self.row('display',12),self.row('infrared-receiver',3),self.row('logic-ic',16)]:
            self.assertIsNone(generate('T:Other',row))

if __name__=='__main__':unittest.main()
