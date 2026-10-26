import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('output pull-ups face supply upwards while series resistors remain horizontal, independent of names',()=>{
 const script=`
import sys
from pathlib import Path
sys.path.insert(0,'mcp')
from standard_symbols import generate
from symbol_orientation import defaults
from design_audit import child,children
import native_resources as nr
pins=[{'number':str(i),'name':str(i),'type':'passive'} for i in (1,2)]
native,rules=generate('Test:Resistor',{'pins':pins,'componentKind':'resistor'},Path('D:/Kicad/share/kicad'))
resource={'native':native,'drawingRules':rules,'appearance':{'kind':'resistor'}}
for suffix in ('A','Renamed'):
 out='sensor'+suffix+'.7'
 pull='pull'+suffix;series='series'+suffix
 design={'components':[
  {'ref':'sensor'+suffix,'librarySymbol':'Test:Sensor','pins':[{'number':'7','name':'OUT','type':'output'},{'number':'8','name':'GND','type':'power_in'},{'number':'9','name':'VCC','type':'power_in'}]},
  *[{'ref':r,'librarySymbol':'Test:Resistor','pins':pins} for r in (pull,series)]],
 'nets':[{'name':'rail'+suffix,'nodes':[pull+'.2']},{'name':'signal'+suffix,'nodes':[out,pull+'.1',series+'.1']},{'name':'load'+suffix,'nodes':[series+'.2']}],
 'supplied_nets':['rail'+suffix]}
 sensor,_=generate('Test:Sensor',{'pins':design['components'][0]['pins'],'componentKind':'infrared-receiver','value':'receiver'},Path('D:/Kicad/share/kicad'))
 rotations=defaults(design,{'symbols':{'Test:Resistor':resource,'Test:Sensor':{'native':sensor}}})
 ast=nr.parse(native)
 angles={child(p,'number')[1]:float(child(p,'at')[3]) for u in children(ast,'symbol') for p in children(u,'pin')}
 assert (angles['2']+rotations[pull])%360==270
 assert (angles['1']+rotations[series])%360==0
 # An actual connector power output is a source without an extra declaration.
 design['supplied_nets']=[]
 design['components'].append({'ref':'source','pins':[{'number':'1','type':'power_out'}]})
 design['nets'][0]['nodes'].append('source.1')
 rotations=defaults(design,{'symbols':{'Test:Resistor':resource,'Test:Sensor':{'native':sensor}}})
 assert (angles['2']+rotations[pull])%360==270
print('passed')
`;
 assert.match(execFileSync('D:/anaconda/python.exe',['-c',script],{encoding:'utf8',windowsHide:true}),/passed/);
});

test('series resistor terminals face the actual driver side, including renamed designs',()=>{
 const script=`
import sys
from pathlib import Path
sys.path.insert(0,'mcp')
from standard_symbols import generate
from symbol_orientation import defaults
from design_audit import child,children
import native_resources as nr
pins=[{'number':str(i),'name':str(i),'type':'passive'} for i in (1,2)]
native,rules=generate('T:R',{'pins':pins,'componentKind':'resistor'},Path('D:/Kicad/share/kicad'))
angles={child(p,'number')[1]:float(child(p,'at')[3]) for u in children(nr.parse(native),'symbol') for p in children(u,'pin')}
for side in (0,180):
 for name in ('hub','renamed_controller'):
  hub=f'(symbol "T:Hub" (symbol "Hub_1_1" (pin output line (at 0 0 {side}) (length 2.54) (name "OUT") (number "1"))))'
  design={'components':[{'ref':name,'librarySymbol':'T:Hub','pins':[{'number':'1','name':'OUT','type':'output'},{'number':'2','name':'GND','type':'power_in'},{'number':'3','name':'VCC','type':'power_in'}]},{'ref':'branch','librarySymbol':'T:R','pins':pins}], 'nets':[{'name':'signal','nodes':[name+'.1','branch.1']},{'name':'load','nodes':['branch.2']}]}
  result=defaults(design,{'symbols':{'T:Hub':{'native':hub},'T:R':{'native':native,'drawingRules':rules,'appearance':{'kind':'resistor'}}}})
  assert (angles['1']+result['branch'])%360==(side+180)%360
print('passed')
`;
 assert.match(execFileSync('D:/anaconda/python.exe',['-c',script],{encoding:'utf8',windowsHide:true}),/passed/);
});

