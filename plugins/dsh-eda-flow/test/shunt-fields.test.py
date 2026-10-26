"""Generalized topology and geometry checks for readable filter columns."""
from pathlib import Path
import copy,sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from shunt_fields import column_candidates
from generic_layout import _compact_passive_fields
from native_resources import parse
from design_audit import child,children
from topology_layout import _branch_row_coordinates,_input_shunt_array

def fixture():
    c=lambda ref,kind,pins:{'ref':ref,'librarySymbol':kind,'pins':[{'number':str(n),'type':t} for n,t in pins]}
    design={'components':[c('hub','T:Hub',[(8,'input'),(12,'input'),(19,'power_in')]),
        c('alpha','Device:C',[(1,'passive'),(2,'passive')]),c('beta','Device:C',[(1,'passive'),(2,'passive')])],
        'nets':[{'name':'one','nodes':['hub.8','alpha.2']},{'name':'two','nodes':['hub.12','beta.1']},
                {'name':'return-x','nodes':['hub.19','alpha.1','beta.2']}]}
    resources={'symbols':{'T:Hub':{'description':'Controller'},'Device:C':{'description':'Capacitor'}}}
    groups=[{'references':['beta','hub','alpha']}]
    return design,resources,groups

class Columns(unittest.TestCase):
    def test_filter_escape_ends_before_the_first_signal_row_even_at_maximum_advance(self):
        specs={'F':{'_low':[-6.35,-13.97],'width':12.7,'height':21.59,'_content_low':[-5.9,-3.81],'_content_high':[5.9,3.81]}}
        pins={'IC.8':{'pos':[-10.16,-17.78],'direction':[-1,0]},
              'F.1':{'pos':[0,3.81],'port':[0,7.62],'direction':[0,1]},
              'F.2':{'pos':[0,-3.81],'port':[0,-13.97],'direction':[0,-1]}}
        result=_input_shunt_array([('F','F.1','F.2')],{'F':'IC.8'},['IC.8'],-1,
                                 [-14,-23,28,29],specs,pins,5.08,[-17.78],advance=100)
        escape=result['target_y']['F']+(7.62-3.81)+1.27
        self.assertLessEqual(escape,-17.78-1.27+1e-6)
        # Native pins may be off the placement grid. Rounding cannot move
        # the escape back onto that finer source row.
        pins['IC.8']['pos'][1]=-17.9
        result=_input_shunt_array([('F','F.1','F.2')],{'F':'IC.8'},['IC.8'],-1,
                                 [-14,-23,28,29],specs,pins,5.08,[-17.9],advance=100)
        self.assertLessEqual(result['target_y']['F']+5.08,-17.9-1.27+1e-6)
    def test_source_rows_are_preserved_when_measured_fields_already_clear(self):
        items=[{'source':f'IC.{n}','chain':[(f'Z{n}',f'Z{n}.2',f'Z{n}.1')]} for n in range(3)]
        specs={f'Z{n}':{'_low':[-20,-4],'width':30,'height':14,'_content_low':[-12,-1.016],'_content_high':[4,3.516]} for n in range(3)}
        pins={f'Z{n}.2':{'pos':[3.81,0]} for n in range(3)}
        wanted=[0,5.08,10.16]
        rows=_branch_row_coordinates(items,wanted,1,specs,pins,5.08)
        self.assertEqual(list(rows.values()),wanted)
        specs['Z0']['_content_high'][1]=8
        spread=list(_branch_row_coordinates(items,wanted,1,specs,pins,5.08).values())
        self.assertGreater(spread[1]-1.016,8)
    def test_selection_uses_connections_and_shared_return_not_names_or_order(self):
        d,r,g=fixture();self.assertEqual(column_candidates(d,r,g),{'alpha','beta'})
        for net in d['nets']:net['nodes'].reverse()
        d['nets'].reverse();d['components'].reverse()
        self.assertEqual(column_candidates(d,r,g),{'alpha','beta'})
    def test_single_input_split_groups_and_missing_return_do_not_form_columns(self):
        for change in ['same-input','separate-group','no-return']:
            d,r,g=fixture()
            if change=='same-input':d['nets'][0]['nodes'].append('beta.1');d['nets'][1]['nodes'].remove('beta.1')
            elif change=='separate-group':g=[{'references':['hub','alpha']},{'references':['beta']}]
            else:d['components'][0]['pins'][2]['type']='passive'
            self.assertEqual(column_candidates(d,r,g),set(),change)
    def test_specified_symbols_and_frozen_blocks_preserve_fields(self):
        for change in ['specified','frozen','drawing-rules']:
            d,r,g=fixture()
            if change=='specified':r['symbols']['Device:C']['appearance']={'kind':'specified-capacitor'}
            elif change=='frozen':r['blocks']=[{'bindings':{'old':'alpha'}}]
            else:r['symbols']['Device:C']['drawingRules']={'keep':True}
            self.assertEqual(column_candidates(d,r,g),set(),change)
    def test_vertical_fields_keep_text_visible_and_bound_long_values_without_wide_columns(self):
        for rotation in (0,180):
            raw=parse('(symbol (property "Reference" "FILTER_19" (at 0 0 0) (effects (font (size 1.27 1.27)))) (property "Value" "220pF/50V" (at 0 0 0) (effects (font (size 1.27 1.27)))))')
            props=children(raw,'property');bounds=[-1.27,-3.81,1.27,3.81]
            ordinary=_compact_passive_fields(copy.deepcopy(raw),children(copy.deepcopy(raw),'property'),bounds,False,rotation)
            compact=_compact_passive_fields(raw,props,bounds,False,rotation,column_text=True)
            span=lambda boxes:max(b[2] for b in boxes)-min(b[0] for b in boxes)
            self.assertLess(span(compact),span(ordinary)*.65)
            for p,b in zip(props,compact):
                self.assertEqual(float(child(p,'at')[3]),90)
                self.assertGreaterEqual(b[3]-b[1],len(p[2])*1.15)
                self.assertEqual(child(child(p,'effects'),'justify'),['justify'])
                self.assertNotIn('hide',str(child(p,'effects')))

if __name__=='__main__':unittest.main()