test('installed Device:R/C records without appearance follow renamed topology anchors',()=>{
 const script=`
import sys
from pathlib import Path
sys.path.insert(0,'mcp')
from symbol_orientation import defaults
import native_resources as nr

library=Path('D:/Kicad/share/kicad')
r=nr.symbol(library,'Device:R')
c=nr.symbol(library,'Device:C')
# These are the real installed-library records: neither one has appearance or
# drawingRules metadata in the snapshot, so classification must remain generic.
assert not r.get('appearance') and not r.get('drawingRules')
assert not c.get('appearance') and not c.get('drawingRules')

hub=('(symbol "T:Anchor" (symbol "Anchor_1_1" '
     '(pin output line (at 0 0 0) (length 2.54) (name "OUT") (number "1")) '
     '(pin power_in line (at 0 -5.08 90) (length 2.54) (name "GND") (number "2")) '
     '(pin power_in line (at 0 5.08 0) (length 2.54) (name "VCC") (number "3")) '
     '(pin output line (at 5.08 0 180) (length 2.54) (name "SPARE") (number "4"))))')
pins_r=[{'number':str(i),'name':'','type':'passive'} for i in (1,2)]
pins_c=[{'number':str(i),'name':'','type':'passive'} for i in (1,2)]
design={
 'components':[
  {'ref':'renamed_driver','librarySymbol':'T:Anchor','pins':[
   {'number':'1','name':'OUT','type':'output'},
   {'number':'2','name':'GND','type':'power_in'},
   {'number':'3','name':'VCC','type':'power_in'},
   {'number':'4','name':'SPARE','type':'output'}]},
  {'ref':'renamed_series','librarySymbol':'Device:R','pins':pins_r},
  {'ref':'renamed_pull','librarySymbol':'Device:R','pins':pins_r},
  {'ref':'renamed_known_cap','librarySymbol':'Device:C','pins':pins_c},
  {'ref':'renamed_fallback_cap','librarySymbol':'Device:C','pins':pins_c}],
 'nets':[
  {'name':'renamed_signal','nodes':['renamed_driver.1','renamed_series.1','renamed_pull.1']},
  {'name':'renamed_load','nodes':['renamed_series.2']},
  {'name':'renamed_known_rail','nodes':['renamed_driver.3','renamed_pull.2','renamed_known_cap.1']},
  {'name':'renamed_ground','nodes':['renamed_driver.2','renamed_known_cap.2','renamed_fallback_cap.2']},
  {'name':'renamed_unknown_rail','nodes':['renamed_fallback_cap.1']},
  {'name':'renamed_spare','nodes':['renamed_driver.4']}],
 'supplied_nets':['renamed_known_rail','renamed_unknown_rail']}
resources={'symbols':{'T:Anchor':{'native':hub},'Device:R':r,'Device:C':c}}
rotations=defaults(design,resources)
assert rotations['renamed_series']==270, rotations
# Device:R pin 2 is the supply terminal; it remains above the pull-up body.
assert rotations['renamed_pull']==180, rotations
# Device:C pin 2 is ground.  With no unique anchor, ground is down.
assert rotations['renamed_fallback_cap']==0, rotations
# A unique power-anchor direction takes precedence for the known rail and the
# capacitor supply terminal faces back toward the owner's outward pin.
assert rotations['renamed_known_cap']==270, rotations
print('passed')
`;
 assert.match(execFileSync('D:/anaconda/python.exe',['-c',script],{encoding:'utf8',windowsHide:true}),/passed/);
});

test('specified resistor and capacitor keep their native geometry',()=>{
 const script=`
import sys
sys.path.insert(0,'mcp')
from symbol_orientation import defaults

def native(ident, pin2_angle=180):
 return f'(symbol "{ident}" (symbol "{ident.split(":")[1]}_1_1" (pin passive line (at 0 0 0) (length 2.54) (name "1") (number "1")) (pin passive line (at 10.16 0 {pin2_angle}) (length 2.54) (name "2") (number "2"))))'

design={
 'components':[
  {'ref':'R6','librarySymbol':'Evidence:R6','pins':[{'number':'1','name':'1','type':'passive'},{'number':'2','name':'2','type':'passive'}]},
  {'ref':'C2','librarySymbol':'Evidence:C2','pins':[{'number':'1','name':'1','type':'passive'},{'number':'2','name':'2','type':'passive'}]},
 ],
 'nets':[
  {'name':'RAIL','nodes':['R6.1','C2.1']},
  {'name':'RETURN','nodes':['R6.2','C2.2']},
 ],
}
resources={'symbols':{
 'Evidence:R6':{'native':native('Evidence:R6',180),'appearance':{'kind':'specified-resistor','axisDegrees':0}},
 'Evidence:C2':{'native':native('Evidence:C2',180),'appearance':{'kind':'specified-capacitor','axisDegrees':0}},
}}
assert defaults(design,resources)=={}
print('passed')
`;
 assert.match(execFileSync('D:/anaconda/python.exe',['-c',script],{encoding:'utf8',windowsHide:true}),/passed/);
});
